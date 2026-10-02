import { memo, useMemo } from "react";
import ToolChips, {
  type ToolDiff,
  type ToolDiffLine,
  type ToolStep,
} from "../beautiful/primitives/ToolChips";
import { CheckIcon, LoaderIcon } from "../icons";
import { tf } from "../../lib/i18n";
import { groupRuns, toolDetailLines, type ToolGroupView, type ToolRun } from "../../lib/agent-view";

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
export const AgentToolRun = memo(function AgentToolRun({ runs }: { runs: ToolRun[] }) {
  const groups = useMemo(() => groupRuns(runs), [runs]);
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
});

function GroupChips({ group, defaultOpen }: { group: ToolGroupView; defaultOpen: boolean }) {
  const steps: ToolStep[] = group.runs.map((run) => ({
    id: run.toolCallId || `${run.toolName}-${run.chip}`,
    icon: run.icon,
    label: run.label,
    chip: run.chip,
    mono: run.mono,
    detailMono: run.detailMono,
    detail: toolDetailLines(run),
    status: run.status,
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
            {/* The arc does not simply vanish when the batch lands — it is
                replaced by a check, which is the only thing that says "this
                finished" as opposed to "this was never running". */}
            {group.running ? (
              <LoaderIcon size={11} className="spin-fast shrink-0 text-accent" />
            ) : (
              <CheckIcon
                size={11}
                className="shrink-0 text-ink-3"
                style={{ animation: "pop-in 260ms var(--ease-out-strong-css) both" }}
              />
            )}
            {/* live labels sweep instead of sitting still — the loader above
                says "busy", this says "still working on it" */}
            {group.running ? <span className="shimmer-text">{group.label}</span> : <span>{group.label}</span>}
            {/* the call count rides along even when the kind already carries
                its own tally — the one number that answers "how much work was
                this". Skipped when the label's ×N already is that number. */}
            {group.runs.length > 1 && !group.label.includes(`×${group.runs.length}`) ? (
              <span className="shrink-0 text-ink-3 tabular-nums">
                · {tf("{count} calls", { count: group.runs.length })}
              </span>
            ) : null}
            {group.add || group.del ? (
              <span className="font-mono text-ui-sm tabular-nums">
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
