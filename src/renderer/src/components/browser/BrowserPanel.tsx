import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrowserState, DesignPick } from "@shared/browser";
import type { ChatMessage } from "@shared/types";
import { DesignPickBar } from "../agent/DesignPickBar";
import { cn } from "../../lib/cn";
import { t, tf, useLocale } from "../../lib/i18n";
import { formatChord, useShortcuts } from "../../lib/keybindings";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  EyeIcon,
  GlobeIcon,
  PencilIcon,
  RefreshIcon,
  SquareStopIcon,
  TerminalIcon,
  XIcon,
} from "../icons";

const EMPTY: BrowserState = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  devtoolsOpen: false,
  designMode: false,
};

function displayUrl(url: string): string {
  if (!url) return "";
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * The embedded browser.
 *
 * The page itself is a native `WebContentsView` owned by the main process — it
 * composites *above* the renderer, so it cannot be styled or overlapped. All we
 * control is this chrome, plus a placeholder div whose rect we report so the
 * host can position the view over it.
 *
 * That is also why the top bar exists in the DOM at all: address bar, design
 * toggle, devtools toggle and the pick chips are ordinary React.
 */
export function BrowserPanel({
  state,
  expanded,
  onExpandedChange,
  designPick,
  recent,
  onAddToChat,
  onAskAbout,
  onClearPick,
  onClose,
  zoom,
}: {
  state: BrowserState;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** interface zoom — the native view's bounds are reported in DIPs */
  zoom?: number;
  designPick: DesignPick | null;
  /** recent messages, so the pick's mini-chat shows real history */
  recent: ChatMessage[];
  onAddToChat: (pick: DesignPick) => void;
  onAskAbout: (pick: DesignPick, instruction: string) => void;
  onClearPick: () => void;
  /** docked mode only: close the side pane */
  onClose?: () => void;
}) {
  const [draft, setDraft] = useState(displayUrl(state.url));
  useLocale();
  const chords = useShortcuts();
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const placeholderRef = useRef<HTMLDivElement>(null);
  const zoomProp = zoom;
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    // the panel owns the native view while mounted: show it, and hand it back
    // on unmount. Without the show call the view stayed hidden no matter what
    // bounds were reported — the browser "opened" onto an empty pane.
    void window.pi.setBrowserVisible(true);
    return () => {
      aliveRef.current = false;
      void window.pi.setBrowserVisible(false);
    };
  }, []);

  useEffect(() => {
    if (!editing) setDraft(displayUrl(state.url));
  }, [state.url, editing]);

  // Report the placeholder rect whenever layout changes; the host matches it.
  // The rect is in CSS pixels but the native view wants device-independent
  // pixels — with an interface zoom of z the two differ by exactly z, which is
  // what made the page frame land half a viewport off under a scaled UI.
  const syncBounds = useCallback(() => {

    const node = placeholderRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const zoom = zoomProp ?? window.pi.getZoomFactor?.() ?? 1;
    void window.pi.setBrowserBounds({
      x: Math.round(rect.left * zoom),
      y: Math.round(rect.top * zoom),
      width: Math.round(rect.width * zoom),
      height: Math.round(rect.height * zoom),
    });
  }, []);

  useLayoutEffect(() => {
    syncBounds();
    const node = placeholderRef.current;
    if (!node) return;
    const observer = new ResizeObserver(syncBounds);
    observer.observe(node);
    window.addEventListener("resize", syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [syncBounds, expanded]);

  /* a zoom change does not move the placeholder in CSS pixels, only in DIPs —
     nothing else fires for it, so it syncs from here */
  useLayoutEffect(() => {
    syncBounds();
  }, [syncBounds, zoomProp]);

  const navigate = (value?: string) => {
    const next = (value ?? draft).trim();
    if (!next) return;
    setEditing(false);
    void window.pi.navigateBrowser(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-page">
      {/* top bar — nav · address · design · devtools */}
      <div className="relative flex h-[48px] shrink-0 items-center gap-[8px] border-b border-line px-[12px]">
        <button
          type="button"
          aria-label="Back"
          disabled={!state.canGoBack}
          onClick={() => void window.pi.browserBack()}
          className="pressable flex size-[28px] shrink-0 items-center justify-center rounded-chip text-ink-2 hover:bg-hover disabled:opacity-35"
        >
          <ArrowUpIcon size={14} className="-rotate-90" />
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!state.canGoForward}
          onClick={() => void window.pi.browserForward()}
          className="pressable flex size-[28px] shrink-0 items-center justify-center rounded-chip text-ink-2 hover:bg-hover disabled:opacity-35"
        >
          <ArrowUpIcon size={14} className="rotate-90" />
        </button>
        <button
          type="button"
          aria-label={state.loading ? t("Stop") : t("Reload")}
          onClick={() => (state.loading ? void window.pi.browserStop() : void window.pi.browserReload())}
          className="pressable flex size-[28px] shrink-0 items-center justify-center rounded-chip text-ink-2 hover:bg-hover"
        >
          {state.loading ? <SquareStopIcon size={12} /> : <RefreshIcon size={14} />}
        </button>

        <div className="mx-[4px] flex h-[28px] min-w-0 flex-1 items-center gap-[8px] rounded-chip bg-field px-[10px] shadow-hairline">
          <span
            className={cn("size-1.5 shrink-0 rounded-full", state.error ? "bg-red" : state.loading ? "pulse-dot bg-accent" : "bg-green")}
          />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                navigate();
              }
              if (event.key === "Escape") {
                setEditing(false);
                setDraft(displayUrl(state.url));
              }
            }}
            placeholder="Enter a URL, or ask Pi to open one"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-ui-sm text-ink outline-none placeholder:text-ink-4"
          />
          {state.title ? (
            <span className="hidden max-w-52 shrink-0 truncate text-ui-sm text-ink-3 lg:inline">{state.title}</span>
          ) : null}
        </div>

        {designPick ? (
          <div
            className="flex items-center gap-1.5 rounded-chip bg-accent-tint px-2 py-1"
            style={{ animation: "pop-in 200ms var(--ease-out-strong-css) both", transformOrigin: "right center" }}
          >
            <span className="font-mono text-ui-xs text-accent-ink">
              {designPick.component ? `${designPick.component} · ` : ""}
              {designPick.tag}
            </span>
            <button
              type="button"
              onClick={() => onClearPick()}
              aria-label="Clear selection"
              className="pressable flex size-4 items-center justify-center rounded-tiny text-accent-ink hover:bg-accent/20"
            >
              <XIcon size={10} />
            </button>
          </div>
        ) : null}

        <button
          type="button"
          aria-label={t("Design mode")}
          title={tf("Design mode ({chord}) — pick an element and hand it to the agent", {
            chord: chords.designMode ? formatChord(chords.designMode) : "",
          })}
          onClick={() => void window.pi.setDesignMode(!state.designMode)}
          className={cn(
            "pressable flex size-[28px] shrink-0 items-center justify-center rounded-chip",
            state.designMode ? "bg-accent text-on-accent" : "text-ink-2 hover:bg-hover",
          )}
        >
          <PencilIcon size={14} />
        </button>
        <button
          type="button"
          aria-label={t("Toggle DevTools")}
          title="Toggle DevTools"
          onClick={() => void window.pi.toggleDevTools()}
          className={cn(
            "pressable flex size-[28px] shrink-0 items-center justify-center rounded-chip",
            state.devtoolsOpen ? "bg-field text-ink" : "text-ink-2 hover:bg-hover",
          )}
        >
          <TerminalIcon size={14} />
        </button>
        <button
          type="button"
          aria-label={expanded ? t("Return to the dock") : t("Open fullscreen")}
          title={expanded ? t("Return to the dock") : t("Open fullscreen")}
          onClick={() => onExpandedChange(!expanded)}
          className="pressable flex size-[28px] shrink-0 items-center justify-center rounded-chip text-ink-2 hover:bg-hover"
        >
          <EyeIcon size={14} />
        </button>
        {onClose ? (
          <button
            type="button"
            aria-label={t("Close browser")}
            title={t("Close browser")}
            onClick={onClose}
            className="pressable flex size-[28px] shrink-0 items-center justify-center rounded-chip text-ink-2 hover:bg-hover"
          >
            <XIcon size={14} />
          </button>
        ) : null}

        {/* loading progress — the native view composites above the page area,
            so it lives on the bar's bottom edge where it stays visible */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
          <span
            className="browser-progress block h-full w-1/3 rounded-full"
            style={{ opacity: state.loading ? 1 : 0 }}
          />
        </span>
      </div>

      {state.error ? (
        <div className="shrink-0 border-b border-red-tint bg-red-tint px-3 py-1.5 text-ui-sm text-red">{state.error}</div>
      ) : null}

      {/* the native view is positioned over this box */}
      <div ref={placeholderRef} className="relative min-h-0 flex-1">
        {!state.url ? (
          /* The reference's boot/empty shell: one 64px glyph at 30% opacity, then
             a title and a line of description, centred in a `max-w-sm` column
             nudged up 40px. Two bare centred lines said the same thing but read
             as an error state; the glyph is what makes it a state. */
          <div className="flex h-full flex-col items-center justify-center px-[24px]">
            <div className="flex max-w-sm flex-col items-center pb-[40px] text-center">
              <GlobeIcon size={64} className="mb-[24px] text-ink opacity-30" strokeWidth={1} />
              <div className="text-ui-base font-medium text-ink">{t("Nothing loaded")}</div>
              <p className="mt-[8px] text-ui-base leading-[21px] text-ink-3">
                Enter a URL above, or let Pi open one. The page renders in an embedded Chromium view — its own session, so site
                logins persist between restarts.
              </p>
            </div>
          </div>
        ) : null}

        {designPick ? (
          <DesignPickBar
            pick={designPick}
            recent={recent}
            onAction={(action, instruction) => onAskAbout(designPick, instruction ?? action)}
            onSend={(text) => onAskAbout(designPick, text)}
            onDismiss={onClearPick}
          />
        ) : null}
      </div>

      {!state.url ? (
        <div className="flex shrink-0 items-center gap-[8px] border-t border-line px-[12px] py-[8px] text-ui-sm text-ink-3">
          <ChevronDownIcon size={11} className="-rotate-90" />
          {tf("{chord} for design mode · the >_ button docks DevTools on the right", {
            chord: chords.designMode ? formatChord(chords.designMode) : t("Unassigned"),
          })}
        </div>
      ) : null}
    </div>
  );
}
