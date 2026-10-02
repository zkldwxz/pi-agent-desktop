"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GlideMenu from "./GlideMenu";

/* ─────────────────────────────────────────────────────────
 * SEARCH — command search with live filtering.
 *
 * Vendored from Beautiful UI, extended for a real command palette:
 *   · `entries` accepts grouped rows with a hint (commands, sessions,
 *     models, tools) instead of bare strings
 *   · ArrowUp / ArrowDown move DOM focus, which drives GlideMenu's
 *     `onFocusCapture` — so the highlight glides for the keyboard exactly
 *     the way it glides for the pointer
 *   · Enter activates, Escape closes, and matches keep the query in view
 * ───────────────────────────────────────────────────────── */

export type SearchItem = string;

export type SearchEntry = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
};

export type SearchListLabels = {
  placeholder: string;
  ariaLabel: string;
  emptyTitle: string;
  emptyHint: string;
};

const ITEMS: SearchItem[] = [
  "Forecast summer demand",
  "Find waffle cone suppliers",
  "Compare seasonal flavors",
  "Draft flavor launch plan",
  "Check cold-chain status",
  "Audit sugar costs",
  "Retire low sellers",
];

const LABELS: SearchListLabels = {
  placeholder: "Search flavors…",
  ariaLabel: "Search flavors",
  emptyTitle: "No results found",
  emptyHint: "Adjust your search to try again",
};

export default function SearchList({
  items,
  entries,
  labels = LABELS,
  onSelect,
  autoFocus = false,
  maxResults = 40,
  onClose,
}: {
  items?: SearchItem[];
  /** richer rows — takes precedence over `items` */
  entries?: SearchEntry[];
  labels?: SearchListLabels;
  onSelect?: (entry: SearchEntry) => void;
  autoFocus?: boolean;
  maxResults?: number;
  onClose?: () => void;
  variant?: string;
} = {}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const pool = useMemo<SearchEntry[]>(
    () => entries ?? (items ?? ITEMS).map((label) => ({ id: label, label })),
    [entries, items],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? pool.filter((entry) => `${entry.label} ${entry.hint ?? ""} ${entry.group ?? ""}`.toLowerCase().includes(q))
      : pool;
    return matched.slice(0, maxResults);
  }, [pool, query, maxResults]);

  const empty = query.trim().length > 1 && results.length === 0;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  // roving focus: moving real focus is what makes the glide layer follow the keyboard
  useEffect(() => {
    if (!results.length) return;
    rowRefs.current[active]?.focus({ preventScroll: true });
  }, [active, results.length]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (results.length ? (current + 1) % results.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const entry = results[active];
      if (entry) onSelect?.(entry);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
    }
  };

  let lastGroup: string | undefined;

  return (
    <div className="flex w-full flex-col items-stretch" onKeyDown={onKeyDown}>
      <div className="w-full self-start overflow-hidden rounded-card bg-surface shadow-overlay">
        {/* input row */}
        <div className="flex h-10 items-center gap-2 border-b border-line px-3">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" className="shrink-0">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder={labels.placeholder}
            aria-label={labels.ariaLabel}
            className="min-w-0 flex-1 bg-transparent text-ui-base text-ink outline-none placeholder:text-ink-4"
          />
          {query ? (
            <button
              aria-label="Clear search"
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="flex size-6 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
              style={{ animation: "fade-in 150ms ease-out both" }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <kbd className="shrink-0 rounded-tiny bg-field px-1.5 py-px text-ui-xs text-ink-3">Esc</kbd>
          )}
        </div>

        {/* results / empty state */}
        {empty ? (
          <div className="flex flex-col items-center justify-center gap-1 px-4 py-8" style={{ animation: "fade-in 250ms ease-out both" }}>
            <span className="mb-1.5 flex size-8 items-center justify-center rounded-control bg-inset text-ink-3 shadow-hairline">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </span>
            <span className="text-ui-base font-medium text-ink">{labels.emptyTitle}</span>
            <span className="text-ui-caption text-ink-3">{labels.emptyHint}</span>
          </div>
        ) : (
          <div className="scrollbar-thin max-h-[52vh] overflow-y-auto p-1">
            <GlideMenu className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-chip bg-hover">
              {results.map((entry, index) => {
                const header = entry.group && entry.group !== lastGroup ? entry.group : null;
                lastGroup = entry.group ?? lastGroup;
                return (
                  <div key={entry.id}>
                    {header ? (
                      <div className="px-2 pt-2 pb-1 text-ui-xs font-medium tracking-[0.5px] text-ink-3">
                        {header.toUpperCase()}
                      </div>
                    ) : null}
                    <button
                      ref={(el) => {
                        rowRefs.current[index] = el;
                      }}
                      data-menu-row
                      type="button"
                      onClick={() => onSelect?.(entry)}
                      className="relative z-10 flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-ui-base text-ink">{entry.label}</span>
                      {entry.hint ? (
                        <span className="shrink-0 truncate font-mono text-ui-xs text-ink-3">{entry.hint}</span>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </GlideMenu>
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-ui-xs text-ink-3">
          <span className="flex items-center gap-1">
            <kbd className="rounded-tiny bg-field px-1 py-px">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded-tiny bg-field px-1 py-px">↵</kbd> run
          </span>
          <span className="flex-1" />
          <span className="tabular-nums">{results.length} results</span>
        </div>
      </div>
    </div>
  );
}
