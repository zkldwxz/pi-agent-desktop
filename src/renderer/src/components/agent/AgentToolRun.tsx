import { useMemo } from "react";
import ToolChips, {
  type ToolDiff,
  type ToolDiffLine,
  type ToolStep,
} from "../beautiful/primitives/ToolChips";
import { LoaderIcon } from "../icons";
import { buildToolGroups, type ToolGroupView, type ToolRun, type TurnView } from "../../lib/agent-view";

/**
 * The tool run, as one summary row per kind of work.
 *
 * A turn's calls are bucketed — exploration, file edits, everything else — and
 * consecutive calls of a bucket merge, so the transcript reads "Thought" →
 * "Explored · 12 files, ran 3 commands" → "Edited app.tsx ×3 +74 −41" → the
 * answer instead of fourteen `Read` rows. Every summary is collapsed once the
 * run settles and expands on click; inside it each call is still an expandable
 * row, and the edit group still carries its file-diff chips and hover preview.
 */
export function AgentToolRun({ turn }: { turn: TurnView }) {
  const groups = useMemo(() => buildToolGroups(turn), [turn]);
  if (!groups.length) return null;

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-1">
      {/* a group is open while one of its calls is still pending, and shuts the
          moment the last result lands — the run collapses itself */}
      {groups.map((group) => (
        <GroupChips key={group.key} group={group} defaultOpen={group.running} />
      ))}
    </div>
  );
}

function GroupChips({ group, defaultOpen }: { group: ToolGroupView; defaultOpen: boolean }) {
  const steps: ToolStep[] = group.runs.map((run) => ({
    id: run.toolCallId || `${run.toolName}-${run.chip}`,
    icon: run.icon,
    label: run.label,
    chip: run.chip,
    mono: run.mono,
    detailMono: run.detailMono,
    detail: run.detail.length ? run.detail : [{ text: run.status === "running" ? "running…" : "done" }],
  }));

  // ToolChips identifies a diff chip by its file string, so the string has to be
  // unique. A tool call whose arguments carry no path still needs a distinct
  // label, otherwise every such edit collapses onto the same key.
  const diffKey = (run: ToolRun, index: number) =>
    run.file ?? (run.add !== undefined || run.del !== undefined
      ? `${run.toolName} #${index + 1}`
      : run.chip);

  const byFile = new Map<string, ToolDiff>();
  group.runs.forEach((run, index) => {
    if (typeof run.add !== "number") return;
    const file = diffKey(run, index);
    const existing = byFile.get(file);
    byFile.set(file, {
      file,
      add: (existing?.add ?? 0) + run.add,
      del: (existing?.del ?? 0) + (run.del ?? 0),
    });
  });
  const diffs: ToolDiff[] = [...byFile.values()];

  const diffLines: Record<string, ToolDiffLine[]> = {};
  group.runs.forEach((run, index) => {
    if (!run.diffLines?.length) return;
    diffLines[diffKey(run, index)] = run.diffLines;
  });

  return (
    <ToolChips
      steps={steps}
      diffs={diffs}
      diffLines={diffLines}
      defaultOpen={defaultOpen}
      labels={{
        header: (
          <span className="flex items-center gap-1.5">
            {group.running ? <LoaderIcon size={11} className="spin-fast text-accent" /> : null}
            <span>{group.label}</span>
            {group.add || group.del ? (
              <span className="font-mono text-[11px] tabular-nums">
                <span className="text-green">+{group.add}</span>
                {group.del > 0 ? <span className="text-red"> −{group.del}</span> : null}
              </span>
            ) : null}
          </span>
        ),
        more: "",
      }}
      instant
    />
  );
}
