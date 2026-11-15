import type { SevenDayForecast } from "../../lib/api/client";
import { formatForecastDate, formatForecastPrice } from "./forecastChart";

type Asset = "BTC" | "ETH" | "SOL";

const WIDTH = 800;
const HEIGHT = 320;
const MARGIN = { top: 24, right: 28, bottom: 48, left: 92 };

export function CryptoChart({
  forecast,
  asset,
}: {
  forecast: SevenDayForecast;
  asset: Asset;
}) {
  const selected = forecast.assets.find((item) => item.asset === asset);
  if (selected === undefined) return null;

  const cutoff = forecast.market_data_cutoff_utc.slice(0, 10);
  const dates = [cutoff, ...forecast.forecast_dates_utc];
  const p10Prices = selected.p10_prices.map(Number);
  const p50Prices = selected.p50_prices.map(Number);
  const p90Prices = selected.p90_prices.map(Number);
  const chartPrices = [
    Number(selected.current_price),
    ...p10Prices,
    ...p50Prices,
    ...p90Prices,
  ];
  const minimum = Math.min(...chartPrices);
  const maximum = Math.max(...chartPrices);
  const padding = Math.max((maximum - minimum) * 0.18, maximum * 0.002);
  const low = minimum - padding;
  const high = maximum + padding;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const point = (value: number, index: number) => ({
    x: MARGIN.left + (index / 7) * plotWidth,
    y: MARGIN.top + ((high - value) / (high - low)) * plotHeight,
  });
  const p10Points = p10Prices.map((value, index) => point(value, index + 1));
  const p50Points = p50Prices.map((value, index) => point(value, index + 1));
  const p90Points = p90Prices.map((value, index) => point(value, index + 1));
  const linePath = (points: { x: number; y: number }[]) =>
    points
      .map(
        ({ x, y }, index) =>
          `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`,
      )
      .join(" ");
  const uncertaintyBandPath = [...p90Points, ...[...p10Points].reverse()]
    .map(
      ({ x, y }, index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`,
    )
    .join(" ");
  const displayPoints = [
    point(Number(selected.current_price), 0),
    ...p50Points,
  ];
  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      y: MARGIN.top + ratio * plotHeight,
      value: high - ratio * (high - low),
    };
  });

  return (
    <div className="phase2-chart-frame">
      <div
        className="phase2-chart"
        role="img"
        aria-label={`${asset} observed price on ${formatForecastDate(cutoff)} and P10, P50, and P90 daily USD paths through ${formatForecastDate(dates.at(-1) ?? cutoff)}. The Historical Error Range summarizes held-out error; it is not a validated 80% prediction interval, is visualization-only, and does not affect portfolio calculations.`}
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
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
          {displayPoints.map(({ x, y }, index) => (
            <g key={dates[index]}>
              <circle
                className={
                  index === 0 ? "forecast-point observed" : "forecast-point"
                }
                cx={x}
                cy={y}
                r={index === 0 ? 6 : 4}
              >
                <title>
                  {`${formatForecastDate(dates[index] ?? cutoff)} · ${index === 0 ? "Observed" : `P50 Day ${index}`} · ${formatForecastPrice(index === 0 ? Number(selected.current_price) : (p50Prices[index - 1] ?? 0))}`}
                </title>
              </circle>
              <text className="forecast-x-label" x={x} y={HEIGHT - 20}>
                {index === 0 ? "Current" : `D${index}`}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="chart-legend" aria-label="Chart legend">
        <span>
          <i className="observed" />
          Observed cutoff price
        </span>
        <span>
          <i className="predicted" />
          P50 median reference
        </span>
        <span title="The Historical Error Range uses P10–P90 paths derived from held-out residuals. It is not a validated 80% prediction interval or price guarantee, and it is not used by the portfolio optimizer.">
          <i className="uncertainty" />
          Historical Error Range
        </span>
      </div>
    </div>
  );
}

function compactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);
}
