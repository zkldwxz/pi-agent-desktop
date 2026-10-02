import { Skeleton } from "./ui";

/**
 * Loading placeholder for a lazily-loaded view.
 *
 * A skeleton rather than a spinner: these views have a known shape (a header, a
 * stat strip, a table), so the placeholder reserves the same space and the
 * real content lands without a jump. A centred spinner would flash and then
 * shift everything.
 */
export function ViewSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 pb-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[68px]" />
        ))}
      </div>
      {/* varied widths, because eight identical full-width bars read as a
          placeholder nobody looked at */}
      <div className="mt-3 flex flex-col gap-1.5">
        {["78%", "64%", "86%", "52%", "70%", "44%", "60%", "36%"].map((width) => (
          <Skeleton key={width} className="h-7" style={{ width }} />
        ))}
      </div>
    </div>
  );
}

/**
 * The browser's own placeholder while its chunk arrives.
 *
 * `ViewSkeleton` is a *dashboard*: a header, a stat strip and a table. The
 * browser is none of those — it is a 42px bar over a page that a Chromium view
 * paints from outside this document — so a card grid and eight rows flashed a
 * shape the view never takes. This reserves the bar the real panel draws and
 * leaves the page area empty, which is also the honest picture: until the native
 * view is bound, there is nothing there to draw.
 *
 * Deliberately static — the sweep belongs to content that is being fetched, and
 * a 150ms flash of moving bars is noise, not progress.
 */
export function BrowserViewSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-page" aria-busy="true" aria-live="polite">
      <div className="flex h-[42px] shrink-0 items-center gap-1 border-b border-line px-2">
        <span className="size-7 shrink-0 rounded-chip bg-hover-2" />
        <span className="size-7 shrink-0 rounded-chip bg-hover-2" />
        <span className="size-7 shrink-0 rounded-chip bg-hover-2" />
        <span className="mx-1 h-[26px] min-w-0 flex-1 rounded-chip bg-field" />
        <span className="size-7 shrink-0 rounded-chip bg-hover-2" />
      </div>
      <div className="min-h-0 flex-1" />
    </div>
  );
}
