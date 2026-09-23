import { useEffect, useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon, CircleSlashIcon, FolderIcon, FolderOpenIcon, GlobeIcon, SearchIcon } from "../icons";
import { Popover } from "../motion";
import { folderName } from "../../lib/format";
import { t } from "../../lib/i18n";

/**
 * The in-conversation folder selector for a fresh session.
 *
 * A new session opens in the folder of the last conversation; this inline name
 * in the greeting sentence is where it moves. Clicking it opens the switcher —
 * the recent-folder records first, never the OS dialog — and only "New
 * workspace" inside the menu brings up the system picker. While the menu is
 * open the rest of the greeting blurs (the host dims it via `onOpenChange`),
 * and everything comes back once a choice lands.
 */
export function FolderPicker({
  cwd,
  onOpenChange,
}: {
  cwd: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [folders, setFolders] = useState<string[]>([]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  /* the machine's recent folders, newest first — the switch records */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.pi
      .listAllSessions()
      .then((sessions) => {
        if (cancelled) return;
        const seen = new Map<string, number>();
        for (const session of sessions) {
          if (!session.cwd) continue;
          seen.set(session.cwd, Math.max(seen.get(session.cwd) ?? 0, Date.parse(session.modified) || 0));
        }
        setFolders(
          [...seen.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([path]) => path),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter(
      (path) => (folderName(path) || path).toLowerCase().includes(q) || path.toLowerCase().includes(q),
    );
  }, [folders, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const pick = (path?: string) => {
    close();
    if (!path || path === cwd) return;
    void window.pi.setCwd(path).catch(() => undefined);
  };

  const displayName = folderName(cwd) || cwd || t("No workspace");

  return (
    <span className="relative inline-block" data-folder-picker>
      <button
        type="button"
        data-popover-trigger
        aria-expanded={open}
        aria-label={t("Change folder")}
        onClick={() => setOpen((value) => !value)}
        className="mx-2 inline-flex items-baseline gap-[1px] rounded-[3px] font-semibold text-ink underline decoration-line-strong decoration-1 underline-offset-[3px] transition-colors duration-150 hover:decoration-ink-3"
      >
        <span className="max-w-[240px] truncate">{displayName}</span>
        <ChevronDownIcon
          size={13}
          className="shrink-0 self-center text-ink-3 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <Popover open={open} onClose={close} anchor="bottom-left" className="w-72 p-1">
        <div className="mb-1 flex h-8 items-center gap-1.5 rounded-[7px] bg-field px-2 text-ink-3 shadow-hairline">
          <SearchIcon size={12} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                pick(filtered[0]);
              }
            }}
            placeholder={t("Search folders…")}
            aria-label={t("Search folders")}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>

        <div className="flex flex-col">
          {filtered.map((path) => {
            const current = path === cwd;
            return (
              <button
                key={path}
                type="button"
                data-row
                onClick={() => pick(path)}
                title={path}
                className="glide-row pressable flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left"
              >
                <FolderIcon size={13} className="shrink-0 text-ink-3" />
                <span className={`min-w-0 flex-1 truncate text-[12.5px] ${current ? "text-ink" : "text-ink-2"}`}>
                  {folderName(path) || path}
                </span>
                {current ? <CheckIcon size={13} className="shrink-0 text-ink" /> : null}
              </button>
            );
          })}
          {query.trim() && !filtered.length ? (
            <div className="px-2 py-1.5 text-[11.5px] text-ink-3">{t("No folders found")}</div>
          ) : null}

          <div className="my-1 border-t border-line" />
          {/* the records above are the fast path; the OS picker is the last
              resort, two clicks deep instead of the first thing you meet */}
          <button
            type="button"
            data-row
            onClick={() => {
              close();
              void window.pi.pickCwd();
            }}
            className="glide-row pressable flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left"
          >
            <FolderOpenIcon size={13} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{t("New workspace")}</span>
          </button>
          <button
            type="button"
            data-row
            disabled
            title={t("SSH connections are coming soon")}
            className="glide-row flex h-8 w-full cursor-default items-center gap-2 rounded-[6px] px-2 text-left opacity-40"
          >
            <GlobeIcon size={13} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{t("New SSH connection")}</span>
            <span className="shrink-0 font-mono text-[9.5px] text-ink-3">soon</span>
          </button>
          <button
            type="button"
            data-row
            onClick={() => {
              close();
              void window.pi.setCwd("~").catch(() => undefined);
            }}
            className="glide-row pressable flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left"
          >
            <CircleSlashIcon size={13} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{t("No workspace")}</span>
          </button>
        </div>
      </Popover>
    </span>
  );
}
