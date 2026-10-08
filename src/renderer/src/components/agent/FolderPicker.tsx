import { lazy, Suspense, useEffect, useMemo, useState } from "react";
const WorkspaceDialog = lazy(() => import("./WorkspaceDialog"));
import { CheckIcon, ChevronDownIcon, FolderIcon, FolderOpenIcon, GlobeIcon, HomeIcon, SearchIcon } from "../icons";
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
 * open the host paints a soft vignette at the view's edges (`onOpenChange`) so
 * the eye settles here; the menu itself stays above it, crisp and clickable.
 */
export function FolderPicker({
  cwd,
  homeDir,
  onOpenChange,
}: {
  cwd: string;
  homeDir: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState<"folders" | "ssh" | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  useEffect(() => { let active = true; void window.pi.getWorkspace().then((workspace) => { if (active) setWorkspaceName(workspace.sshId || workspace.folders.length > 1 ? workspace.name : ""); }).catch(() => {}); return () => { active = false; }; }, [cwd, manage]);
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
            .map(([path]) => path)
            .filter((path) => !sameFolder(path, homeDir)),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [homeDir, open]);

  const sameFolder = (left: string, right: string) => {
    if (!left || !right) return false;
    const normalizedLeft = left.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
    const normalizedRight = right.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
    const normalizedHome = homeDir.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
    if (normalizedLeft === "~") return normalizedRight === normalizedHome;
    if (normalizedRight === "~") return normalizedLeft === normalizedHome;
    return normalizedLeft === normalizedRight;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter(
      (path) =>
        (sameFolder(path, homeDir) ? t("Home") : folderName(path) || path).toLowerCase().includes(q) ||
        path.toLowerCase().includes(q),
    );
  }, [folders, homeDir, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const startFreshAt = async (path: string) => {
    await window.pi.setCwd(path);
    await window.pi.newSession();
  };

  const pick = (path?: string) => {
    close();
    if (!path) return;
    void startFreshAt(path).catch(() => undefined);
  };

  const displayName = workspaceName || (sameFolder(cwd, homeDir) ? t("Home") : folderName(cwd) || cwd || t("No workspace"));

  return (
    <span className="relative inline-block" data-folder-picker>
      <button
        type="button"
        data-popover-trigger
        aria-expanded={open}
        aria-label={t("Change folder")}
        onClick={() => setOpen((value) => !value)}
        className="mx-2 inline-flex items-baseline gap-[1px] rounded-tiny font-semibold text-ink underline decoration-line-strong decoration-1 underline-offset-[3px] transition-colors duration-150 hover:decoration-ink-3"
      >
        <span className="max-w-[240px] truncate">{displayName}</span>
        <ChevronDownIcon
          size={13}
          className="shrink-0 self-center text-ink-3 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <Popover open={open} onClose={close} anchor="bottom-left" className="w-72 p-1">
        <div className="mb-1 flex h-8 items-center gap-1.5 rounded-chip bg-field px-2 text-ink-3 shadow-hairline">
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
            className="min-w-0 flex-1 bg-transparent text-ui-caption text-ink outline-none placeholder:text-ink-4"
          />
        </div>

        <div className="flex flex-col">
          {filtered.map((path) => {
            const current = sameFolder(path, cwd);
            const isHome = sameFolder(path, homeDir);
            return (
              <button
                key={path}
                type="button"
                data-row
                onClick={() => pick(path)}
                title={path}
                className="glide-row pressable flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left"
              >
                {isHome ? (
                  <HomeIcon size={13} className="shrink-0 text-ink-3" />
                ) : (
                  <FolderIcon size={13} className="shrink-0 text-ink-3" />
                )}
                <span className={`min-w-0 flex-1 truncate text-ui-caption ${current ? "text-ink" : "text-ink-2"}`}>
                  {isHome ? t("Home") : folderName(path) || path}
                </span>
                {current ? <CheckIcon size={13} className="shrink-0 text-ink" /> : null}
              </button>
            );
          })}
          {query.trim() && !filtered.length ? (
            <div className="px-2 py-1.5 text-ui-sm text-ink-3">{t("No folders found")}</div>
          ) : null}

          <div className="my-1 border-t border-line" />
          {/* the records above are the fast path; the OS picker is the last
              resort, two clicks deep instead of the first thing you meet */}
          <button
            type="button"
            data-row
            onClick={() => {
              close();
              void (async () => {
                const next = await window.pi.pickCwd();
                if (next) await window.pi.newSession();
              })().catch(() => undefined);
            }}
            className="glide-row pressable flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left"
          >
            <FolderOpenIcon size={13} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate text-ui-caption text-ink">{t("New workspace")}</span>
          </button>
          <button type="button" data-row onClick={() => { close(); setManage("folders"); }} className="glide-row pressable flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left">
            <span className="min-w-0 flex-1 truncate text-ui-caption text-ink">{t("Manage workspace folders")}</span>
          </button>
          <button
            type="button"
            data-row
            onClick={() => { close(); setManage("ssh"); }}
            className="glide-row pressable flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left"
          >
            <GlobeIcon size={13} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate text-ui-caption text-ink">{t("New SSH connection")}</span>
          </button>
          <button
            type="button"
            data-row
            onClick={() => {
              close();
              void startFreshAt(homeDir).catch(() => undefined);
            }}
            className="glide-row pressable flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left"
          >
            <HomeIcon size={13} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate text-ui-caption text-ink">{t("Home")}</span>
          </button>
        </div>
      </Popover>
      {manage ? <Suspense fallback={null}><WorkspaceDialog initialTab={manage} onClose={() => setManage(null)} /></Suspense> : null}
    </span>
  );
}
