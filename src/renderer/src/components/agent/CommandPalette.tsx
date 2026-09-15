import { useEffect, useMemo } from "react";
import type { HostState } from "@shared/types";
import SearchList, { type SearchEntry } from "../beautiful/primitives/SearchList";
import { useFocusTrap } from "../motion";

/** Where the palette can send you. Browser and usage are panels inside these. */
export type PaletteView = "chat" | "customize" | "settings" | "browser";

/**
 * Command palette.
 *
 * `SearchList` is the Beautiful UI command search — field, live filtering,
 * glide-highlighted rows, empty state. We give it the real surface of the app:
 * slash commands the session exposes, sessions to switch to, models to swap,
 * views to jump to, and the app actions.
 *
 * Keyboard focus is moved by the list itself, which is what makes the shared
 * highlight glide for ↑↓ exactly like it does for the pointer.
 */
export function CommandPalette({
  open,
  state,
  onClose,
  onRun,
  onSwitchSession,
  onSetModel,
  onView,
  onPickCwd,
  onReload,
  onNewSession,
}: {
  open: boolean;
  state: HostState;
  onClose: () => void;
  onRun: (text: string) => void;
  onSwitchSession: (path: string) => void;
  onSetModel: (provider: string, modelId: string) => void;
  onView: (view: PaletteView) => void;
  onPickCwd: () => void;
  onReload: () => void;
  onNewSession: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const entries = useMemo<SearchEntry[]>(() => {
    const list: SearchEntry[] = [];

    list.push(
      { id: "act:new", label: "New session", hint: "Ctrl N", group: "Actions" },
      { id: "act:project", label: "Change project folder", hint: state.cwd, group: "Actions" },
      { id: "act:reload", label: "Reload agent resources", hint: "extensions, models, skills", group: "Actions" },
      { id: "act:usage", label: "Rescan usage", hint: "re-read session logs", group: "Actions" },
    );

    for (const command of state.commands) {
      list.push({
        id: `cmd:${command.name}`,
        label: `/${command.name}`,
        hint: command.description ?? command.source,
        group: "Commands",
      });
    }

    for (const session of state.sessions) {
      list.push({
        id: `session:${session.path}`,
        label: session.name || session.firstMessage || "New session",
        hint: session.status,
        group: "Sessions",
      });
    }

    for (const model of state.models) {
      list.push({
        id: `model:${model.provider}/${model.id}`,
        label: model.name,
        hint: `${model.provider} · ${model.contextWindow.toLocaleString()} ctx`,
        group: "Models",
      });
    }

    for (const [key, label] of [
      ["chat", "Transcript"],
      ["customize", "Customize — extensions, skills, rules, models"],
      ["settings", "Settings — theme, data, usage dashboards"],
      ["browser", "Browser"],
    ] as Array<[PaletteView, string]>) {
      list.push({ id: `view:${key}`, label: `Go to ${label}`, hint: "view", group: "Navigate" });
    }

    return list;
  }, [state.commands, state.models, state.sessions, state.cwd]);

  const trapRef = useFocusTrap(open);
  if (!open) return null;

  const run = (entry: SearchEntry) => {
    const [kind, ...rest] = entry.id.split(":");
    const value = rest.join(":");
    onClose();
    switch (kind) {
      case "act":
        if (value === "new") onNewSession();
        else if (value === "project") onPickCwd();
        else if (value === "reload") onReload();
        else if (value === "usage") onView("settings");
        break;
      case "cmd":
        onRun(`/${value} `);
        break;
      case "session":
        onSwitchSession(value);
        break;
      case "model": {
        const [provider, ...modelRest] = value.split("/");
        onSetModel(provider, modelRest.join("/"));
        break;
      }
      case "view":
        onView(value as PaletteView);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={trapRef}
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px] dark:bg-black/50"
        style={{ animation: "fade-in 180ms ease-out both" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[560px]"
        style={{ animation: "pop-in 220ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "top center" }}
      >
        <SearchList
          entries={entries}
          autoFocus
          labels={{
            placeholder: "Search commands, sessions, models…",
            ariaLabel: "Command palette",
            emptyTitle: "Nothing matches",
            emptyHint: "Try a command name, a session title, or a model",
          }}
          onSelect={run}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
