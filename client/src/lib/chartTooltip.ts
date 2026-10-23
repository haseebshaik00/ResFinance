import type { CSSProperties } from "react";

/** Matches `:root` in `styles.css` so Recharts SVG/HTML labels use dashboard type. */
export const chartFontFamily =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const chartTickStyle = {
  fill: "var(--page-muted)",
  fontSize: 11,
  fontFamily: chartFontFamily,
} as const;

export const chartLegendWrapperStyle: CSSProperties = {
  fontFamily: chartFontFamily,
  fontSize: 12,
};

/** Theme-aware Recharts tooltip styles (avoids the default white hover box). */
export const chartTooltipContentStyle: CSSProperties = {
  background: "var(--popover-background)",
  border: "1px solid var(--control-border)",
  borderRadius: "0.5rem",
  color: "var(--page-text)",
  boxShadow: "var(--card-shadow)",
  fontFamily: chartFontFamily,
};

export const chartTooltipLabelStyle: CSSProperties = {
  color: "var(--page-muted)",
  fontFamily: chartFontFamily,
};

export const chartTooltipItemStyle: CSSProperties = {
  color: "var(--page-text)",
  fontFamily: chartFontFamily,
};

export const chartTooltipCursor = {
  fill: "var(--chart-grid)",
} as const;
