import { useMemo } from "react";
import type { HostState } from "@shared/types";
import { t, tf, useLocale } from "../lib/i18n";
import Flowchart, { type StepNode } from "../components/beautiful/primitives/Flowchart";

/** Tools this desktop registers, and what they belong to. */
const BUILTIN = [
  { id: "ext-browser", label: "pi-desktop-browser", prefix: "browser_" },
  { id: "ext-todos", label: "pi-desktop-todos", prefix: "todo_" },
];

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

/**
 * How this session can act.
 *
 * A flowchart of what is actually wired: the agent, the extensions this desktop
 * registers, the tools they expose (read live from the session), and the
 * project directory the built-in tools operate on.
 *
 * It is not decorative — add an extension to `~/.pi/agent/extensions/` and a new
 * branch appears here after a rescan.
 */
export function ExtensionFlow({ state }: { state: HostState }) {
  const locale = useLocale();
  const nodes = useMemo<StepNode[]>(() => {
    const tools = state.tools;
    const builtin = tools.filter((name) => !BUILTIN.some((ext) => name.startsWith(ext.prefix)));

    const out: StepNode[] = [
      { id: "agent", row: 0, x: 0.5, w: 0.34, hue: "var(--accent)", title: t("Pi agent"), caption: t("this session") },
    ];

    const extensions = BUILTIN.map((ext) => ({
      ...ext,
      tools: tools.filter((name) => name.startsWith(ext.prefix)),
    })).filter((ext) => ext.tools.length);

    // one column per extension, plus one for the built-ins
    const columns = extensions.length + (builtin.length ? 1 : 0);
    const width = Math.min(0.34, 0.94 / Math.max(1, columns));
    const step = columns > 1 ? 0.94 / columns : 0;

    extensions.forEach((ext, index) => {
      const x = columns > 1 ? 0.03 + step * (index + 0.5) : 0.5;
      out.push({
        id: ext.id,
        row: 1,
        x,
        w: width,
        hue: "var(--green)",
        title: ext.label,
        caption: tf(ext.tools.length === 1 ? "{count} tool" : "{count} tools", { count: ext.tools.length }),
      });
      out.push({
        id: `${ext.id}-tools`,
        row: 2,
        x,
        w: width,
        title: ext.tools.join(", "),
        caption: t("registered"),
      });
    });

    if (builtin.length) {
      const index = extensions.length;
      const x = columns > 1 ? 0.03 + step * (index + 0.5) : 0.5;
      out.push({
        id: "builtin",
        row: 1,
        x,
        w: width,
        hue: "var(--ink-3)",
        title: t("built-in tools"),
        caption: `${builtin.length}`,
      });
      out.push({
        id: "builtin-tools",
        row: 2,
        x,
        w: width,
        title: builtin.join(", "),
        caption: baseName(state.cwd),
      });
    }

    return out;
  }, [state.tools, state.cwd, locale]);

  const browserOn = state.tools.some((name) => name.startsWith("browser_"));
  const todosOn = state.tools.some((name) => name.startsWith("todo_"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-ui-caption text-ink-3">
          {tf("{count} tools available · capabilities are switched in Settings → Customize", { count: state.tools.length })}
        </span>
        {!browserOn ? (
          <span className="rounded-chip bg-orange-tint px-2 py-0.5 text-ui-sm text-orange">{t("browser off")}</span>
        ) : null}
        {!todosOn ? (
          <span className="rounded-chip bg-orange-tint px-2 py-0.5 text-ui-sm text-orange">{t("task list off")}</span>
        ) : null}
      </div>
      <div className="overflow-x-auto pb-1">
        <Flowchart steps={nodes} />
      </div>
    </div>
  );
}
