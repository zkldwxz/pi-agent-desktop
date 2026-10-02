import { localeTag } from "./i18n";

export function relativeTime(iso: string): string {
  const date = new Date(iso);
  const delta = Date.now() - date.getTime();
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}

/** `3m 42s` — the Cursor/Codex-style completion duration. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

/**
 * A token count at reading size — 7881.3 万, 1.2M, 340K, 96.
 *
 * The compact spelling follows the interface language, the way the reference
 * does it: `Intl` compact notation yields 万/亿 for zh and K/M for latin
 * locales, and the zh forms get a hair of space between numeral and unit.
 * Distinct from `formatContext`, which labels a model's context window and so
 * rounds to whatever the manifest declared; this one compares measured usage,
 * where two significant digits is the most the numbers earn.
 */
export function compactTokens(value: number): string {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) < 1000) return String(Math.round(value));
  const locale = localeTag();
  const text = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return locale.startsWith("zh") ? text.replace(/(?<=\d)(?=[万亿])/u, " ") : text;
}

/** Above 99.5 the decimals only add width; below 0.1% they are the whole point. */
export function percent(value: number): string {
  return `${(value * 100).toFixed(value >= 0.995 || value === 0 ? 0 : 1)}%`;
}

/**
 * The one or two graphemes an avatar shows for a name.
 *
 * Latin names take the first letter of each of the first two words ("Ada L");
 * a single word keeps its first letter, uppercased. CJK names keep their first
 * two characters — 张三 reads as a whole, not as an initial.
 */
export function initialsOf(name: string | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/).filter(Boolean);
  const cjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  if (words.length === 1) {
    const glyphs = [...words[0]];
    if (cjk.test(glyphs[0])) return glyphs.slice(0, glyphs.length > 1 ? 2 : 1).join("");
    return glyphs[0].toUpperCase();
  }
  return words
    .slice(0, 2)
    .map((word) => [...word][0])
    .map((char) => (cjk.test(char) ? char : char.toUpperCase()))
    .join("");
}

export function folderName(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || cwd;
}

/**
 * An answer as prose, for the places that summarise rather than publish.
 *
 * The transcript renders the same text as markdown; a three-line preview wants
 * what it *says*, so the structural marks come off — a code fence or a table is
 * not readable at that size anyway.
 */
export function asProse(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/^\s*\|.*$/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "· ")
    .replace(/[*_`]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
