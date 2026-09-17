import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, HostState, PluginInfo, ToolActivity, UsageStats } from "@shared/types";
import { MessageThread } from "./components/MessageThread";
import { TitleBar } from "./components/TitleBar";
import { AgentComposer } from "./components/agent/AgentComposer";
import { AgentSidebar, type SidebarView } from "./components/agent/AgentSidebar";
import { FileBrowser } from "./components/panel/FileBrowser";
import { FileViewer } from "./components/panel/FileViewer";
import { SessionOutline } from "./components/panel/SessionOutline";
import { TerminalPanel } from "./components/panel/TerminalPanel";
import type { FileEntry } from "@shared/workspace";
import { cn } from "./lib/cn";
import type { BrowserState, DesignPick } from "@shared/browser";
import type { UiAnswer, UiNotification, UiRequest } from "@shared/ui";
import { ApprovalPrompt, NoticeStack } from "./components/agent/ApprovalPrompt";
// Heavy views and panels arrive as separate chunks. Usage drags in the chart
// library and two 1000-line tables; the design pick drags in an icon set.
const UsageView = lazy(() => import("./views/UsageView").then((m) => ({ default: m.UsageView })));
const CustomizeView = lazy(() => import("./views/CustomizeView").then((m) => ({ default: m.CustomizeView })));
const SettingsView = lazy(() => import("./views/SettingsView").then((m) => ({ default: m.SettingsView })));
const WelcomeView = lazy(() => import("./views/WelcomeView").then((m) => ({ default: m.WelcomeView })));
const BrowserPanel = lazy(() => import("./components/browser/BrowserPanel").then((m) => ({ default: m.BrowserPanel })));

const BROWSER_WIDTH_KEY = "pi-browser-dock-width";
const clampBrowserWidth = (value: number) => Math.round(Math.min(1100, Math.max(320, value)));
const NextStepCard = lazy(() => import("./components/agent/NextStepCard").then((m) => ({ default: m.NextStepCard })));
const CommandPalette = lazy(() =>
  import("./components/agent/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
import { collectChanges, type ChangeEntry } from "./components/panel/ChangesPanel";
import { buildTurns } from "./lib/agent-view";
import { ToolDock, type DockTool } from "./components/panel/ToolDock";
import { DockToggle } from "./components/panel/DockToggle";
import { formatDesignPick, toImageAttachment } from "./lib/design-pick";
import { ViewSkeleton } from "./components/ViewSkeleton";
import { useTheme } from "./lib/theme";
import { QueueBar, type QueueBehavior } from "./components/agent/QueueBar";

/**
 * What the main column is showing.
 *
 * There is no "browser" or "usage" here: the browser is reachable from Customize
 * and the dashboards from Settings, both as panels inside those views. Five icon
 * targets became two destinations plus the chat you are always in.
 */
type MainView = SidebarView | "browser";

const emptyState: HostState = {
  cwd: "",
  connected: false,
  sessions: [],
  models: [],
  providers: [],
  commands: [],
  settings: {
    blockImages: false,
    imageAutoResize: true,
    modelThinkingLevels: {},
    compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
    showCacheMissNotices: false,
    hideThinkingBlock: false,
  },
  snapshot: null,
  todos: [],
  tools: [],
  queue: { steering: [], followUp: [], steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" },
};

/** The main process can emit a minimal fallback state before the host connects. */
function normalizeState(state: HostState | null | undefined): HostState {
  if (!state) return emptyState;
  return {
    ...emptyState,
    ...state,
    sessions: state.sessions ?? [],
    models: state.models ?? [],
    providers: state.providers ?? [],
    commands: state.commands ?? [],
    settings: state.settings ?? emptyState.settings,
  };
}

export function App() {
  const theme = useTheme();
  const { dark, frozen: themeFrozen } = theme;
  const [view, setView] = useState<MainView>("chat");
  const [state, setState] = useState<HostState>(emptyState);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageRange, setUsageRange] = useState<0 | 7 | 30>(30);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTool, setDockTool] = useState<DockTool | null>(null);
  const [activeChange, setActiveChange] = useState<ChangeEntry | null>(null);
  const [openFile, setOpenFile] = useState<string | undefined>(undefined);
  const [browser, setBrowser] = useState<BrowserState>({
    url: "",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    devtoolsOpen: false,
    designMode: false,
  });
  const [designPick, setDesignPick] = useState<DesignPick | null>(null);
  /** the browser docks on the right of the conversation; fullscreen is a view */
  const [browserDockOpen, setBrowserDockOpen] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [uiRequest, setUiRequest] = useState<UiRequest | null>(null);
  const [notices, setNotices] = useState<UiNotification[]>([]);
  /* the host keeps every notification it ever sent; ids that timed out or were
     dismissed here must never reappear on the next payload */
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const [queueBehavior, setQueueBehavior] = useState<QueueBehavior>("followUp");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const suppressScrollRef = useRef(false);
  /** follow the stream only while the reader is already at the bottom */
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  /** the transcript is remounted when the view key changes; remember where the reader was */
  const scrollMemoryRef = useRef(0);

  const [zoomFactor, setZoomFactor] = useState<number>(() => {
    try {
      // v1 stored values from an over-aggressive auto-scale (0.85–0.92 on big
      // monitors); v2 starts fresh so those do not stick
      const saved = localStorage.getItem("pi-zoom-scale-2");
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0.7 && val <= 1.5) return val;
      }
    } catch {}
    if (typeof window !== "undefined") {
      // large monitors make the 14px base read oversized; scale down gently
      if (window.screen.width >= 2560) return 0.95;
      if (window.screen.width > 1920 || window.devicePixelRatio > 1.2) return 0.9;
    }
    return 1.0;
  });

  const zoomRef = useRef(zoomFactor);
  zoomRef.current = zoomFactor;

  const applyZoom = useCallback((factor: number) => {
    const clamped = Math.round(Math.min(1.5, Math.max(0.7, factor)) * 100) / 100;
    zoomRef.current = clamped;
    setZoomFactor(clamped);
    try {
      window.pi?.setZoomFactor?.(clamped);
      localStorage.setItem("pi-zoom-scale-2", String(clamped));
    } catch {}
  }, []);

  // apply on mount (restores the persisted factor)
  useEffect(() => {
    try {
      window.pi?.setZoomFactor?.(zoomFactor);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+wheel zoom, and Ctrl + / Ctrl - / Ctrl 0 keyboard zoom
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        applyZoom(zoomRef.current + (event.deltaY < 0 ? 0.05 : -0.05));
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        applyZoom(zoomRef.current + 0.05);
      } else if (event.key === "-") {
        event.preventDefault();
        applyZoom(zoomRef.current - 0.05);
      } else if (event.key === "0") {
        event.preventDefault();
        applyZoom(1);
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [applyZoom]);


  useEffect(() => {
    const unsubscribe = window.pi.onUpdate((payload) => {
      setState(normalizeState(payload.state));
      setMessages(payload.messages);
      setTools(payload.tools);
      if (payload.uiRequest !== undefined) setUiRequest(payload.uiRequest);
      if (payload.notifications) {
        setNotices(payload.notifications.filter((notice) => !retiredNoticesRef.current.has(notice.id)));
      }
    });
    void window.pi.getState().then((payload) => {
      setState(normalizeState(payload.state));
      setMessages(payload.messages);
      setTools(payload.tools);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const offState = window.pi.onBrowserState(setBrowser);
    const offPick = window.pi.onBrowserPick((pick) => setDesignPick(pick));
    return () => {
      offState();
      offPick();
    };
  }, []);

  const sendDesignPick = useCallback(
    (pick: DesignPick, instruction?: string) => {
      setView("chat");
      // Only attach the cropped screenshot to a model that accepts images.
      // Sending one to a text-only model is an upstream error, not a graceful
      // degradation — and the pick is still useful without it.
      const vision = Boolean(state.snapshot?.model?.supportsImages);
      void window.pi
        .prompt({
          text: formatDesignPick(pick, instruction, vision),
          images: vision ? toImageAttachment(pick.screenshot) : undefined,
          streamingBehavior: browser.designMode ? "followUp" : undefined,
        })
        .catch(() => undefined);
      if (!browser.designMode) setDesignPick(null);
    },
    [browser.designMode, state.snapshot?.model?.supportsImages],
  );

  useEffect(() => {
    void window.pi.getDesktopConfig().then((config) => setOnboarded(config.onboardingDone));
  }, []);

  // warm the docked browser's chunk — first open then skips the lazy fetch
  useEffect(() => {
    const timer = setTimeout(() => void import("./components/browser/BrowserPanel"), 1200);
    return () => clearTimeout(timer);
  }, []);

  /* toasts are transient: each gets five seconds, then the renderer drops it
   * itself — extension notifications otherwise stacked up forever in the
   * bottom-right corner */
  const retiredNoticesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!notices.length) return;
    const timer = setTimeout(() => {
      setNotices((current) => {
        const [expired, ...rest] = current;
        if (expired) retiredNoticesRef.current.add(expired.id);
        return rest;
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [notices]);

  const loadPlugins = useCallback(async () => {
    setPluginsLoading(true);
    try {
      setPlugins(await window.pi.getPlugins());
    } finally {
      setPluginsLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async (days: number) => {
    setUsageLoading(true);
    try {
      setUsage(await window.pi.getUsage(days));
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "customize" && !plugins.length) void loadPlugins();
  }, [view, plugins.length, loadPlugins]);

  // the dashboards live in Settings now, so load them when that opens
  useEffect(() => {
    if (view === "settings") void loadUsage(usageRange);
  }, [view, usageRange, loadUsage]);

  const title = useMemo(() => {
    if (state.snapshot?.sessionName) return state.snapshot.sessionName;
    const current = state.sessions.find((session) => session.path === state.snapshot?.sessionFile);
    return current?.firstMessage || "New task";
  }, [state]);

  const streaming = Boolean(state.snapshot?.isStreaming);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && streaming) {
        event.preventDefault();
        void window.pi.abort();
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setView("chat");
        void window.pi.newSession();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        // design mode opens the docked browser, not the fullscreen one — you
        // pick an element while the conversation stays in view
        setBrowserDockOpen(true);
        setView("chat");
        void window.pi.setDesignMode(!browser.designMode);
        return;
      }
      if (mod && event.key.toLowerCase() === "u") {
        event.preventDefault();
        // the usage dashboard now lives inside Settings
        setView((value) => (value === "settings" ? "chat" : "settings"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browser.designMode, streaming]);

  /** Distance from the bottom, in px — the threshold that counts as "at the bottom". */
  const onTranscriptScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const near = distance < 80;
    stickRef.current = near;
    scrollMemoryRef.current = node.scrollTop;
    setAtBottom(near);
  }, []);

  // restore the reading position after a view switch, and do not yank it back
  useEffect(() => {
    if (view !== "chat") return;
    const node = scrollerRef.current;
    const offset = scrollMemoryRef.current;
    if (!node || offset <= 0) return;
    node.scrollTop = offset;
    stickRef.current = false;
    setAtBottom(false);
  }, [view]);

  useEffect(() => {
    if (view !== "chat") return;
    if (suppressScrollRef.current) {
      suppressScrollRef.current = false;
      return;
    }
    // Scrolling up to read must survive the next token: only follow the stream
    // when the reader is already parked at the bottom.
    if (!stickRef.current) return;
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, tools, streaming, view]);

  const jumpToLatest = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    stickRef.current = true;
    setAtBottom(true);
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, []);

  const jumpToTurn = useCallback((key: string) => {
    suppressScrollRef.current = true;
    const target = scrollerRef.current?.querySelector(`[data-turn="${key}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    // auto-scroll stays suppressed for one tick so the smooth scroll is not cancelled
    window.setTimeout(() => {
      suppressScrollRef.current = false;
    }, 600);
  }, []);

  /**
   * The dock is a summary, not a live view: it accepts stale-by-a-frame data.
   * Deferring its inputs keeps a streaming answer at frame rate — the heavy
   * panels (flowchart, diffs, outline) then repaint between keystrokes instead
   * of during them.
   */
  const deferredMessages = useDeferredValue(messages);
  const deferredState = useDeferredValue(state);

  /** docked browser width in px; 0 means "follow the window at 42%" */
  const [browserWidth, setBrowserWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(BROWSER_WIDTH_KEY)) || 0;
      return saved ? clampBrowserWidth(saved) : 0;
    } catch {
      return 0;
    }
  });
  const [resizingBrowser, setResizingBrowser] = useState(false);

  const applyBrowserWidth = useCallback((value: number, persist = false) => {
    const clamped = clampBrowserWidth(value);
    setBrowserWidth(clamped);
    if (persist) {
      try {
        localStorage.setItem(BROWSER_WIDTH_KEY, String(clamped));
      } catch {}
    }
  }, []);

  /** current dock width: the dragged value when set, else 42% of the window */
  const browserLiveWidth = useCallback(
    (fallback?: number) =>
      browserWidth > 0 ? clampBrowserWidth(browserWidth) : clampBrowserWidth((fallback ?? window.innerWidth) * 0.42),
    [browserWidth],
  );

  const onStartBrowserResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = browserLiveWidth(event.currentTarget.parentElement?.clientWidth);
      setResizingBrowser(true);
      const onMove = (moveEvent: MouseEvent) => {
        // the dock sits on the right: dragging left grows it
        applyBrowserWidth(startWidth + (startX - moveEvent.clientX));
      };
      const onUp = (upEvent: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setResizingBrowser(false);
        applyBrowserWidth(startWidth + (startX - upEvent.clientX), true);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [applyBrowserWidth, browserLiveWidth],
  );

  // while dragging, lock the cursor and kill text selection app-wide
  useEffect(() => {
    if (!resizingBrowser) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [resizingBrowser]);

  const openDockFile = useCallback((entry: FileEntry) => {
    setActiveChange(null);
    setOpenFile(entry.path);
  }, []);
  const openDockDiff = useCallback(
    (path: string) => {
      const change = collectChanges(buildTurns(messages, [])).find((entry) => entry.file === path) ?? null;
      setActiveChange(change);
      setOpenFile(path);
    },
    [messages],
  );
  const revealFile = useCallback((path: string) => void window.pi.revealFile(path), []);
  const openDockBrowser = useCallback(() => {
    setDockOpen(false);
    setBrowserDockOpen(true);
    setView("chat");
  }, []);

  const answer = useCallback((reply: UiAnswer) => {
    setUiRequest(null);
    void window.pi.respondUi(reply);
  }, []);

  // Every hook above this line: the onboarding gate below returns early, and a
  // hook declared after an early return changes the hook count between renders.
  if (onboarded === false) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-page text-ink">
        <TitleBar dark={dark} onToggleTheme={theme.toggle} />
        <Suspense fallback={<ViewSkeleton />}>
          <WelcomeView onDone={() => setOnboarded(true)} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-page text-ink">
      <TitleBar dark={dark} onToggleTheme={theme.toggle} />
      <div className="flex min-h-0 flex-1">
        {/* No icon rail: the sidebar's own rows are the navigation, so Views are
            the three panes rather than five icon targets. Browser and Usage open
            from inside Customize and Settings. */}
        {/* Settings is the exception: it brings its own left rail (the category
            list), so the session pane stands down rather than the app opening a
            small settings panel inside the agent shell. */}
        {view === "settings" ? null : (
          <AgentSidebar
            state={state}
            view={view === "browser" ? "chat" : view}
            onView={setView}
            onNew={() => void window.pi.newSession()}
            onSelect={(path) => {
              setView("chat");
              void window.pi.switchSession(path);
            }}
            onPickCwd={() => void window.pi.pickCwd()}
            onSearch={() => setPaletteOpen(true)}
            onNewInWorkspace={(cwd) => {
              setView("chat");
              void (async () => {
                await window.pi.setCwd(cwd);
                await window.pi.newSession();
              })();
            }}
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-page">
          <div key={view} className="view-enter flex min-h-0 flex-1 flex-col">
            <Suspense fallback={<ViewSkeleton />}>
            {view === "browser" ? (
              <BrowserPanel
                state={browser}
                expanded
                zoom={zoomFactor}
                onExpandedChange={(next) => {
                  if (!next) {
                    setBrowserDockOpen(true);
                    setView("chat");
                  }
                }}
                designPick={designPick}
                recent={messages.slice(-3)}
                onAddToChat={(pick) => sendDesignPick(pick)}
                onAskAbout={(pick, instruction) => sendDesignPick(pick, instruction)}
                onClearPick={() => setDesignPick(null)}
              />
            ) : null}

            {view === "chat" && openFile ? (
              <FileViewer
                path={openFile}
                diffLines={activeChange?.file === openFile ? activeChange.diffLines : undefined}
                dockToggle={<DockToggle open={dockOpen} onToggle={() => setDockOpen((value) => !value)} />}
                onClose={() => {
                  setOpenFile(undefined);
                  setActiveChange(null);
                }}
                onReveal={(path) => void window.pi.revealFile(path)}
              />
            ) : null}

            {view === "chat" && !openFile ? (
              <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-[42px] shrink-0 items-center gap-2 border-b border-line px-4">
                  <div className="truncate text-[13px] font-semibold text-ink">{title}</div>
                  <span className="inline-flex h-5 items-center gap-1.5 rounded-[5px] bg-field px-1.5 font-mono text-[10.5px] text-ink-2">
                    <span
                      className={`size-1.5 rounded-full ${streaming ? "pulse-dot bg-accent" : state.error ? "bg-red" : "bg-green"}`}
                    />
                    {streaming ? "running" : state.error ? "error" : state.connected ? "idle" : "offline"}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setPaletteOpen(true)}
                    className="pressable hidden h-5 items-center gap-1.5 rounded-[5px] bg-field px-1.5 font-mono text-[10.5px] text-ink-3 hover:bg-hover-2 hover:text-ink-2 sm:inline-flex"
                    title="Command palette"
                  >
                    Ctrl K
                  </button>
                  <DockToggle open={dockOpen} onToggle={() => setDockOpen((value) => !value)} />
                </header>

                {state.error ? (
                  <div className="border-b border-red-tint bg-red-tint px-4 py-2 text-[12px] text-red">{state.error}</div>
                ) : null}

                <div className="relative min-h-0 flex-1">
                  {/* a session switch remounts the transcript with a soft
                      enter instead of the old conversation snapping out */}
                  <div
                    key={state.snapshot?.sessionFile ?? "new"}
                    ref={scrollerRef}
                    onScroll={onTranscriptScroll}
                    className="scrollbar-thin view-enter h-full overflow-y-auto px-6 py-6"
                  >
                    <MessageThread
                      messages={messages}
                      tools={tools}
                      streaming={streaming}
                      sessionKey={state.snapshot?.sessionFile ?? "new"}
                      onFork={(userIndex) => void window.pi.forkAt(userIndex).catch(() => undefined)}
                      onEditPrompt={setPrefill}
                    />
                  </div>
                  {!atBottom ? (
                    <button
                      type="button"
                      onClick={jumpToLatest}
                      className="pressable absolute bottom-3 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-3 text-[11.5px] font-medium text-canvas shadow-overlay"
                      style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
                    >
                      {streaming ? "Follow the stream" : "Jump to latest"}
                    </button>
                  ) : null}
                </div>

                <QueueBar
                  queue={state.queue}
                  behavior={queueBehavior}
                  onBehavior={setQueueBehavior}
                  onMode={(kind, mode) => void window.pi.setQueueMode(kind, mode)}
                  onRemove={(kind, index) => void window.pi.removeQueued(kind, index)}
                  onClear={() => {
                    // pi only clears everything — put it back in the editor, the way Esc does
                    void window.pi.clearQueue().then((result) => {
                      if (result.texts.length) setPrefill(result.texts.join("\n"));
                    });
                  }}
                />

                <AgentComposer
                  state={state}
                  messages={messages}
                  prefill={prefill}
                  onPrefillConsumed={() => setPrefill(undefined)}
                  onSend={(text) => {
                    // while the agent runs the delivery mode is the user's choice — it is
                    // what decides "correct this run" versus "add to the next"
                    if (streaming) {
                      void (queueBehavior === "steer" ? window.pi.steer(text) : window.pi.followUp(text));
                      return;
                    }
                    void window.pi.prompt({ text });
                  }}
                  onSetThinking={(level) => void window.pi.setThinking(level).catch(() => undefined)}
                  onAbort={() => void window.pi.abort()}
                  onSetModel={(provider, modelId) => void window.pi.setModel(provider, modelId).catch(() => undefined)}
                />
              </div>

              {/* the docked browser: the page composites above this pane, its
                  chrome is the same BrowserPanel the fullscreen view uses.
                  The divider on its left edge drags it wider or narrower. */}
              {browserDockOpen ? (
                <aside
                  className="relative flex shrink-0 flex-col border-l border-line"
                  style={{ width: browserLiveWidth() }}
                >
                  <div
                    onMouseDown={onStartBrowserResize}
                    onDoubleClick={() => applyBrowserWidth(0, true)}
                    title="Drag to resize, double-click to reset"
                    className="group/browser-resizer absolute inset-y-0 left-0 z-30 w-1.5 cursor-col-resize"
                  >
                    <div
                      className={cn(
                        "mx-auto h-full w-px transition-colors duration-150",
                        resizingBrowser ? "bg-accent" : "bg-transparent group-hover/browser-resizer:bg-accent/50",
                      )}
                    />
                  </div>
                  <BrowserPanel
                    state={browser}
                    expanded={false}
                    zoom={zoomFactor}
                    onExpandedChange={(next) => {
                      if (next) setView("browser");
                    }}
                    designPick={designPick}
                    recent={messages.slice(-3)}
                    onAddToChat={(pick) => sendDesignPick(pick)}
                    onAskAbout={(pick, instruction) => sendDesignPick(pick, instruction)}
                    onClearPick={() => setDesignPick(null)}
                    onClose={() => setBrowserDockOpen(false)}
                  />
                </aside>
              ) : null}
              </div>
            ) : null}

            {view === "customize" ? (
              <Suspense fallback={<ViewSkeleton />}>
                <CustomizeView
                  state={state}
                  plugins={plugins}
                  loading={pluginsLoading}
                  dockToggle={<DockToggle open={dockOpen} onToggle={() => setDockOpen((value) => !value)} />}
                  onRefresh={() => void loadPlugins()}
                  onToggle={async (plugin, enabled) => {
                    try {
                      setPlugins(await window.pi.setPluginEnabled(plugin.path, plugin.kind, enabled));
                    } catch {
                      await loadPlugins();
                    }
                  }}
                  onDelete={async (plugin) => {
                    try {
                      setPlugins(await window.pi.deletePlugin(plugin.path, plugin.kind));
                    } catch {
                      await loadPlugins();
                    }
                  }}
                  onOpen={(plugin) => void window.pi.showItem(plugin.path)}
                  onUseModel={(provider, modelId) => void window.pi.setModel(provider, modelId).catch(() => undefined)}
                  onSaveModel={(edit) => void window.pi.saveModel(edit).catch(() => undefined)}
                  onDeleteModel={(provider, modelId) => void window.pi.deleteModel(provider, modelId).catch(() => undefined)}
                  onSetDefaultModel={(provider, modelId) =>
                    void window.pi.updateSettings({ defaultProvider: provider, defaultModel: modelId }).catch(() => undefined)
                  }
                  onReload={() => void window.pi.reload()}
                />
              </Suspense>
            ) : null}

            {view === "settings" ? (
              <Suspense fallback={<ViewSkeleton />}>
                <SettingsView
                  state={state}
                  colorMode={theme.mode}
                  onColorMode={theme.setMode}
                  zoomFactor={zoomFactor}
                  onZoomFactor={applyZoom}
                  onBack={() => setView("chat")}
                  dockToggle={<DockToggle open={dockOpen} onToggle={() => setDockOpen((value) => !value)} />}
                  onUpdate={(patch) => void window.pi.updateSettings(patch).catch(() => undefined)}
                  onReload={() => void window.pi.reload()}
                  usage={usage}
                  usageLoading={usageLoading}
                  usageRange={usageRange}
                  onUsageRange={setUsageRange}
                  onUsageRefresh={() => void loadUsage(usageRange)}
                />
              </Suspense>
            ) : null}
            </Suspense>
          </div>
        </main>

        <ToolDock
          state={deferredState}
          open={dockOpen}
          onOpenChange={setDockOpen}
          tool={dockTool}
          onTool={setDockTool}
          cwd={state.cwd}
          messages={deferredMessages}
          openFile={openFile}
          onOpenFile={openDockFile}
          activeChangeFile={activeChange?.file}
          onOpenDiff={openDockDiff}
          onReveal={revealFile}
          onJumpToTurn={jumpToTurn}
          onOpenBrowser={openDockBrowser}
        />
      </div>

      {uiRequest ? <ApprovalPrompt request={uiRequest} onAnswer={answer} /> : null}
      <NoticeStack
        notices={notices}
        onDismiss={(id) => {
          retiredNoticesRef.current.add(id);
          setNotices((current) => current.filter((notice) => notice.id !== id));
        }}
      />

      <Suspense fallback={null}>
      <CommandPalette
        open={paletteOpen}
        state={state}
        onClose={() => setPaletteOpen(false)}
        onRun={(text) => {
          setView("chat");
          setPrefill(text);
        }}
        onSwitchSession={(path) => {
          setView("chat");
          void window.pi.switchSession(path);
        }}
        onSetModel={(provider, modelId) => void window.pi.setModel(provider, modelId).catch(() => undefined)}
        onView={setView}
        onPickCwd={() => void window.pi.pickCwd()}
        onReload={() => void window.pi.reload()}
        onNewSession={() => {
          setView("chat");
          void window.pi.newSession();
        }}
      />
      </Suspense>
    </div>
  );
}
