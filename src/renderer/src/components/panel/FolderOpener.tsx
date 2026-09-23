import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import type { AppOpener } from "@shared/workspace";
import { ChevronDownIcon, FolderIcon } from "../icons";
import { openerName, t } from "../../lib/i18n";

/** the last opener the user picked — the main button wears its mark */
const LAST_OPENER_KEY = "pi-last-folder-opener";

function lastOpener(): string | null {
  try {
    return localStorage.getItem(LAST_OPENER_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * The file manager's own mark — the blue-front yellow folder Explorer shows.
 * The real icon comes from `Explorer.exe` (see `main/openers.ts`); this is what
 * is drawn while that is still being read, and on platforms without it.
 */
export function ExplorerGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h7l3 3.5h10.5A2.5 2.5 0 0 1 28.5 11v2H3V7.5Z"
        fill="#FFB900"
      />
      <path
        d="M3 11h25.5a2 2 0 0 1 1.97 2.37l-2.02 11A2.5 2.5 0 0 1 26 26.5H6a2.5 2.5 0 0 1-2.47-2.13l-2.02-11A2 2 0 0 1 3.48 11Z"
        fill="#FFD75E"
      />
      <path
        d="M9.5 15.5h17l-1.6 8.4a1.5 1.5 0 0 1-1.48 1.1H6.8a1 1 0 0 1-.98-1.2l1.6-7.1a1.5 1.5 0 0 1 1.47-1.2Z"
        fill="#FFF4CE"
      />
      <path d="M10.5 18h13.5l-.5 2.5H10l.5-2.5Z" fill="#fff" opacity="0.55" />
    </svg>
  );
}

/**
 * The titlebar's folder control: a split button.
 *
 * The main face is the file browser — the panel is where you actually look at
 * files, and reaching it should not take a menu first. It wears the mark of the
 * application folders are opened with: the file manager until the user picks
 * another, and whatever they picked after that. The chevron is the escape hatch
 * to the outside: every application the OS has registered for folders (see
 * `main/openers.ts`), and picking one remembers it.
 */
export function FolderOpener({ cwd, onBrowse }: { cwd: string; onBrowse: () => void }) {
  const [open, setOpen] = useState(false);
  const [openers, setOpeners] = useState<AppOpener[] | null>(null);
  const [picked, setPicked] = useState<string | null>(lastOpener);
  const wrapper = useRef<HTMLDivElement>(null);

  /* The registry walk behind this list is what names the file manager and hands
   * over its icon, so it runs on mount rather than waiting for the menu to
   * open: until it lands the button has nothing to show. The main process caches
   * the answer, so re-opening the menu costs nothing. */
  const load = useCallback(() => {
    if (!cwd) return;
    void window.pi
      .listOpeners(cwd)
      .then((list) => setOpeners(list))
      .catch(() => undefined);
  }, [cwd]);

  useEffect(() => load(), [load]);

  /* the remembered opener, resolved against what the OS just reported */
  const active = useMemo(() => {
    const list = openers ?? [];
    return list.find((opener) => opener.id === picked) ?? list.find((opener) => opener.kind === "reveal") ?? null;
  }, [openers, picked]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const launch = async (opener: AppOpener) => {
    setOpen(false);
    setPicked(opener.id);
    try {
      localStorage.setItem(LAST_OPENER_KEY, opener.id);
    } catch {}
    if (opener.kind === "reveal") {
      void window.pi.revealFile(cwd);
      return;
    }
    void window.pi.openWith(cwd, opener.id).catch(() => undefined);
  };

  /* the icon says which application is remembered, so the tooltip says it too —
   * an icon on its own is a puzzle */
  const mainTitle = !cwd
    ? t("No workspace")
    : active && active.kind !== "reveal"
      ? `${t("Browse files")} · ${active.name}`
      : t("Browse files");

  return (
    <div ref={wrapper} className="relative flex items-center">
      {/* one capsule: the folder opens the file browser, the chevron picks the
          app — the two read as a single control, like the reference */}
      <div className="flex h-7 items-center rounded-[8px] bg-field shadow-hairline">
        <button
          type="button"
          aria-label={t("Browse files")}
          title={mainTitle}
          disabled={!cwd}
          onClick={onBrowse}
          className="pressable flex h-full w-7 items-center justify-center rounded-l-[8px] text-ink-2 hover:text-ink disabled:opacity-40"
        >
          {active?.icon ? (
            <img src={active.icon} alt="" className="size-[15px] rounded-[3px]" />
          ) : active?.kind === "reveal" ? (
            <ExplorerGlyph size={15} />
          ) : (
            <FolderIcon size={13} />
          )}
        </button>
        <span className="h-3.5 w-px shrink-0 bg-line-strong" />
        <button
          type="button"
          aria-label={t("Open with")}
          aria-expanded={open}
          title={t("Open with")}
          disabled={!cwd}
          onClick={() => {
            const next = !open;
            setOpen(next);
            /* a fresh list every time it opens: an application installed a
             * minute ago should be in it */
            if (next) load();
          }}
          className="pressable flex h-full w-5.5 items-center justify-center rounded-r-[8px] text-ink-3 hover:text-ink disabled:opacity-40"
        >
          <ChevronDownIcon size={10} />
        </button>
      </div>

      {open ? (
        <div
          className="absolute right-0 top-full z-40 mt-1.5 w-60 overflow-hidden rounded-[10px] bg-surface py-1 shadow-overlay"
          style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "top right" }}
        >
          {openers === null ? (
            <div className="px-2.5 py-2 text-[11.5px] text-ink-3">{t("Looking up apps…")}</div>
          ) : (
            openers.map((opener) => (
              <button
                key={opener.id}
                type="button"
                title={opener.command ?? openerName(opener)}
                onClick={() => void launch(opener)}
                className="pressable flex h-8 w-full items-center gap-2 px-2.5 text-left hover:bg-hover"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {opener.icon ? (
                    <img src={opener.icon} alt="" className="size-4 rounded-[3px]" />
                  ) : opener.kind === "reveal" ? (
                    <ExplorerGlyph size={15} />
                  ) : (
                    <span className="size-1.5 rounded-full bg-line-strong" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{openerName(opener)}</span>
                {picked === opener.id ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
