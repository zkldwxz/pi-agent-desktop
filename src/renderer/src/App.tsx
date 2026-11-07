import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, HostState, PlanAction, PluginInfo, ToolActivity, UsageStats } from "@shared/types";
import { MessageThread } from "./components/MessageThread";
import { TitleBar, TRAFFIC_LIGHTS_WIDTH, WindowControls } from "./components/TitleBar";
import { AgentComposer } from "./components/agent/AgentComposer";
import { AgentSidebar, type SidebarView } from "./components/agent/AgentSidebar";
import { FolderPicker } from "./components/agent/FolderPicker";
import { HOME_STEPS, Reveal, SuggestionRail } from "./components/agent/HomeReveal";
import { TerminalPanel } from "./components/panel/TerminalPanel";
import type { FileEntry } from "@shared/workspace";
import { cn } from "./lib/cn";
import { CONVERSATION_COLUMN } from "./lib/agent-view";
import { AlertIcon, GaugeIcon, ListChecksIcon, LoaderIcon, MessageIcon, PanelLeftIcon, TerminalIcon, XIcon } from "./components/icons";
import { Skeleton } from "./components/ui";
import { playDoneChime } from "./lib/sound";
import { t, tf, useLocale } from "./lib/i18n";
import { chordOf, matches, resolveEvent } from "./lib/keybindings";
import { IS_MAC } from "./lib/platform";
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
import { BrowserViewSkeleton, ViewSkeleton } from "./components/ViewSkeleton";
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
  homeDir: "",
  connected: false,
  sessions: [],
  models: [],
  providers: [],
  channels: [],
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
   *  re-thrown so the dialog that raised it can stay open with the work in it.
   *  The result comes back too: creating a channel answers with the provider ids
   *  it wrote, and the caller needs them to finish the model it came with. */
  const runModelWrite = useCallback(
    async <T,>(job: () => Promise<T>, done: string): Promise<T> => {
      try {
        const result = await job();
        pushNotice(done, "info");
        return result;
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
  /* 打断回答 vs 引导回答 — a setting now (智能体 page), persisted locally and
     applied to every send made while the agent is running */
  const [queueBehavior, setQueueBehaviorState] = useState<QueueBehavior>(
    () => (localStorage.getItem("pi-queue-behavior") as QueueBehavior) || "followUp",
  );
  const setQueueBehavior = (behavior: QueueBehavior) => {
    setQueueBehaviorState(behavior);
    try {
      localStorage.setItem("pi-queue-behavior", behavior);
    } catch {}
  };
  /** editing a queued message: its text sits in the composer, the row is gone */
  const [queueEditing, setQueueEditing] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const suppressScrollRef = useRef(false);
  /** follow the stream only while the reader is already at the bottom */
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  /** the transcript is remounted when the view key changes; remember where the reader was */
  const scrollMemoryRef = useRef(0);
  /** the turn the rail marks as current — see `syncActiveTurn` */
  const [activeTurn, setActiveTurn] = useState<string | undefined>(undefined);
  const scrollFrame = useRef(0);

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
      /* The host sends the transcript in the clear only when its settled part
         moved; while an answer streams it sends just that one message and says
         where it belongs. Splice at `at` rather than appending so a tail that
         lands after a full replacement still goes in the right place. */
      if (payload.messages) setMessages(payload.messages);
      else if (payload.tail) {
        const { at, messages: tail } = payload.tail;
        setMessages((current) => [...current.slice(0, at), ...tail]);
      }
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
  /** the account row's name, asked for at onboarding, defaulted to the OS user */
  const [userName, setUserName] = useState<string | undefined>(undefined);
  const refreshDesktopConfig = useCallback(async () => {
    try {
      const config = await window.pi.getDesktopConfig();
      setOnboarded(config.onboardingDone);
      setBuildModel(config.buildModel);
      setUserName(config.userName);
    } catch {}
  }, []);
  useEffect(() => {
    void refreshDesktopConfig();
  }, [refreshDesktopConfig]);

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

  /* nothing pulls the dock open on its own — not sub-agents, not a plan
     waiting for review: the right pane stays closed unless asked for. The
     composer's plan chip and the header's dock toggle are the ways in. */

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

  /* Which turn the rail marks as current.
   *
   * Scroll-driven, not an observer: the line is the scrollport's top plus a
   * fifth of its height (capped at 96px), and the current turn is the last one
   * whose top is above it — a binary search over the turn rows, which are in
   * document order. Parked at the bottom it is simply the latest turn, which is
   * what "following the stream" means everywhere else in this window. */
  const syncActiveTurn = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const rows = node.querySelectorAll<HTMLElement>("[data-turn]");
    if (!rows.length) return;
    const latest = rows[rows.length - 1].dataset.turn;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 80) {
      setActiveTurn((current) => (current === latest ? current : latest));
      return;
    }
    const line = node.getBoundingClientRect().top + Math.min(96, node.clientHeight * 0.2);
    let low = 0;
    let high = rows.length - 1;
    let found = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (rows[mid].getBoundingClientRect().top <= line) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const key = rows[found]?.dataset.turn;
    if (key) setActiveTurn((current) => (current === key ? current : key));
  }, []);

  /** Distance from the bottom, in px — the threshold that counts as "at the bottom". */
  const onTranscriptScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const near = distance < 80;
    stickRef.current = near;
    scrollMemoryRef.current = node.scrollTop;
    setAtBottom(near);
    /* the rail's current mark follows the same event, one frame later: a binary
       search over the turn rows is cheap, but not per scroll packet */
    if (scrollFrame.current) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = 0;
      syncActiveTurn();
    });
  }, [syncActiveTurn]);

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

  const jumpToTurn = useCallback(
    (key: string) => {
      const node = scrollerRef.current;
      const target = node?.querySelector<HTMLElement>(`[data-turn="${key}"]`);
      if (!node || !target) return;
      suppressScrollRef.current = true;
      /* Instant, and landing the turn 24px below the top of the scrollport —
         the reference's own jump. A smooth `scrollIntoView` animated for most of
         a second on a long transcript and parked the turn flush against the
         edge, where its hover controls sit on the first line of text. */
      const top = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - 24;
      node.scrollTop = Math.max(0, top);
      stickRef.current = false;
      setAtBottom(false);
      syncActiveTurn();
      window.setTimeout(() => {
        suppressScrollRef.current = false;
      }, 80);
    },
    [syncActiveTurn],
  );

  /**
   * Hold the conversation column's width still while a side panel slides.
   *
   * The dock animates its own width, and every frame of that animation used to
   * re-flow the thread beside it: prose re-wraps, code blocks re-measure, the
   * column shifts — 26 relayouts in 280ms, which is what made opening and
   * closing the panel feel like the conversation was being shoved rather than
   * the panel arriving. ZCode locks its side pane's content width for exactly
   * this reason (`useAnimatedResizablePanel`), so the same trick is applied from
   * the other side: pin the column to the width it has *now*, let the panels
   * move, then release it once the slide is over and let one relayout happen.
   *
   * The pin is `null` except during a slide, and a real window resize clears it,
   * so a drag of the window edge still re-flows live the way it must.
   */
  const [lockedColumnWidth, setLockedColumnWidth] = useState<number | null>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = columnRef.current;
    if (!element) return;
    const from = element.getBoundingClientRect().width;
    if (from <= 0) return;
    setLockedColumnWidth(from);
    const timer = window.setTimeout(() => setLockedColumnWidth(null), 300);
    return () => window.clearTimeout(timer);
  }, [dockOpen, monitorOpen, browserDockOpen]);

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
  /** the folder switcher inside the greeting is open — a whisper of shade
   *  covers the view's edges so the eye settles on the switcher itself */
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

  /* the sidebar stands down for Settings (its own rail) and when collapsed */
  const sidebarShown = view !== "settings" && !sidebarCollapsed;

  /* what the header names: the conversation in the chat, the page elsewhere */
  const headerTitle =
    view === "chat"
      ? state.snapshot?.sessionName?.trim() ||
        messages.find((message) => message.role === "user")?.text.split("\n")[0]?.trim() ||
        t("New session")
      : view === "settings"
        ? t("Settings")
        : view === "customize"
          ? t("Customize")
          : "";

  // Every hook above this line: the onboarding gate below returns early, and a
  // hook declared after an early return changes the hook count between renders.
  if (onboarded === false) {
    return (
      <div className="relative flex h-screen flex-col overflow-hidden bg-page text-ink">
        <TitleBar />
        {/* the welcome screen has no working strip, so it keeps its own grab
            zone where the hidden macOS title bar used to be */}
        {IS_MAC ? <div aria-hidden className="titlebar-drag absolute inset-x-0 top-0 h-10" /> : null}
        <Suspense fallback={<ViewSkeleton />}>
          <WelcomeView onDone={() => void refreshDesktopConfig()} />
        </Suspense>
      </div>
    );
  }

/**
 * The command line a live terminal call is running.
 *
 * `args` arrives as `unknown` off the wire, so the shape is checked rather than
 * asserted — a call whose arguments never made it through should fall back to
 * the tool's own name, not render `[object Object]` in the chip.
 */
function terminalCommand(tool: ToolActivity): string {
  const args = tool.args;
  if (args && typeof args === "object" && "command" in args) {
    const command = (args as { command?: unknown }).command;
    if (typeof command === "string" && command.trim()) return command;
  }
  return tool.toolName;
}

  /**
   * A terminal call the agent is running right now — the prompt bar chip.
   *
   * Read from the live activity list, not from `state.tools`: that field is the
   * *catalogue* of tools the session exposes (`string[]`, what the model may
   * call), so looking a running call up in it yields tool names and no status.
   * The activities — the ones with an `args` to take the command from — are the
   * `tools` state the host streams alongside the transcript.
   */
  const runningTerminals = useMemo(
    () => tools.filter((tool) => /bash|terminal/i.test(tool.toolName) && tool.status === "running"),
    [tools],
  );

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
        setQueueEditing(false);
        /* Two desktop commands leave the conversation before pi sees them:
         * `/goal` sets the session's standing goal (carried by the system
         * prompt), `/btw` asks beside this conversation on its own session. */
        const slash = /^\/(goal|btw)\s*(.*)$/is.exec(text.trim());
        if (slash) {
          const [, command, rest] = slash;
          if (command === "goal") {
            void window.pi.setGoal(rest.trim() || null);
          } else if (rest.trim()) {
            void reportFailure(() => window.pi.asideAsk(rest.trim()));
          }
          return;
        }
        if (streaming) {
          void (queueBehavior === "steer" ? window.pi.steer(text) : window.pi.followUp(text));
          return;
        }
        void window.pi.prompt({ text });
      }}
      onSetThinking={(level) => void reportFailure(() => window.pi.setThinking(level))}
      onAbort={() => void window.pi.abort()}
      onSetModel={(provider, modelId) => void reportFailure(() => window.pi.setModel(provider, modelId))}
      onPlanAction={planAction}
      onOpenPlan={() => {
        setDockTool("plan");
        setDockOpen(true);
      }}
      runningTerminal={
        runningTerminals.length
          ? {
              count: runningTerminals.length,
              title: runningTerminals.map(terminalCommand).join("\n"),
            }
          : null
      }
      onOpenTerminal={() => {
        setDockTool("terminal");
        setDockOpen(true);
      }}
      editingQueued={queueEditing}
    />
  );

  return (
    /* baocode's agents window: the window is the sidebar's colour, the sidebar
       sits on it bare, and each working part is an island — a card of the page
       colour, radius 12, a 1px outline, 6px from the window's edges and from
       each other (lib/workspace/islands.dart). */
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      {/* Settings brings its own rail; a collapsed sidebar is gone entirely and
          its toggle moves into the card's header, beside the traffic lights. */}
      {sidebarShown ? (
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
          onSearch={() => setPaletteOpen(true)}
          userName={userName}
          onNewInWorkspace={(cwd) => {
            setView("chat");
            void (async () => {
              await window.pi.setCwd(cwd);
              await window.pi.newSession();
            })().catch(() => undefined);
          }}
          collapsed={false}
          onCollapsedChange={setSidebarCollapsed}
        />
      ) : null}
      <div className={cn("relative flex min-w-0 flex-1 py-1.5 pr-1.5", sidebarShown ? "" : "pl-1.5")}>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-window border border-line bg-page">
          {/* The card's header (ChatScreen.cardHeaderHeight, 30): the title and
              the actions keep to the conversation column, as baocode lays them;
              the traffic lights' room and the sidebar toggle sit at its left
              only while the sidebar is away. Off macOS the window buttons end
              the row when nothing is open beside the card. */}
          <header className="titlebar-drag relative flex h-[30px] shrink-0 items-center">
            {sidebarShown ? null : (
              <div className="absolute inset-y-0 left-0 flex items-center pl-2">
                {TRAFFIC_LIGHTS_WIDTH ? <div aria-hidden className="shrink-0" style={{ width: TRAFFIC_LIGHTS_WIDTH - 8 }} /> : null}
                {view === "settings" ? null : (
                  <button
                    type="button"
                    aria-label={t("Expand sidebar")}
                    title={t("Expand sidebar")}
                    onClick={() => setSidebarCollapsed(false)}
                    className="titlebar-no-drag pressable flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <span className="codicon codicon-layout-sidebar-left text-[16px]" aria-hidden />
                  </button>
                )}
              </div>
            )}
            <div
              className="flex h-full min-w-0 flex-1 items-center"
              style={{
                paddingLeft: sidebarShown ? 29 : TRAFFIC_LIGHTS_WIDTH + 34,
                paddingRight: !dockOpen && !IS_MAC ? 100 : 29,
              }}
            >
              <div className={cn("flex min-w-0 items-center gap-1", view === "chat" ? CONVERSATION_COLUMN : "w-full")}>
                <div className="min-w-0 flex-1 truncate text-ui-caption font-medium text-ink-2">
                  {headerTitle}
                </div>
                <div className="titlebar-no-drag flex shrink-0 items-center gap-0.5">
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
                      "pressable flex size-6 items-center justify-center rounded-[5px]",
                      monitorOpen ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
                    )}
                  >
                    <ListChecksIcon size={15} />
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
                      "pressable flex size-6 items-center justify-center rounded-[5px]",
                      dockOpen && dockTool === "terminal" ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
                    )}
                  >
                    <TerminalIcon size={15} />
                  </button>
                  <DockToggle open={dockOpen} onToggle={() => setDockOpen((value) => !value)} />
                </div>
              </div>
            </div>
            {!dockOpen ? (
              <div className="absolute inset-y-0 right-1.5 flex items-center">
                <WindowControls />
              </div>
            ) : null}
          </header>
          <div key={view} className="view-enter flex min-h-0 flex-1 flex-col">
            <Suspense fallback={<ViewSkeleton />}>
            {view === "browser" ? (
              /* its own fallback: the shared one is a dashboard skeleton, and the
                 browser is a bar over a page a native view paints */
              <Suspense fallback={<BrowserViewSkeleton />}>
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
              </Suspense>
            ) : null}

            {/* the code viewer lives in the dock — the centre is always the
                conversation; opening a file only widens the right pane */}

            {view === "chat" ? (
              <div className="relative flex min-h-0 flex-1">
              {/* the conversation container: thread, queue and composer all
                  measure against it */}
              <div
                ref={columnRef}
                className="@container/conversation relative flex min-w-0 flex-1 flex-col"
                style={{
                  ...(lockedColumnWidth === null ? {} : { width: lockedColumnWidth, flex: "0 0 auto" }),
                } as React.CSSProperties}
              >
                {/* no conversation header — Cursor runs the thread straight to
                    the top edge; the session name lives on its sidebar row and
                    the run state on the working indicator. A failed turn reads
                    at the bottom for the same reason: it is the last thing that
                    happened, not a banner over everything. */}

                {emptySession ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-20 transition-transform duration-150 @min-[1280px]/conversation:-translate-x-2">
                    {/* The folder switcher's focus field: shade at the edges of
                        the view only. It must not be a flat scrim — the popover
                        lives inside this view's stacking context, so anything
                        painted over the whole view covers the menu too, which
                        is exactly the blur-the-picker bug this replaced. A
                        vignette with a clear centre reads as focus while the
                        switcher and everything near it stay crisp and clickable. */}
                    {pickingFolder ? (
                      <div
                        aria-hidden
                        className="folder-scrim pointer-events-none fixed inset-0 z-20"
                        style={{ animation: "fade-in 220ms ease-out both" }}
                      />
                    ) : null}
                    <Reveal at={HOME_STEPS.greeting} className="-mt-6">
                      <div className="flex flex-col items-center">
                        <div className="text-ui-display font-semibold tracking-[-0.02em] text-ink">
                          {tf("Only Coding，First {platform}.", { platform: IS_MAC ? "macOS" : "Windows" })}
                        </div>
                      </div>
                    </Reveal>
                    {/* the greeting sentence: mostly dimmed copy, with the
                        folder name as the one crisp, bold, underlined link.
                        Same body size as the line above it — the two read as
                        one heading, not a heading and a caption. */}
                    <Reveal at={HOME_STEPS.question} className="mt-3 w-full">
                      {/* The picker renders block-level menu content; a paragraph
                          parent creates invalid nesting when the menu opens. */}
                      <div className="mx-auto max-w-[620px] text-center text-ui-display leading-[1.5] tracking-[-0.02em] text-ink-3">
                        {greetingBefore}
                        <FolderPicker cwd={state.cwd} homeDir={state.homeDir} onOpenChange={setPickingFolder} />
                        {greetingAfter}
                      </div>
                    </Reveal>
                    <Reveal at={HOME_STEPS.composer} className="mt-12 w-full">
                      <div className="flex w-full justify-center">{composer}</div>
                    </Reveal>
                    <SuggestionRail
                      at={HOME_STEPS.suggestions}
                      onPick={(text) => void window.pi.prompt({ text })}
                    />
                  </div>
                ) : (
                  <>
                <div className="relative min-h-0 flex-1">
                  {/* a session switch remounts the transcript with a soft
                      enter instead of the old conversation snapping out */}
                  <div
                    key={state.snapshot?.sessionFile ?? "new"}
                    ref={scrollerRef}
                    onScroll={onTranscriptScroll}
                    /* baocode's list: 24 gutters, 12 under the title row, 24
                       at the foot; the top 12px fade into the card's header,
                       just above where a stuck prompt card rests */
                    className="scrollbar-pill view-enter h-full overflow-y-auto px-6 pt-3 pb-6 [mask-image:linear-gradient(to_bottom,transparent,black_12px)]"
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
                      onEditPrompt={async (text, userIndex) => {
                        /* Editing a sent prompt steps the conversation back to
                           before it first. Without that the edited text is just
                           another turn appended after the old one, and the model
                           answers a question the transcript now holds twice. */
                        try {
                          const result = await window.pi.rewindTo(userIndex);
                          if (!result.cancelled) setPrefill(result.text || text);
                        } catch (error) {
                          pushNotice(error instanceof Error ? error.message : String(error), "error");
                        }
                      }}
                    />
                    )}
                  </div>
                  {/* The thread dissolves into the composer instead of being
                      hard-clipped by it. The reference achieves this by floating
                      the composer over the transcript and measuring its height;
                      ours has a variable-height composer plus a queue bar, a
                      minimap and a tool dock around it, so the fade is painted
                      on the scroller's own edge instead — same read, no layout
                      refactor. Parked at the bottom it stands down entirely:
                      the turn's closing row (copy, usage, cache share) is the
                      last thing on screen, and a gradient over it reads as a
                      rendering bug, not as depth. */}
                  {!atBottom ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
                      style={{ background: "linear-gradient(to top, var(--page) 45%, transparent)" }}
                    />
                  ) : null}
                  {!atBottom ? (
                    <button
                      type="button"
                      onClick={jumpToLatest}
                      className="pressable absolute bottom-3 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-3 text-ui-sm font-medium text-canvas shadow-overlay"
                      style={{ animation: "pop-in 200ms var(--ease-out-strong-css) both", transformOrigin: "bottom center" }}
                    >
                      {streaming ? t("Follow the stream") : t("Jump to latest")}
                    </button>
                  ) : null}
                  {/* The turn rail, in the gutter the transcript reserves for it:
                      12px clear of the 5px scrollbar, 28px wide, centred on the
                      band above the composer. It appears only once the column is
                      wide enough to have that gutter at all — below the
                      breakpoint the thread fills its box and a rail would sit on
                      the text. */}
                  <SessionStrip
                    messages={messages}
                    activeKey={activeTurn}
                    onJump={jumpToTurn}
                    className="absolute top-1/2 right-[17px] z-10 hidden max-h-[min(420px,calc(100%-64px))] -translate-y-1/2 @min-[864px]/conversation:block"
                  />
                  </div>

                {fatalError ? (
                  <div className="mx-6 mb-1 flex max-w-[640px] items-start gap-2 rounded-card bg-red-tint px-3 py-2 text-ui-caption leading-snug text-red">
                    <AlertIcon size={13} className="mt-px shrink-0" />
                    <span className="min-w-0 flex-1">{fatalError}</span>
                  </div>
                ) : null}

                {/* `/goal`: the standing goal, first above the composer —
                    whether the agent is working on it is the only state it
                    needs; clearing is one click, not a command */}
                {state.goal ? (
                  <div className="mx-6 mb-1 flex max-w-[640px] items-center gap-2 rounded-card bg-field px-3 py-1.5 text-ui-caption text-ink-2">
                    <GaugeIcon size={12} className={cn("shrink-0", streaming ? "text-accent" : "text-ink-3")} />
                    <span className="min-w-0 flex-1 truncate" title={state.goal}>
                      {state.goal}
                    </span>
                    <span className="shrink-0 text-ui-xs text-ink-4">{streaming ? t("Working") : t("Waiting")}</span>
                    <button
                      type="button"
                      onClick={() => void window.pi.setGoal(null)}
                      title={t("Clear goal")}
                      aria-label={t("Clear goal")}
                      className="pressable flex size-5 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
                    >
                      <XIcon size={11} />
                    </button>
                  </div>
                ) : null}

                <QueueBar
                  queue={state.queue}
                  onRemove={(kind, index) => void window.pi.removeQueued(kind, index)}
                  onClear={() => {
                    // pi only clears everything — put it back in the editor, the way Esc does
                    void window.pi.clearQueue().then((result) => {
                      if (result.texts.length) setPrefill(result.texts.join("\n"));
                    });
                  }}
                  onEdit={(kind, index, text) => {
                    // the row leaves the queue and becomes the composer's draft —
                    // the green 编辑中 strip says so until it is sent
                    setQueueEditing(true);
                    setPrefill(text);
                    void window.pi.removeQueued(kind, index);
                  }}
                  onSendNow={(kind, index, text) => {
                    setQueueEditing(false);
                    void window.pi.removeQueued(kind, index);
                    void window.pi.steer(text);
                  }}
                />

                {composer}
                  </>
                )}

                {/* `/btw`: the aside card — a question answered on its own
                    session, floating beside the conversation it never joined.
                    Follow-ups keep the card warm; closing it just hides it. */}
                {state.aside ? (
                  <aside
                    aria-label={t("Side question")}
                    className="animate-slide-in-right absolute right-4 bottom-4 z-40 flex max-h-[45%] w-[320px] flex-col overflow-hidden rounded-card bg-surface shadow-overlay"
                  >
                    <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-2">
                      <MessageIcon size={12} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate text-ui-xs text-ink-3" title={state.aside.question}>
                        {state.aside.question}
                      </span>
                      <button
                        type="button"
                        onClick={() => void window.pi.asideDismiss()}
                        title={t("Close")}
                        aria-label={t("Close")}
                        className="pressable flex size-5 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
                      >
                        <XIcon size={11} />
                      </button>
                    </div>
                    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
                      {state.aside.running ? (
                        <span className="flex items-center gap-2 text-ui-sm text-ink-3">
                          <LoaderIcon size={12} className="spin-fast shrink-0 text-accent" />
                          {t("Thinking")}…
                        </span>
                      ) : state.aside.error ? (
                        <span className="whitespace-pre-wrap text-ui-sm text-red">{state.aside.error}</span>
                      ) : (
                        <span className="whitespace-pre-wrap break-words text-ui-sm leading-relaxed text-ink-2">
                          {state.aside.answer}
                        </span>
                      )}
                    </div>
                  </aside>
                ) : null}
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
                  onUpdateSettings={(patch) => void window.pi.updateSettings(patch).catch(() => undefined)}
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
                  onCreateChannel={(edit) =>
                    runModelWrite(() => window.pi.createChannel(edit), t("Channel written to models.json"))
                  }
                  onRemoveChannel={(channelId) =>
                    runModelWrite(() => window.pi.removeChannel(channelId), t("Channel removed"))
                  }
                  onAddChannelKey={(channelId, key) =>
                    runModelWrite(
                      () => window.pi.addChannelKey(channelId, key).then(() => undefined),
                      t("Key added"),
                    )
                  }
                  onRemoveChannelKey={(providerId) =>
                    runModelWrite(() => window.pi.removeChannelKey(providerId), t("Key removed"))
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
                  queueBehavior={queueBehavior}
                  onQueueBehavior={setQueueBehavior}
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
          windowControls={dockOpen ? <WindowControls /> : undefined}
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
      {widths.map((width) => (
        <Skeleton key={width} className="h-4" style={{ width }} />
      ))}
    </div>
  );
}
