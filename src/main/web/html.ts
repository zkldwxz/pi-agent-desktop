/** A bounded, dependency-free HTML→text converter for the keyless fetch path.
 * It is intentionally conservative: it keeps headings, links, lists, tables and
 * preformatted text, drops active content, and never trusts structure beyond
 * what the tokenizer sees. Regexes are bounded by a capped input so a
 * pathological document cannot stall the event loop. */

export const CHALLENGE_ERROR = "The source returned a challenge or access-denied page; use another source.";

/** Marker list checked in the first 8 KiB. "Just a moment" and cf-chl are the
 * Cloudflare interstitials, the DDG markers its bot wall. */
const CHALLENGE_MARKERS = [
  "just a moment",
  "attention required",
  "checking your browser",
  "cf-chl",
  "cf_chl_opt",
  "verify you are human",
  "verifying you are human",
  "enable javascript and cookies to continue",
  "unusual traffic",
  "please complete the security check",
  "unfortunately, bots use duckduckgo",
  "anomaly-modal",
];

export function looksLikeChallenge(html: string): boolean {
  const head = html.slice(0, 8192).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => head.includes(marker));
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", middot: "\u00b7",
  laquo: "\u00ab", raquo: "\u00bb", ldquo: "\u201c", rdquo: "\u201d",
  lsquo: "\u2018", rsquo: "\u2019", times: "\u00d7", divide: "\u00f7",
  copy: "\u00a9", reg: "\u00ae", trade: "\u2122", deg: "\u00b0",
  plusmn: "\u00b1", minus: "\u2212", le: "\u2264", ge: "\u2265", ne: "\u2260",
  infin: "\u221e", prime: "\u2032", bull: "\u2022", dagger: "\u2020",
  sect: "\u00a7", para: "\u00b6", micro: "\u00b5", pound: "\u00a3",
  euro: "\u20ac", yen: "\u00a5", cent: "\u00a2", alpha: "\u03b1", beta: "\u03b2",
  gamma: "\u03b3", pi: "\u03c0", sigma: "\u03c3", omega: "\u03c9",
  agrave: "\u00e0", aacute: "\u00e1", auml: "\u00e4", aring: "\u00e5",
  ccedil: "\u00e7", egrave: "\u00e8", eacute: "\u00e9", euml: "\u00eb",
  iacute: "\u00ed", ntilde: "\u00f1", oacute: "\u00f3", ouml: "\u00f6",
  uacute: "\u00fa", uuml: "\u00fc", szlig: "\u00df", iexcl: "\u00a1",
  iquest: "\u00bf", frac12: "\u00bd", frac14: "\u00bc", frac34: "\u00be",
  sup2: "\u00b2", sup3: "\u00b3",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED[body] ?? match;
  });
}

const TOKEN = /<!--[\s\S]*?-->|<![^<>]*>|<\/?[a-zA-Z][^<>]*>|[^<]+/g;
const TAG_NAME = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/;
const SKIPPED = new Set(["script", "style", "noscript", "svg", "template", "iframe", "canvas", "math"]);
const BLOCKS = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "nav", "aside",
  "ul", "ol", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr",
  "blockquote", "figure", "figcaption", "form", "fieldset", "address", "details", "summary",
]);
const MAX_INPUT = 2 * 1024 * 1024;

export function htmlToMarkdown(html: string, baseUrl: string, maxChars = 400_000): string {
  const input = html.length > MAX_INPUT ? html.slice(0, MAX_INPUT) : html;
  let output = "";
  let skip: string | null = null;
  let pre = false;
  let href: string | null = null;
  let linkText = "";
  const push = (text: string): void => {
    if (output.length < maxChars * 2) output += text;
  };
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(input)) !== null && output.length < maxChars * 2) {
    const token = match[0];
    if (token.startsWith("<!--")) continue;
    if (token[0] !== "<") {
      if (skip) continue;
      const text = decodeEntities(token);
      if (pre) {
        push(text.replace(/\r\n?/g, "\n"));
      } else if (href !== null) {
        linkText += text;
      } else {
        push(text.replace(/\s+/g, " "));
      }
      continue;
    }
    const tag = TAG_NAME.exec(token);
    if (!tag) continue; // doctype, CDATA or a stray "<"
    const name = tag[1].toLowerCase();
    const closing = token[1] === "/";
    if (skip) {
      if (closing && name === skip) skip = null;
      continue;
    }
    if (SKIPPED.has(name)) {
      if (!closing) skip = name;
      continue;
    }
    if (name === "pre") {
      if (closing) {
        if (pre) {
          pre = false;
          push("\n```\n");
        }
      } else {
        pre = true;
        push("\n```\n");
      }
      continue;
    }
    // Inside <pre> only text and <br> survive, so code keeps its own layout.
    if (pre) {
      if (name === "br") push("\n");
      continue;
    }
    if (name === "br") {
      push("\n");
      continue;
    }
    if (name === "hr") {
      push("\n\n---\n\n");
      continue;
    }
    if (name === "a") {
      if (closing) {
        const text = linkText.replace(/\s+/g, " ").trim();
        if (href && text) push(`[${text}](${href})`);
        else if (text) push(text);
        href = null;
        linkText = "";
      } else {
        href = resolveHref(attribute(token, "href"), baseUrl);
        linkText = "";
      }
      continue;
    }
    if (href !== null) continue; // markup inside <a> is dropped, its text is kept
    const heading = /^h([1-6])$/.exec(name);
    if (heading) {
      push(closing ? "\n" : `\n${"#".repeat(Number(heading[1]))} `);
      continue;
    }
    if (name === "li") {
      push(closing ? "\n" : "\n- ");
      continue;
    }
    if (name === "td" || name === "th") {
      push(closing ? " " : " | ");
      continue;
    }
    if (name === "code") {
      push("`");
      continue;
    }
    if (BLOCKS.has(name)) push("\n");
  }
  const text = output
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function attribute(token: string, name: string): string {
  const quoted = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(token);
  if (quoted) return quoted[1] ?? quoted[2] ?? "";
  return new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(token)?.[1] ?? "";
}

function resolveHref(raw: string, baseUrl: string): string | null {
  const value = decodeEntities(raw.trim());
  if (!value || /^(?:javascript|data|vbscript|mailto|tel):/i.test(value)) return null;
  try {
    const url = new URL(value, baseUrl);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
