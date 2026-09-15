/**
 * Context-window pressure.
 *
 * Thresholds in one place so the bands can be retuned without hunting through
 * the UI. The ring starts white at zero, warms through blue and green, turns
 * yellow at 80 and red above it.
 */
export interface PressureBand {
  /** inclusive lower bound, percent */
  from: number;
  /** exclusive upper bound, percent */
  to: number;
  tone: string;
  label: string;
}

export const PRESSURE_BANDS: PressureBand[] = [
  { from: 0, to: 0.5, tone: "#FFFFFF", label: "empty" },
  { from: 0.5, to: 40, tone: "#2F6FEC", label: "comfortable" },
  { from: 40, to: 80, tone: "#1F7A5F", label: "filling" },
  { from: 80, to: 90, tone: "#D9A521", label: "getting tight" },
  { from: 90, to: Number.POSITIVE_INFINITY, tone: "#C2453B", label: "compacting soon" },
];

export function pressureFor(percent: number | null | undefined): { tone: string; label: string } {
  if (percent === null || percent === undefined) {
    return { tone: "var(--line-strong)", label: "unknown" };
  }
  const band = PRESSURE_BANDS.find((entry) => percent >= entry.from && percent < entry.to) ?? PRESSURE_BANDS[0];
  return { tone: band.tone, label: band.label };
}
