export function LoadingDots({ label, elapsed }: { label: string; elapsed?: string }) {
  const delays = [0, 90, 180, 90, 0, 90, 180, 90, 0];
  return (
    <div role="status" className="flex w-fit items-center gap-2.5" style={{ animation: "fade-in 200ms ease-out both" }}>
      <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {delays.map((delay, index) => (
          <span
            key={index}
            className="size-1 rounded-[1px] bg-ink"
            style={{ opacity: 0.15, animation: `pixel-on 650ms ease-in-out ${delay}ms infinite` }}
          />
        ))}
      </span>
      <span className="shimmer-text text-[13px] font-medium">{label}</span>
      {elapsed ? <span className="font-mono text-[12px] text-ink-3 tabular-nums">{elapsed}</span> : null}
    </div>
  );
}
