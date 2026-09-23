import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import type { PlanStep } from "./state.ts";

/**
 * Plan artifacts.
 *
 * A plan lives in the repository (`<cwd>/.pi/plans/<slug>.md`) because it is
 * work product the user should be able to read, diff and keep — not a chat
 * message. When the project folder is not writable the plan falls back to the
 * agent directory, and when neither is (a locked-down checkout, a read-only
 * home) it lands in the system temp folder: the desktop reads the plan back
 * from this path, so a plan with *some* file keeps its review card and its
 * Build button instead of degrading to state nobody can open.
 */

export function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "plan";
}

function render(title: string, steps: PlanStep[], body: string | undefined, model: string | undefined): string {
	const lines = [
		`# ${title}`,
		"",
		`_Written by plan mode · ${new Date().toISOString()}${model ? ` · ${model}` : ""}_`,
		"",
		"## Steps",
		"",
	];
	steps.forEach((step, index) => {
		lines.push(`${index + 1}. ${step.label}`);
		if (step.detail) lines.push(`   - ${step.detail}`);
	});
	if (body?.trim()) lines.push("", "## Notes", "", body.trim());
	lines.push("");
	return lines.join("\n");
}

/** Write the plan, never overwriting an existing one. Returns the path. */
export async function writePlanFile(
	cwd: string,
	title: string,
	steps: PlanStep[],
	body: string | undefined,
	model: string | undefined,
): Promise<string> {
	const content = render(title, steps, body, model);
	const slug = slugify(title);
	const roots = [
		join(cwd, ".pi", "plans"),
		join(homedir(), ".pi", "agent", "plans"),
		join(tmpdir(), "pi-plans"),
	];
	let lastError: unknown;
	for (const root of roots) {
		try {
			await mkdir(root, { recursive: true });
		} catch (error) {
			lastError = error;
			continue;
		}
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const name = attempt === 0 ? `${slug}.md` : `${slug}-${attempt + 1}.md`;
			const file = join(root, name);
			try {
				await writeFile(file, content, { encoding: "utf8", flag: "wx" });
				return file;
			} catch (error) {
				lastError = error;
				/* EEXIST means the slug is taken — try the next one. Anything
				 * else (permissions, a missing drive) moves to the fallback. */
				if ((error as { code?: string })?.code !== "EEXIST") break;
			}
		}
	}
	throw lastError instanceof Error ? lastError : new Error("Could not write the plan file.");
}
