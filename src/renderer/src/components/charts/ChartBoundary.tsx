import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../../lib/i18n";

/**
 * One chart failing must not blank the whole usage view. The buckets are
 * derived from session files parsed off disk, so a malformed range is a real
 * possibility at that boundary; each chart is wrapped on its own so only the
 * one that choked degrades to a placeholder.
 *
 * `bare` renders just the dashed placeholder for charts that already sit
 * inside a parent Card; the default renders a full card so a wrapped chart
 * that supplies its own section (trend, share) stays visually consistent with
 * its neighbours when it falls back.
 */
export class ChartBoundary extends Component<
  { title?: string; bare?: boolean; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[usage-chart]", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const box = (
      <div className="rounded-control border border-dashed border-line-strong px-4 py-9 text-center">
        <div className="text-ui-caption font-medium text-ink-2">{t("This chart couldn't be rendered")}</div>
        <div className="mt-1 text-ui-sm text-ink-3">{t("The data in this range is malformed.")}</div>
      </div>
    );
    if (this.props.bare) return box;
    return (
      <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
        {this.props.title ? <h3 className="text-ui-caption font-medium text-ink">{this.props.title}</h3> : null}
        {box}
      </section>
    );
  }
}
