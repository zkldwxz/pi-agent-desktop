import type { DesignPick } from "@shared/browser";

/**
 * Design-mode context block.
 *
 * One pick becomes a compact, model-readable record. The cropped screenshot
 * travels alongside as an image attachment, so a vision model sees the element
 * itself and not just its styles.
 *
 * The block is plain text on purpose: it lands in the transcript as a normal
 * user message, which is what "记录保留到对话" means — it stays in the session
 * and compaction sees it like anything else.
 */
export function formatDesignPick(pick: DesignPick, instruction?: string, vision = true): string {
  const lines: string[] = [];
  if (instruction) lines.push(instruction, "");
  lines.push(
    `<design-pick source="${pick.page.url}">`,
    `element: ${pick.component ? `${pick.component} · ` : ""}${pick.tag}`,
    `selector: ${pick.selector}`,
    `box: ${pick.rect.width}×${pick.rect.height} at (${pick.rect.x}, ${pick.rect.y})`,
  );

  if (pick.text) lines.push(`text: ${pick.text}`);
  if (pick.mode === "region") lines.push("note: the user drew this region, it is not a single element");

  const styles = Object.entries(pick.styles);
  if (styles.length) {
    lines.push("styles:");
    for (const [key, value] of styles.slice(0, 18)) lines.push(`  ${key}: ${value}`);
  }

  if (pick.ancestry.length > 1) {
    lines.push("ancestry:");
    lines.push(
      `  ${pick.ancestry
        .map((node) => (node.component ? `${node.component}(${node.tag})` : node.tag) + (node.id ? `#${node.id}` : ""))
        .join(" > ")}`,
    );
  }

  lines.push(
    pick.screenshot
      ? vision
        ? "screenshot: attached (cropped to the element)"
        : "screenshot: available but NOT attached — the current model has no image input"
      : "screenshot: unavailable",
    "</design-pick>",
  );
  return lines.join("\n");
}

/** `data:image/png;base64,AAA` → the shape pi's prompt API wants. */
export function toImageAttachment(screenshot?: string): { type: "image"; data: string; mimeType: string }[] | undefined {
  if (!screenshot) return undefined;
  const match = /^data:([^;]+);base64,(.+)$/.exec(screenshot);
  if (!match) return undefined;
  return [{ type: "image", data: match[2], mimeType: match[1] }];
}
