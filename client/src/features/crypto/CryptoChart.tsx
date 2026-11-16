import { useId, useState } from "react";

import type { SevenDayForecast } from "../../lib/api/client";
import { formatForecastDate, formatForecastPrice } from "./forecastChart";

type Asset = "BTC" | "ETH" | "SOL";

type ChartPoint = { x: number; y: number };

type HoverPoint = {
  index: number;
  label: string;
  date: string;
  x: number;
  observed?: number;
  p10?: number;
  p50?: number;
  p90?: number;
};

const WIDTH = 840;
const HEIGHT = 340;
const MARGIN = { top: 28, right: 64, bottom: 52, left: 92 };
const LABEL_MIN_GAP = 18;

export function CryptoChart({
  forecast,
  asset,
}: {
  forecast: SevenDayForecast;
  asset: Asset;
}) {
  const tooltipId = useId();
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const selected = forecast.assets.find((item) => item.asset === asset);
  if (selected === undefined) return null;

  const cutoff = forecast.market_data_cutoff_utc.slice(0, 10);
  const dates = [cutoff, ...forecast.forecast_dates_utc];
  const currentPrice = Number(selected.current_price);
  const p10Prices = selected.p10_prices.map(Number);
  const p50Prices = selected.p50_prices.map(Number);
  const p90Prices = selected.p90_prices.map(Number);
  const chartPrices = [currentPrice, ...p10Prices, ...p50Prices, ...p90Prices];
  const minimum = Math.min(...chartPrices);
  const maximum = Math.max(...chartPrices);
  const padding = Math.max((maximum - minimum) * 0.18, maximum * 0.002);
  const low = minimum - padding;
  const high = maximum + padding;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const point = (value: number, index: number): ChartPoint => ({
    x: MARGIN.left + (index / 7) * plotWidth,
    y: MARGIN.top + ((high - value) / (high - low)) * plotHeight,
  });
  const observedPoint = point(currentPrice, 0);
  const p10Points = [
    observedPoint,
    ...p10Prices.map((value, index) => point(value, index + 1)),
  ];
  const p50Points = [
    observedPoint,
    ...p50Prices.map((value, index) => point(value, index + 1)),
  ];
  const p90Points = [
    observedPoint,
    ...p90Prices.map((value, index) => point(value, index + 1)),
  ];
  const hoverPoints: HoverPoint[] = [
    {
      index: 0,
      label: "Current",
      date: cutoff,
      x: observedPoint.x,
      observed: currentPrice,
    },
    ...p50Prices.flatMap((_, index) => {
      const p10 = p10Prices[index];
      const p50 = p50Prices[index];
      const p90 = p90Prices[index];
      const dayPoint = p50Points[index + 1];
      if (
        p10 === undefined ||
        p50 === undefined ||
        p90 === undefined ||
        dayPoint === undefined
      ) {
        return [];
      }
      return [
        {
          index: index + 1,
          label: `D${index + 1}`,
          date: dates[index + 1] ?? cutoff,
          x: dayPoint.x,
          p10,
          p50,
          p90,
        },
      ];
    }),
  ];
  const linePath = (points: ChartPoint[]) =>
    points
      .map(
        ({ x, y }, index) =>
          `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`,
      )
      .join(" ");
  // Fan the Historical Error Range from the observed cutoff through P90/P10.
  const uncertaintyBandPath = [...p90Points, ...[...p10Points].reverse()]
    .map(
      ({ x, y }, index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`,
    )
    .join(" ");
  const forecastDayPoints = p50Points.slice(1);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      y: MARGIN.top + ratio * plotHeight,
      value: high - ratio * (high - low),
    };
  });
  const quantileLabels = spaceLabels(
    [
      {
        key: "p90",
        label: "P90",
        className: "p90",
        x: p90Points.at(-1)?.x ?? 0,
        y: p90Points.at(-1)?.y ?? 0,
      },
      {
        key: "p50",
        label: "P50",
        className: "p50",
        x: p50Points.at(-1)?.x ?? 0,
        y: p50Points.at(-1)?.y ?? 0,
      },
      {
        key: "p10",
        label: "P10",
        className: "p10",
        x: p10Points.at(-1)?.x ?? 0,
        y: p10Points.at(-1)?.y ?? 0,
      },
    ],
    MARGIN.top + 10,
    MARGIN.top + plotHeight - 10,
  );

  const updateHover = (clientX: number, target: SVGSVGElement) => {
    const bounds = target.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const svgX = ((clientX - bounds.left) / bounds.width) * WIDTH;
    let nearest = hoverPoints[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of hoverPoints) {
      const distance = Math.abs(candidate.x - svgX);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    if (nearest !== undefined) {
      setHover(nearest);
    }
  };

  return (
    <div className="phase2-chart-frame">
      <div
        className="phase2-chart"
        role="img"
        aria-label={`${asset} observed price on ${formatForecastDate(cutoff)} and P10, P50, and P90 daily USD paths through ${formatForecastDate(dates.at(-1) ?? cutoff)}. The Historical Error Range summarizes held-out error; it is not a validated 80% prediction interval, is visualization-only, and does not affect portfolio calculations.`}
        aria-describedby={hover ? tooltipId : undefined}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          aria-hidden="true"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(event) =>
            updateHover(event.clientX, event.currentTarget)
          }
        >
          {grid.map((line) => (
            <g key={line.y}>
              <line
                className="forecast-grid-line"
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={line.y}
                y2={line.y}
              />
              <text
                className="forecast-axis-label"
                x={MARGIN.left - 12}
                y={line.y + 4}
              >
                {compactUsd(line.value)}
              </text>
            </g>
          ))}
          <line
            className="forecast-baseline"
            x1={observedPoint.x}
            x2={observedPoint.x}
            y1={MARGIN.top}
            y2={MARGIN.top + plotHeight}
          />
          <path
            className="forecast-uncertainty-band"
            d={`${uncertaintyBandPath} Z`}
          />
          <path
            className="forecast-quantile-line p10"
            d={linePath(p10Points)}
          />
          <path
            className="forecast-quantile-line p90"
            d={linePath(p90Points)}
          />
          <path className="forecast-line" d={linePath(p50Points)} />
          {p10Points.slice(1).map(({ x, y }, index) => (
            <circle
              key={`p10-${dates[index + 1]}`}
              className="forecast-quantile-point p10"
              cx={x}
              cy={y}
              r={3}
            />
          ))}
          {p90Points.slice(1).map(({ x, y }, index) => (
            <circle
              key={`p90-${dates[index + 1]}`}
              className="forecast-quantile-point p90"
              cx={x}
              cy={y}
              r={3}
            />
          ))}
          <g>
            <circle
              className="forecast-point observed"
              cx={observedPoint.x}
              cy={observedPoint.y}
              r={6}
            />
            <text
              className="forecast-x-label"
              x={observedPoint.x}
              y={HEIGHT - 22}
            >
              Current
            </text>
          </g>
          {forecastDayPoints.map(({ x, y }, index) => (
            <g key={dates[index + 1]}>
              <circle className="forecast-point" cx={x} cy={y} r={4.5} />
              <text className="forecast-x-label" x={x} y={HEIGHT - 22}>
                {`D${index + 1}`}
              </text>
            </g>
          ))}
          {hover ? (
            <line
              className="forecast-hover-line"
              x1={hover.x}
              x2={hover.x}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
            />
          ) : null}
          {quantileLabels.map((item) => (
            <g
              key={item.key}
              className={`forecast-quantile-label ${item.className}`}
              transform={`translate(${item.x + 10}, ${item.y})`}
            >
              <rect
                className="forecast-quantile-label-bg"
                x={0}
                y={-10}
                width={36}
                height={20}
                rx={6}
              />
              <text className="forecast-quantile-label-text" x={18} y={4}>
                {item.label}
              </text>
            </g>
          ))}
          <rect
            className="forecast-hover-capture"
            x={MARGIN.left}
            y={MARGIN.top}
            width={plotWidth}
            height={plotHeight}
          />
        </svg>
        {hover ? (
          <div
            className="forecast-chart-tooltip"
            id={tooltipId}
            role="tooltip"
            style={{
              left: `${(hover.x / WIDTH) * 100}%`,
              top: `${((MARGIN.top + 12) / HEIGHT) * 100}%`,
            }}
          >
            <strong>
              {hover.label} · {formatForecastDate(hover.date)}
            </strong>
            {hover.observed !== undefined ? (
              <span>
                Observed
                <em>{formatForecastPrice(hover.observed)}</em>
              </span>
            ) : null}
            {hover.p90 !== undefined ? (
              <span className="p90">
                P90
                <em>{formatForecastPrice(hover.p90)}</em>
              </span>
            ) : null}
            {hover.p50 !== undefined ? (
              <span className="p50">
                P50
                <em>{formatForecastPrice(hover.p50)}</em>
              </span>
            ) : null}
            {hover.p10 !== undefined ? (
              <span className="p10">
                P10
                <em>{formatForecastPrice(hover.p10)}</em>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="chart-legend" aria-label="Chart legend">
        <span>
          <i className="observed" />
          Observed Cutoff
        </span>
        <span>
          <i className="p10" />
          P10 Lower
        </span>
        <span>
          <i className="predicted" />
          P50 Median
        </span>
        <span>
          <i className="p90" />
          P90 Upper
        </span>
        <span title="The Historical Error Range uses P10–P90 paths derived from held-out residuals. It is not a validated 80% prediction interval or price guarantee, and it is not used by the portfolio optimizer.">
          <i className="uncertainty" />
          Historical Error Range
        </span>
      </div>
    </div>
  );
}

function spaceLabels(
  labels: Array<{
    key: string;
    label: string;
    className: string;
    x: number;
    y: number;
  }>,
  minY: number,
  maxY: number,
) {
  const ordered = [...labels].sort((left, right) => left.y - right.y);
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (current === undefined) continue;
    const previous = ordered[index - 1];
    const floor = previous === undefined ? minY : previous.y + LABEL_MIN_GAP;
    current.y = Math.min(maxY, Math.max(floor, current.y));
  }
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (current === undefined || next === undefined) continue;
    if (next.y - current.y < LABEL_MIN_GAP) {
      current.y = Math.max(minY, next.y - LABEL_MIN_GAP);
    }
  }
  return ordered;
}

function compactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);
}
