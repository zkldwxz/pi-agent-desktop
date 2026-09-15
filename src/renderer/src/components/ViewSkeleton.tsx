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
          <Skeleton key={index} className="h-[68px]" index={index} />
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-7" index={index} />
        ))}
      </div>
    </div>
  );
}
