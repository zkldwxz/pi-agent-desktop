import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BrowserHost } from "./browser";

/**
 * The browser tool surface, as a **pi extension**.
 *
 * No MCP. Extensions are pi's own mechanism: `pi.registerTool()` adds tools the
 * model can call directly, and because the agent runs inside this Electron main
 * process, the tools call `BrowserHost` in the same address space — no socket,
 * no protocol layer, no serialization.
 *
 * If we ever need the *user's real Chrome* (real logins) instead of the embedded
 * view, only `getBrowser()` changes: point it at a host driving an external
 * target over CDP. The tool definitions stay identical.
 */

const SNAPSHOT_SCRIPT = String.raw`
(() => {
  const MAX = 240;
  const out = [];
  const walk = (el, depth) => {
    if (out.length >= MAX) return;
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "noscript", "svg", "path"].includes(tag)) return;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = el.getBoundingClientRect();
    const visible = rect.width > 1 && rect.height > 1;
    const interactive = el.matches("a,button,input,select,textarea,[role=button],[onclick]");
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 120);
    if (visible && (interactive || own)) {
      out.push({
        tag,
        text: own || (el.getAttribute("aria-label") || el.placeholder || el.value || "").slice(0, 120),
        id: el.id || undefined,
        testid: el.getAttribute("data-testid") || undefined,
        role: el.getAttribute("role") || (interactive ? tag : undefined),
        href: el.getAttribute("href") || undefined,
        box: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        depth,
      });
    }
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(document.body, 0);
  return {
    url: location.href,
    title: document.title,
    nodes: out,
    bodyText: (document.body.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 4000),
  };
})()`;

interface SnapshotNode {
  tag: string;
  text: string;
  id?: string;
  testid?: string;
  role?: string;
  href?: string;
  box: [number, number, number, number];
  depth: number;
}

interface Snapshot {
  url: string;
  title: string;
  nodes: SnapshotNode[];
  bodyText: string;
}

function formatSnapshot(snapshot: Snapshot): string {
  const lines = [`url: ${snapshot.url}`, `title: ${snapshot.title}`, "", "interactive + labelled nodes:"];
  for (const [index, node] of snapshot.nodes.entries()) {
    const bits = [`[${index}]`, `<${node.tag}>`];
    if (node.role && node.role !== node.tag) bits.push(`role=${node.role}`);
    if (node.testid) bits.push(`testid=${node.testid}`);
    if (node.id) bits.push(`#${node.id}`);
    if (node.href) bits.push(`href=${node.href}`);
    bits.push(`@${node.box.join(",")}`);
    if (node.text) bits.push(`"${node.text}"`);
    lines.push(bits.join(" "));
  }
  lines.push("", "visible text:", snapshot.bodyText);
  return lines.join("\n");
}

export function registerBrowserTools(pi: ExtensionAPI, getBrowser: () => BrowserHost | null): void {
  const require_ = () => {
    const browser = getBrowser();
    if (!browser) throw new Error("The desktop browser is not available.");
    return browser;
  };

  pi.registerTool({
    name: "browser_open",
    label: "Open in browser",
    description:
      "Open a URL in the app's embedded browser and return a snapshot of the page. This is the browser the user sees, so they can watch and take over.",
    parameters: Type.Object({
      url: Type.String({ description: "URL or bare host, e.g. localhost:5173" }),
    }),
    execute: async (_id, params) => {
      const browser = require_();
      await browser.setVisible(true);
      await browser.navigate(params.url);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const snapshot = (await browser.evaluate(SNAPSHOT_SCRIPT)) as Snapshot | { error: string };
      if (snapshot && "error" in snapshot) {
        return { content: [{ type: "text", text: `Failed to snapshot: ${snapshot.error}` }], details: {} as Record<string, unknown> };
      }
      return { content: [{ type: "text", text: formatSnapshot(snapshot as Snapshot) }], details: { url: (snapshot as Snapshot).url } as Record<string, unknown> };
    },
  });

  pi.registerTool({
    name: "browser_snapshot",
    label: "Browser snapshot",
    description:
      "Re-read the embedded browser: interactive nodes with their boxes and a visible-text digest. Use the [n] index with browser_click / browser_fill.",
    parameters: Type.Object({}),
    execute: async () => {
      const browser = require_();
      const snapshot = (await browser.evaluate(SNAPSHOT_SCRIPT)) as Snapshot | { error: string };
      if (snapshot && "error" in snapshot) {
        return { content: [{ type: "text", text: `Failed to snapshot: ${snapshot.error}` }], details: {} as Record<string, unknown> };
      }
      return { content: [{ type: "text", text: formatSnapshot(snapshot as Snapshot) }], details: {} as Record<string, unknown> };
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser click",
    description: "Click an element by CSS selector, by visible text, or by the [n] index from browser_snapshot.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS selector" })),
      text: Type.Optional(Type.String({ description: "visible text to match" })),
      index: Type.Optional(Type.Number({ description: "[n] index from browser_snapshot" })),
    }),
    execute: async (_id, params) => {
      const browser = require_();
      const script = String.raw`
(() => {
  const snapshot = ${SNAPSHOT_SCRIPT};
  const find = () => {
    ${params.index !== undefined ? `const nodes = snapshot().nodes; return nodes[${params.index}] ? document.elementFromPoint(nodes[${params.index}].box[0] + 2, nodes[${params.index}].box[1] + 2) : null;` : ""}
    ${params.selector ? `const el = document.querySelector(${JSON.stringify(params.selector)}); if (el) return el;` : ""}
    ${
      params.text
        ? `const needle = ${JSON.stringify(params.text)}.toLowerCase();
    const all = [...document.querySelectorAll('a,button,input,select,textarea,[role=button],label,li,span,div,p,h1,h2,h3')];
    return all.find((n) => (n.innerText || n.textContent || '').trim().toLowerCase().includes(needle)) || null;`
        : ""
    }
    return null;
  };
  const el = find();
  if (!el) return { ok: false, reason: "not found" };
  el.scrollIntoView({ block: "center" });
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const target = document.elementFromPoint(x, y) || el;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
  }
  return { ok: true, tag: el.tagName.toLowerCase(), text: (el.innerText || "").trim().slice(0, 80) };
})()`;
      const result = (await browser.evaluate(script)) as { ok: boolean; reason?: string; tag?: string; text?: string };
      await new Promise((resolve) => setTimeout(resolve, 400));
      const text = result?.ok
        ? `Clicked <${result.tag}>${result.text ? ` "${result.text}"` : ""}. Call browser_snapshot to see the result.`
        : `Click failed: ${result?.reason ?? "unknown"}.`;
      return { content: [{ type: "text", text }], details: (result ?? {}) as Record<string, unknown> };
    },
  });

  pi.registerTool({
    name: "browser_fill",
    label: "Browser fill",
    description: "Type a value into an input or textarea, matched by CSS selector or by the [n] index from browser_snapshot.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String()),
      index: Type.Optional(Type.Number()),
      value: Type.String(),
      submit: Type.Optional(Type.Boolean({ description: "press Enter after filling" })),
    }),
    execute: async (_id, params) => {
      const browser = require_();
      const script = String.raw`
(() => {
  const snapshot = ${SNAPSHOT_SCRIPT};
  let el = null;
  ${params.index !== undefined ? `const nodes = snapshot().nodes; const n = nodes[${params.index}]; if (n) el = document.elementFromPoint(n.box[0] + 2, n.box[1] + 2);` : ""}
  ${params.selector ? `if (!el) el = document.querySelector(${JSON.stringify(params.selector)});` : ""}
  if (!el) return { ok: false, reason: "not found" };
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, ${JSON.stringify(params.value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, tag: el.tagName.toLowerCase(), name: el.name || el.id || undefined };
})()`;
      const result = (await browser.evaluate(script)) as { ok: boolean; reason?: string; name?: string };
      if (result?.ok && params.submit) {
        await browser.evaluate(String.raw`
(() => {
  const el = document.activeElement;
  if (!el) return;
  for (const type of ["keydown", "keypress", "keyup"]) {
    el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
  }
  if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
})()`);
      }
      const text = result?.ok
        ? `Filled${result.name ? ` ${result.name}` : ""}${params.submit ? " and submitted" : ""}.`
        : `Fill failed: ${result?.reason ?? "unknown"}.`;
      return { content: [{ type: "text", text }], details: (result ?? {}) as Record<string, unknown> };
    },
  });

  pi.registerTool({
    name: "browser_find",
    label: "Find in page",
    description: "Search the embedded browser's visible text and return the matching lines with surrounding context.",
    parameters: Type.Object({
      query: Type.String(),
      contextLines: Type.Optional(Type.Number({ description: "lines of context, default 2" })),
    }),
    execute: async (_id, params) => {
      const browser = require_();
      const context = params.contextLines ?? 2;
      const script = String.raw`
(() => {
  const needle = ${JSON.stringify(params.query)}.toLowerCase();
  const lines = (document.body.innerText || "").split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (!line.toLowerCase().includes(needle)) return;
    const from = Math.max(0, i - ${context});
    const to = Math.min(lines.length, i + ${context} + 1);
    hits.push({ line: i + 1, text: lines.slice(from, to).join("\n") });
  });
  return { total: hits.length, hits: hits.slice(0, 12) };
})()`;
      const result = (await browser.evaluate(script)) as { total: number; hits: { line: number; text: string }[] };
      if (!result?.total) {
        return { content: [{ type: "text", text: `No match for "${params.query}".` }], details: {} as Record<string, unknown> };
      }
      const body = result.hits.map((hit) => `line ${hit.line}:\n${hit.text}`).join("\n---\n");
      return {
        content: [{ type: "text", text: `${result.total} match(es) for "${params.query}":\n\n${body}` }],
        details: {} as Record<string, unknown>,
      };
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser screenshot",
    description:
      "Capture the embedded browser as an image and return it, so you can actually look at the result. Optionally crop to a CSS selector.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "crop to this element" })),
    }),
    execute: async (_id, params) => {
      const browser = require_();
      const image = await browser.screenshot(params.selector);
      if (!image) {
        return { content: [{ type: "text", text: "Screenshot failed — nothing loaded, or the element was not found." }], details: {} as Record<string, unknown> };
      }
      return {
        content: [
          { type: "text", text: params.selector ? `Screenshot of ${params.selector}.` : "Screenshot of the current page." },
          { type: "image", data: image.data, mimeType: "image/png" },
        ],
        details: { bytes: image.data.length } as Record<string, unknown>,
      };
    },
  });

  pi.registerTool({
    name: "browser_design_pick",
    label: "Design pick",
    description:
      "Ask the user to click an element in the embedded browser with design mode. Returns the selector, React component, computed styles, ancestry chain, and a cropped screenshot of that element. Use this whenever a UI change should be anchored to a specific component.",
    parameters: Type.Object({
      hint: Type.Optional(Type.String({ description: "what to tell the user to pick" })),
    }),
    execute: async (_id, params) => {
      const browser = require_();
      const pick = await browser.pickOne(params.hint);
      if (!pick) {
        return { content: [{ type: "text", text: "The user cancelled the pick." }], details: {} as Record<string, unknown> };
      }
      const lines = [
        `element: ${pick.component ? `${pick.component} · ` : ""}${pick.tag}`,
        `selector: ${pick.selector}`,
        `box: ${pick.rect.width}×${pick.rect.height} at (${pick.rect.x}, ${pick.rect.y})`,
        `page: ${pick.page.url}`,
      ];
      if (pick.text) lines.push(`text: ${pick.text}`);
      const styles = Object.entries(pick.styles).slice(0, 14);
      if (styles.length) lines.push("styles:", ...styles.map(([k, v]) => `  ${k}: ${v}`));
      if (pick.ancestry.length > 1) {
        lines.push(`ancestry: ${pick.ancestry.map((n) => (n.component ? `${n.component}(${n.tag})` : n.tag)).join(" > ")}`);
      }
      const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
        { type: "text", text: lines.join("\n") },
      ];
      const shot = pick.screenshot?.match(/^data:([^;]+);base64,(.+)$/);
      if (shot) content.push({ type: "image", data: shot[2], mimeType: shot[1] });
      return { content, details: { selector: pick.selector, component: pick.component } as Record<string, unknown> };
    },
  });
}
