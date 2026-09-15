/**
 * Micro-benchmark for the transcript hot path.
 *
 * `buildTurns` re-processes every message on each streamed token, because the
 * messages array is new every update. This measures what that costs, so the fix
 * is justified by a number rather than a hunch.
 *
 *   node scripts/bench-transcript.mjs [messageCount] [tokensPerSecond]
 */
const FENCE = /```([a-zA-Z0-9+-]*)\n([\s\S]*?)(?:```|$)/g;
const URL_RE = /https?:\/\/[^\s)"'<>\]]+/g;

function splitSegments(text) {
  const out = [];
  let last = 0;
  FENCE.lastIndex = 0;
  for (const match of text.matchAll(FENCE)) {
    const index = match.index ?? 0;
    if (index > last) {
      const prose = text.slice(last, index).trimEnd();
      if (prose) out.push({ kind: "text", text: prose });
    }
    const code = (match[2] ?? "").replace(/\n$/, "");
    if (code.trim()) out.push({ kind: "code", lang: match[1] ?? "", code });
    last = index + match[0].length;
  }
  const rest = text.slice(last).trimEnd();
  if (rest) out.push({ kind: "text", text: rest });
  if (!out.length && text.trim()) out.push({ kind: "text", text: text.trim() });
  return out;
}

function harvestSources(text) {
  if (!text) return [];
  const seen = new Set();
  const sources = [];
  for (const match of text.matchAll(URL_RE)) {
    const href = match[0].replace(/[.,;:]+$/, "");
    let domain;
    try {
      domain = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (seen.has(domain)) continue;
    seen.add(domain);
    sources.push(domain);
    if (sources.length >= 6) break;
  }
  return sources;
}

const count = Number(process.argv[2] || 200);
const tokensPerSecond = Number(process.argv[3] || 30);

const body =
  "Here is the change you asked for.\n\n```ts\nexport function x() {\n  return 1;\n}\n```\n\n" +
  "See https://example.com/a and https://docs.example.org/b for the detail. ";
const history = Array.from({ length: count }, (_, i) => ({ text: `${body} message ${i}` }));
const totalKb = history.reduce((sum, m) => sum + m.text.length, 0) / 1024;

const fullPass = () => {
  let acc = 0;
  for (const message of history) {
    acc += splitSegments(message.text).length;
    acc += harvestSources(message.text).length;
  }
  return acc;
};

// ── cached variant: memoize by input string, which is what the fix does ──
const segCache = new Map();
const srcCache = new Map();
const cachedPass = () => {
  let acc = 0;
  for (const message of history) {
    let segs = segCache.get(message.text);
    if (!segs) {
      segs = splitSegments(message.text);
      segCache.set(message.text, segs);
    }
    let src = srcCache.get(message.text);
    if (!src) {
      src = harvestSources(message.text);
      srcCache.set(message.text, src);
    }
    acc += segs.length + src.length;
  }
  return acc;
};

function time(fn) {
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < 30; i += 1) fn();
  return Number(process.hrtime.bigint() - start) / 1e6 / 30;
}

const full = time(fullPass);
const cached = time(cachedPass);

console.log(`history            ${count} messages, ${totalKb.toFixed(0)} KB of text`);
console.log(`per streamed token ${full.toFixed(1)} ms full  →  ${cached.toFixed(2)} ms cached`);
console.log(`at ${tokensPerSecond} tok/s      ${(full * tokensPerSecond).toFixed(0)} ms/s of every second  →  ${(cached * tokensPerSecond).toFixed(1)} ms/s`);
console.log(`speedup            ${(full / cached).toFixed(0)}×`);
