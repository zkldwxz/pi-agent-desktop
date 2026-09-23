import hljs from "highlight.js/lib/core";

/* ─────────────────────────────────────────────────────────
 * SYNTAX HIGHLIGHTING
 *
 * GitHub's own colours, applied by highlight.js.
 *
 * Three decisions worth keeping:
 *
 *  · **Explicit languages, not autodetect.** Autodetect runs every registered
 *    grammar against the text and scores them; on a 400-line listing that is
 *    tens of milliseconds for a result the fence already told us. `hljs.highlight`
 *    with a known language is a single pass.
 *
 *  · **Synchronous, with a memo.** highlight.js is a pure function of
 *    (code, language), so the second render of a block is a Map lookup. Async
 *    highlighters (shiki and friends) would put a promise between a streamed
 *    token and its colour, which flickers on exactly the code being typed.
 *
 *  · **A bounded cache.** A long session accumulates many blocks; the cap keeps
 *    the map from growing without limit while still holding a whole transcript.
 * ───────────────────────────────────────────────────────── */

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  markdown,
  php,
  plaintext,
  python,
  r,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

let registered = false;
function ensureRegistered() {
  if (registered) return;
  registered = true;
  for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition);
  // the aliases a fence is actually likely to carry
  hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
  hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
  hljs.registerAliases(["sh", "zsh", "console"], { languageName: "bash" });
  hljs.registerAliases(["html", "svg", "vue"], { languageName: "xml" });
  hljs.registerAliases(["yml"], { languageName: "yaml" });
  hljs.registerAliases(["toml", "conf"], { languageName: "ini" });
  hljs.registerAliases(["ps", "ps1", "powershell"], { languageName: "bash" });
  hljs.registerAliases(["patch"], { languageName: "diff" });
  hljs.registerAliases(["py"], { languageName: "python" });
  hljs.registerAliases(["rb"], { languageName: "ruby" });
  hljs.registerAliases(["rs"], { languageName: "rust" });
  hljs.registerAliases(["md"], { languageName: "markdown" });
}

/** Fences that name no language, or one we do not carry, render as plain text. */
const FALLBACK = new Set(["", "text", "txt", "plain", "plaintext", "snippet", "output", "log", "none", "unknown"]);

const CACHE_LIMIT = 600;
const cache = new Map<string, string>();

function keyFor(code: string, language: string): string {
  return `${language}\u0000${code}`;
}

/** Drop the oldest quarter when the cache is full; Map preserves insertion order. */
function evict() {
  let dropped = 0;
  const target = Math.ceil(CACHE_LIMIT / 4);
  for (const key of cache.keys()) {
    cache.delete(key);
    dropped += 1;
    if (dropped >= target) break;
  }
}

/**
 * Highlight one block and return its inner HTML.
 *
 * `highlight.js` is asked for the *inner* form so the caller keeps ownership of
 * the `<pre>`/`<code>` wrapper, the line-number gutter and the wrapping rules.
 * Returns `null` when the language is unknown, so callers can fall back to
 * rendering the raw text themselves.
 */
export function highlightCode(code: string, language: string): string | null {
  if (!code) return null;
  const lang = (language || "").toLowerCase();
  if (FALLBACK.has(lang)) return null;

  /* Register first, then look up. `highlight.js/lib/core` starts with no
     grammars at all — not even the aliases — so asking before this ran made
     the check below fail for *every* language and the whole app rendered
     monochrome, with the GitHub theme shipped but never applied. */
  ensureRegistered();
  if (!hljs.getLanguage(lang)) return null;

  const key = keyFor(code, lang);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let html: string;
  try {
    html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
  if (cache.size >= CACHE_LIMIT) evict();
  cache.set(key, html);
  return html;
}

/** True when this language will actually produce colours. */
export function canHighlight(language: string): boolean {
  const lang = (language || "").toLowerCase();
  if (FALLBACK.has(lang)) return false;
  ensureRegistered();
  return Boolean(hljs.getLanguage(lang));
}
