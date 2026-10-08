import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import type { AppOpener } from "@shared/workspace";
import { ChevronDownIcon, FolderIcon } from "../icons";
import { openerName, t } from "../../lib/i18n";
import { IS_MAC } from "../../lib/platform";

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
 * The file manager's own mark, drawn for the platform whose file manager it is.
 *
 * The real icon comes from the application itself — `Explorer.exe` on Windows,
 * `Finder.app` on macOS (see `main/openers.ts`) — and these glyphs are the
 * stand-in drawn while that read is still in flight.
 *
 * The distinction has to be drawn here and not in the main process because the
 * fallback renders on the very first frame, before any IPC round trip. It was
 * Explorer's mark on both platforms, which is why macOS showed a stranger's
 * folder; the platform check is the whole point of the component.
 */
export function FileManagerGlyph({ size = 16 }: { size?: number }) {
  return IS_MAC ? <FinderGlyph size={size} /> : <ExplorerGlyph size={size} />;
}

/** Explorer's blue-front yellow folder, as Windows draws it. */
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
 * Finder's mark: the blue face with the white half, which is what a Mac user
 * reads as "open the file manager".
 *
 * Drawn rather than fetched so the button has a picture on its first frame — the
 * real icon comes out of `Finder.app`'s `.icns` (see `iconForOpeners` in
 * `main/openers.ts`) and replaces this the moment `listOpeners` answers. It is a
 * stand-in for that icon, so it follows it: the same rounded blue tile, the same
 * half-and-half face, dark eyes and smile.
 */
export function FinderGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="6.5" fill="#1E9BF0" />
      <rect x="3" y="3" width="26" height="13" rx="6.5" fill="#2CA5F2" />
      {/* the right half of the face is washed out, as the real mark's is */}
      <path d="M16 8h4.5A4.5 4.5 0 0 1 25 12.5v11A4.5 4.5 0 0 1 20.5 28H16V8Z" fill="#F4FBFF" />
      <path d="M11.4 12.6v3.6M20.6 12.6v3.6" stroke="#123C5C" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9.8 19.6c3.4 3.1 9 3.1 12.4 0" stroke="#123C5C" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/**
 * The titlebar's folder control: a split button.
 *
 * The main face is the file browser — the panel is where you actually look at
 * files, and reaching it should not take a menu first. It wears the mark of the
 * application folders are opened with: the platform's file manager until the
 * user picks another, and whatever they picked after that. The chevron is the escape hatch
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
      void window.pi.revealFile(cwd).catch(() => undefined);
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
      <div className="flex h-7 items-center rounded-control bg-field shadow-hairline">
        <button
          type="button"
          aria-label={t("Browse files")}
          title={mainTitle}
          disabled={!cwd}
          onClick={onBrowse}
          className="pressable flex h-full w-7 items-center justify-center rounded-l-control text-ink-2 hover:text-ink disabled:opacity-40"
        >
          {active?.icon ? (
            <img src={active.icon} alt="" className="size-[15px] rounded-tiny" />
          ) : active?.kind === "reveal" ? (
            <FileManagerGlyph size={15} />
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
          disabled={!cwd || openers?.length === 0}
          onClick={() => {
            const next = !open;
            setOpen(next);
            /* a fresh list every time it opens: an application installed a
             * minute ago should be in it */
            if (next) load();
          }}
          className="pressable flex h-full w-5.5 items-center justify-center rounded-r-control text-ink-3 hover:text-ink disabled:opacity-40"
        >
          <ChevronDownIcon size={10} />
        </button>
      </div>

      {open ? (
        <div
          className="absolute right-0 top-full z-40 mt-1.5 w-60 overflow-hidden rounded-control bg-surface py-1 shadow-overlay"
          style={{ animation: "pop-in 180ms var(--ease-out-strong-css) both", transformOrigin: "top right" }}
        >
          {openers === null ? (
            <div className="px-2.5 py-2 text-ui-sm text-ink-3">{t("Looking up apps…")}</div>
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
                    <img src={opener.icon} alt="" className="size-4 rounded-tiny" />
                  ) : opener.kind === "reveal" ? (
                    <FileManagerGlyph size={15} />
                  ) : (
                    <span className="size-1.5 rounded-full bg-line-strong" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-ui-caption text-ink">{openerName(opener)}</span>
                {picked === opener.id ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
