import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, HostState, PlanAction, PluginInfo, ToolActivity, UsageStats } from "@shared/types";
import { MessageThread } from "./components/MessageThread";
import { TitleBar } from "./components/TitleBar";
import { AgentComposer } from "./components/agent/AgentComposer";
import { AgentSidebar, type SidebarView } from "./components/agent/AgentSidebar";
import { FolderPicker } from "./components/agent/FolderPicker";
import { TerminalPanel } from "./components/panel/TerminalPanel";
import type { FileEntry } from "@shared/workspace";
import { cn } from "./lib/cn";
import { ListChecksIcon, TerminalIcon } from "./components/icons";
import { playDoneChime } from "./lib/sound";
import { t, useLocale } from "./lib/i18n";
import { chordOf, matches, resolveEvent } from "./lib/keybindings";
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
/* below this the monitor stops claiming a column of its own: at that width the
   thread needs the room more than the panel does */
const MONITOR_FLOAT_WIDTH = 1280;
const NextStepCard = lazy(() => import("./components/agent/NextStepCard").then((m) => ({ default: m.NextStepCard })));
const MonitorPanel = lazy(() => import("./components/panel/MonitorPanel").then((m) => ({ default: m.MonitorPanel })));
const CommandPalette = lazy(() =>
  import("./components/agent/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
import type { ChangeEntry } from "./components/panel/ChangesPanel";
import { ToolDock, type DockTool } from "./components/panel/ToolDock";
import { SessionStrip } from "./components/panel/SessionStrip";
import { DockToggle } from "./components/panel/DockToggle";
import { FolderOpener } from "./components/panel/FolderOpener";
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
  plan: { phase: "off", steps: [], updatedAt: 0 },
  fleet: [],
  surfaces: [],
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
  /* the monitor is the conversation area's own right-hand column: a glance at
     where the work stands, not a place you work */
  const [monitorOpen, setMonitorOpen] = useState(false);
  /* only the window drives the float decision — a measurement taken inside the
     row would move with the monitor's own width and flap */
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [activeChange, setActiveChange] = useState<ChangeEntry | null>(null);
  const [openFile, setOpenFile] = useState<string | undefined>(undefined);
  /** the session being switched to — its transcript is still the previous one */
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  /** owned here so the title bar and the rail toggle the same state */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /* the whole shell re-renders when the language changes */
  useLocale();
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

  /* A shell-level notice, for actions that are not extension callbacks: a model
     write that failed has to say so, or the settings page reads as if it had
     simply ignored the click. Extension notices arrive on their own channel. */
  const pushNotice = useCallback((message: string, type: UiNotification["type"] = "info") => {
    setNotices((current) => [
      ...current,
      { id: `local-${Date.now()}-${current.length}`, message, type, at: Date.now() },
    ]);
  }, []);

  /** Run a write against models.json and report both outcomes. The failure is
   *  re-thrown so the dialog that raised it can stay open with the work in it. */
  const runModelWrite = useCallback(
    async (job: () => Promise<void>, done: string) => {
      try {
        await job();
        pushNotice(done, "info");
      } catch (error) {
        pushNotice(error instanceof Error ? error.message : String(error), "error");
        throw error;
      }
    },
    [pushNotice],
  );

  /** Report only the failure — for actions whose success is already on screen,
   *  like a model switch repainting the composer. Refusing to switch to a model
   *  that is switched off in settings arrives through here. */
  const reportFailure = useCallback(
    async (job: () => Promise<void>) => {
      try {
        await job();
      } catch (error) {
        pushNotice(error instanceof Error ? error.message : String(error), "error");
      }
    },
    [pushNotice],
  );
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

  /* the window's own width, which is also what a zoom change moves; a
     resized row would move with the monitor's own width and flap, and a
     ResizeObserver only answers on frames the app may not be drawing */
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [zoomFactor, setZoomFactor] = useState<number>(() => {
    try {
      // v1 stored values from an over-aggressive auto-scale (0.85–0.92 on big
      // monitors); v2 starts fresh so those do not stick
      const saved = localStorage.getItem("pi-zoom-scale-3");
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0.7 && val <= 1.5) return val;
      }
    } catch {}
    if (typeof window !== "undefined") {
      // Cursor and VS Code run at 100% on the same screens; scaling the whole
      // UI down made every size read a notch smaller than the reference
      return 1.0;
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
      localStorage.setItem("pi-zoom-scale-3", String(clamped));
    } catch {}
  }, []);

  // apply on mount (restores the persisted factor)
  useEffect(() => {
    try {
      window.pi?.setZoomFactor?.(zoomFactor);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+wheel zoom, and the keyboard zoom chords from the shortcut table
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!matches({ key: "wheel", ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey }, chordOf("zoomWheel"))) return;
      event.preventDefault();
      applyZoom(zoomRef.current + (event.deltaY < 0 ? 0.05 : -0.05));
    };
    const onKey = (event: KeyboardEvent) => {
      const id = resolveEvent(event);
      if (id === "zoomIn") {
        event.preventDefault();
        applyZoom(zoomRef.current + 0.05);
      } else if (id === "zoomOut") {
        event.preventDefault();
        applyZoom(zoomRef.current - 0.05);
      } else if (id === "zoomReset") {
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
        /* The host re-sends its whole list on every bridge event, so it
           replaces its own notices and leaves the shell's in place — a "saved
           to models.json" from settings must not vanish because an extension
           happened to raise a toast a moment later. */
        setNotices((current) => [
          ...current.filter((notice) => notice.id.startsWith("local-")),
          ...payload.notifications!.filter((notice) => !retiredNoticesRef.current.has(notice.id)),
        ]);
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

  /* the embedded browser is per folder: its own page, its own logins. Switching
     projects swaps the view rather than navigating the shared one away. */
  useEffect(() => {
    if (state.cwd) void window.pi.setBrowserWorkspace(state.cwd);
  }, [state.cwd]);

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

  /* the desktop config is read once and kept: the plan tab needs the build
     model it remembers, and that is written by the host on every build */
  const [buildModel, setBuildModel] = useState<{ provider: string; id: string } | undefined>(undefined);
  useEffect(() => {
    void window.pi.getDesktopConfig().then((config) => {
      setOnboarded(config.onboardingDone);
      setBuildModel(config.buildModel);
    });
  }, []);

  /* Plan mode's controls. The feature is a plugin, so the window presses its
   * subcommands rather than doing any of the work itself; the host writes the
   * build model down the moment it is used, which is what makes it the default
   * next time. */
  const planAction = useCallback((action: PlanAction) => {
    void window.pi
      .planAction(action)
      .then(() => {
        if (action.model) setBuildModel(action.model);
      })
      .catch(() => undefined);
  }, []);

  /* a plan was just written, or a session with a live plan was opened: the
   * panel that holds it comes up, because that plan is what the next decision
   * is about. Keyed on the file so re-renders do not fight the user's clicks. */
  const shownPlanRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const path = state.plan.path;
    if (!path || path === shownPlanRef.current) return;
    shownPlanRef.current = path;
    if (state.plan.phase !== "review" && state.plan.phase !== "executing") return;
    setDockTool("plan");
    setDockOpen(true);
  }, [state.plan.path, state.plan.phase]);

  /* the fleet panel follows the same rule as the plan's: it arrives with the
     thing it shows. The first spawn of a wave opens the dock on it — but only
     if the user has not already picked a panel for themselves */
  const fleetOpenedRef = useRef(false);
  useEffect(() => {
    const active = state.fleet.length > 0;
    if (active && !fleetOpenedRef.current && dockTool !== "agents") {
      fleetOpenedRef.current = true;
      setDockTool("agents");
      setDockOpen(true);
    }
    if (!active) fleetOpenedRef.current = false;
  }, [state.fleet.length, dockTool]);

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

  const streaming = Boolean(state.snapshot?.isStreaming);

  /* the switch is done once the host reports the session it was asked for */
  useEffect(() => {
    if (!pendingSession) return;
    if (state.snapshot?.sessionFile === pendingSession) setPendingSession(null);
  }, [pendingSession, state.snapshot?.sessionFile]);

  useEffect(() => {
    if (!pendingSession) return;
    const timer = window.setTimeout(() => setPendingSession(null), 4000);
    return () => window.clearTimeout(timer);
  }, [pendingSession]);
  /* an abort is not a failure: the transcript already says "stopped" by being
   * truncated. Only real errors earn the red banner. */
  const aborted = Boolean(state.error && /abort|cancel|stopped/i.test(state.error));
  const fatalError = state.error && !aborted ? state.error : null;

  /* the chords themselves live in lib/keybindings so the Settings table can
   * rebind them; this handler only says what each one *does* */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const id = resolveEvent(event);
      if (!id) return;
      // an abort is not a failure, and Escape must still reach the open overlay
      if (id === "abort") {
        if (!streaming) return;
        event.preventDefault();
        void window.pi.abort();
        return;
      }
      if (id === "palette") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (id === "newSession") {
        event.preventDefault();
        setView("chat");
        void window.pi.newSession();
        return;
      }
      if (id === "designMode") {
        event.preventDefault();
        // design mode opens the docked browser, not the fullscreen one — you
        // pick an element while the conversation stays in view
        setBrowserDockOpen(true);
        setView("chat");
        void window.pi.setDesignMode(!browser.designMode);
        return;
      }
      if (id === "usage" || id === "settings") {
        // the usage dashboard now lives inside Settings, and Cursor/VS Code
        // open preferences on `,`
        event.preventDefault();
        setView((value) => (value === "settings" ? "chat" : "settings"));
        return;
      }
      if (id === "dock") {
        event.preventDefault();
        setDockOpen((value) => !value);
        return;
      }
      if (id === "focusComposer") {
        // focus the composer from anywhere — Cursor's shortcut
        event.preventDefault();
        setView("chat");
        document.querySelector<HTMLTextAreaElement>("[data-promptbar] textarea")?.focus();
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

  /* opening a file or a diff lands it in the dock's files tab — never in the
     conversation's place */
  const openDockFile = useCallback((entry: FileEntry) => {
    setActiveChange(null);
    setOpenFile(entry.path);
    setDockTool("file");
    setDockOpen(true);
  }, []);
  /* the entry carries both the label the reader clicked and the real path to
     open — the label is `App.tsx:361`, which is not a file on disk */
  const openDockDiff = useCallback((change: ChangeEntry) => {
    setActiveChange(change);
    setOpenFile(change.path ?? change.file);
    setDockTool("file");
    setDockOpen(true);
  }, []);
  const revealFile = useCallback((path: string) => void window.pi.revealFile(path), []);
  const closeDockFile = useCallback(() => {
    setOpenFile(undefined);
    setActiveChange(null);
  }, []);
  /* a line quote from the code tab lands in the composer as an @mention with
     its line range; the file's contents ride on the clipboard */
  const addRefToChat = useCallback((ref: string) => {
    setPrefill((current) => (current ? `${current}\n${ref}` : ref));
  }, []);
  const openDockBrowser = useCallback(() => {
    setDockOpen(false);
    setBrowserDockOpen(true);
    setView("chat");
  }, []);

  const answer = useCallback((reply: UiAnswer) => {
    setUiRequest(null);
    void window.pi.respondUi(reply);
  }, []);

  /** a fresh session owns the middle of the window, not the bottom edge */
  const emptySession = messages.length === 0 && !streaming;
  /** the folder switcher inside the greeting is open — the rest of the page dims */
  const [pickingFolder, setPickingFolder] = useState(false);
  /* "In {name} What should Pi do next?" wraps the inline folder switcher, so
   * the template splits around the name instead of interpolating it */
  const [greetingBefore, greetingAfter] = useMemo(() => {
    const [before, ...rest] = t("In {name} What should Pi do next?").split("{name}");
    return [before, rest.join("{name}")];
  }, []);

  /* the run settling is the one moment worth interrupting for: a chime here,
   * and a Windows toast when the window is not the one you are looking at */
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    const was = wasStreamingRef.current;
    wasStreamingRef.current = streaming;
    if (!was || streaming) return;
    if (localStorage.getItem("pi-sound-done") !== "off") playDoneChime();
    if (localStorage.getItem("pi-notify-done") !== "off" && !document.hasFocus()) {
      void window.pi.notify({ title: "Pi Agent", body: t("The run finished.") });
    }
  }, [streaming]);

  // a new session focuses the composer, so you can just start typing
  useEffect(() => {
    if (!emptySession) return;
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>("[data-promptbar] textarea")?.focus();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [emptySession]);

  // Every hook above this line: the onboarding gate below returns early, and a
  // hook declared after an early return changes the hook count between renders.
  if (onboarded === false) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-page text-ink">
        <TitleBar />
        <Suspense fallback={<ViewSkeleton />}>
          <WelcomeView onDone={() => setOnboarded(true)} />
        </Suspense>
      </div>
    );
  }

  /** the composer, hoisted so an empty session can centre it Cursor-style */
  const composer = (
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
      onSetModel={(provider, modelId) => void reportFailure(() => window.pi.setModel(provider, modelId))}
      onPlanAction={planAction}
    />
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-page text-ink">
      <TitleBar />

      {/* the working controls live on their own strip below the title bar —
          they are tools, not window chrome, so they do not sit with the
          close/minimize buttons. The terminal button only opens the dock's
          terminal: that is the one terminal the shell has. */}
      <div className="flex h-10 shrink-0 items-center justify-end gap-1 border-b border-line bg-canvas px-3">
        <FolderOpener
          cwd={state.cwd}
          onBrowse={() => {
            setDockTool("file");
            setDockOpen(true);
          }}
        />
        <button
          type="button"
          aria-label={t("Task monitor")}
          title={t("Task monitor")}
          aria-pressed={monitorOpen}
          onClick={() => setMonitorOpen((value) => !value)}
          className={cn(
            "pressable flex size-7 items-center justify-center rounded-[6px]",
            monitorOpen ? "bg-field text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
          )}
        >
          <ListChecksIcon size={14} />
        </button>
        <button
          type="button"
          aria-label={t("Terminal")}
          title={t("Terminal")}
          onClick={() => {
            setDockTool((current) => (dockOpen && current === "terminal" ? null : "terminal"));
            setDockOpen(true);
          }}
          className={cn(
            "pressable flex size-7 items-center justify-center rounded-[6px]",
            dockOpen && dockTool === "terminal" ? "bg-field text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
          )}
        >
          <TerminalIcon size={14} />
        </button>
        <DockToggle open={dockOpen} onToggle={() => setDockOpen((value) => !value)} />
      </div>
      <div className="relative flex min-h-0 flex-1">
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
              // the transcript shows a skeleton until this session lands —
              // leaving the old conversation up felt like a misclick
              setPendingSession(path);
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
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
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

            {/* the code viewer lives in the dock — the centre is always the
                conversation; opening a file only widens the right pane */}

            {view === "chat" ? (
              <div className="relative flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                {/* no conversation header — Cursor runs the thread straight to
                    the top edge; the session name lives on its sidebar row and
                    the run state on the working indicator */}
                {fatalError ? (
                  <div className="border-b border-red-tint bg-red-tint px-4 py-2 text-[12px] text-red">{fatalError}</div>
                ) : null}

                {emptySession ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-20">
                    <div
                      className={cn(
                        "-mt-6 flex flex-col items-center transition-[filter,opacity] duration-300",
                        pickingFolder && "pointer-events-none select-none opacity-60 [filter:blur(5px)]",
                      )}
                      style={{ animation: "fade-up 320ms cubic-bezier(0.23,1,0.32,1) both" }}
                    >
                      <div className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
                        {t("Only Coding，First Windows.")}
                      </div>
                    </div>
                    {/* the greeting sentence: mostly dimmed copy, with the
                        folder name as the one crisp, bold, underlined link.
                        Same body size as the line above it — the two read as
                        one heading, not a heading and a caption. */}
                    <p
                      className={cn(
                        "mt-3 max-w-[620px] text-center text-[20px] leading-[1.5] tracking-[-0.02em] text-ink-3 transition-[filter,opacity] duration-300",
                        pickingFolder && "pointer-events-none select-none opacity-60 [filter:blur(5px)]",
                      )}
                    >
                      {greetingBefore}
                      <FolderPicker cwd={state.cwd} onOpenChange={setPickingFolder} />
                      {greetingAfter}
                    </p>
                    <div
                      className={cn(
                        "mt-12 flex w-full justify-center transition-[filter,opacity] duration-300",
                        pickingFolder && "pointer-events-none select-none opacity-60 [filter:blur(5px)]",
                      )}
                    >
                      {composer}
                    </div>
                  </div>
                ) : (
                  <>
                <div className="flex min-h-0 flex-1">
                  <div className="relative min-h-0 flex-1">
                  {/* a session switch remounts the transcript with a soft
                      enter instead of the old conversation snapping out */}
                  <div
                    key={state.snapshot?.sessionFile ?? "new"}
                    ref={scrollerRef}
                    onScroll={onTranscriptScroll}
                    className="scrollbar-thin view-enter h-full overflow-y-auto px-6 py-6"
                  >
                    {pendingSession ? (
                      <TranscriptSkeleton />
                    ) : (
                    <MessageThread
                      messages={messages}
                      tools={tools}
                      streaming={streaming}
                      stopped={aborted}
                      sessionKey={state.snapshot?.sessionFile ?? "new"}
                      onFork={(userIndex) => void window.pi.forkAt(userIndex).catch(() => undefined)}
                      onEditPrompt={setPrefill}
                    />
                    )}
                  </div>
                  {!atBottom ? (
                    <button
                      type="button"
                      onClick={jumpToLatest}
                      className="pressable absolute bottom-3 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-3 text-[11.5px] font-medium text-canvas shadow-overlay"
                      style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
                    >
                      {streaming ? t("Follow the stream") : t("Jump to latest")}
                    </button>
                  ) : null}
                  </div>
                  {/* the conversation's minimap, down the transcript's right edge */}
                  <SessionStrip messages={messages} onJump={jumpToTurn} />
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

                {composer}
                  </>
                )}
              </div>

              {/* the monitor is a column of the conversation area while the
                  window can afford three of them — it takes real width, so the
                  thread narrows instead of being covered. With the dock open or
                  a small window that column would leave the thread unusable, so
                  the same panel floats over the right edge instead. Either way
                  it is a pane, not a popover: only the toolbar button or its own
                  close puts it away. */}
              {monitorOpen ? (
                <Suspense fallback={null}>
                  <MonitorPanel
                    state={state}
                    messages={messages}
                    floating={dockOpen || viewportWidth < MONITOR_FLOAT_WIDTH}
                    onClose={() => setMonitorOpen(false)}
                    onOpenChanges={() => {
                      setDockTool("changes");
                      setDockOpen(true);
                    }}
                    onOpenDiff={openDockDiff}
                    onOpenFile={openDockFile}
                  />
                </Suspense>
              ) : null}

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
                  onUseModel={(provider, modelId) => void reportFailure(() => window.pi.setModel(provider, modelId))}
                  onSaveModel={(edit) => void runModelWrite(() => window.pi.saveModel(edit), t("Saved to models.json")).catch(() => undefined)}
                  onDeleteModel={(provider, modelId) =>
                    void runModelWrite(() => window.pi.deleteModel(provider, modelId), t("Removed from models.json")).catch(() => undefined)
                  }
                  onSetDefaultModel={(provider, modelId) =>
                    void window.pi.updateSettings({ defaultProvider: provider, defaultModel: modelId }).catch(() => undefined)
                  }
                  onReload={() => void window.pi.reload()}
                  onBack={() => setView("chat")}
                  onCreateRule={async (scope, name) => {
                    setPlugins(await window.pi.createRule(scope, name));
                  }}
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
                  onSaveModel={(edit) => runModelWrite(() => window.pi.saveModel(edit), t("Saved to models.json"))}
                  onDeleteModel={(provider, modelId) =>
                    runModelWrite(() => window.pi.deleteModel(provider, modelId), t("Removed from models.json"))
                  }
                  onSetEnabledModels={(keys) =>
                    runModelWrite(
                      () => window.pi.updateSettings({ enabledModels: keys }),
                      t("Model availability updated"),
                    )
                  }
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
          activeChange={activeChange}
          onOpenDiff={openDockDiff}
          onReveal={revealFile}
          onJumpToTurn={jumpToTurn}
          onOpenBrowser={openDockBrowser}
          onCloseFile={closeDockFile}
          buildModel={buildModel}
          onPlanAction={planAction}
          onFleetInterrupt={(name) => void window.pi.fleetInterrupt(name)}
          onAddToChat={addRefToChat}
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
        onSetModel={(provider, modelId) => void reportFailure(() => window.pi.setModel(provider, modelId))}
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

/** Placeholder lines while a conversation switch is in flight. */
function TranscriptSkeleton() {
  const widths = ["38%", "72%", "54%", "64%", "30%"];
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3" aria-hidden>
      {widths.map((width, index) => (
        <div
          key={index}
          className="h-4 rounded-[6px] bg-hover-2"
          style={{ width, animation: `fade-in 240ms ease-out ${index * 60}ms both` }}
        />
      ))}
    </div>
  );
}
