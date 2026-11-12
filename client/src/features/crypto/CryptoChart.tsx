import {
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

import type { CryptoOverview } from "../../lib/api/client";
import {
  buildForecastPath,
  forecastEndDate,
  formatForecastDate,
  formatForecastPrice,
  formatForecastReturn,
} from "./forecastChart";

type Asset = "BTC" | "ETH" | "SOL";

export function CryptoChart({
  overview,
  asset,
}: {
  overview: CryptoOverview;
  asset: Asset;
}) {
  const container = useRef<HTMLDivElement>(null);
  const snapshot = overview.forecast;
  const historical = useMemo(
    () =>
      snapshot?.price_history
        .filter((point) => point.asset === asset)
        .map((point) => ({
          time: point.observed_at_utc.slice(0, 10) as Time,
          value: Number(point.price_usd),
        })) ?? [],
    [asset, snapshot],
  );
  const forecast = useMemo(
    () => snapshot?.forecasts.find((item) => item.asset === asset),
    [asset, snapshot],
  );
  const last = historical.at(-1);
  const endDate =
    snapshot === null || last === undefined
      ? null
      : forecastEndDate(String(last.time), snapshot.horizon_days);

  useEffect(() => {
    if (
      container.current === null ||
      snapshot === null ||
      last === undefined ||
      forecast === undefined ||
      endDate === null
    )
      return;
    const host = container.current;
    const chart: IChartApi = createChart(host, {
      width: host.clientWidth,
      height: 310,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#73809a",
      },
      grid: {
        vertLines: { color: "rgba(115, 128, 154, 0.12)" },
        horzLines: { color: "rgba(115, 128, 154, 0.12)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    if (historical.length > 0) {
      const historyLine = chart.addSeries(LineSeries, {
        color: "#6555a5",
        lineWidth: 3,
        title: `${asset} observed`,
      });
      historyLine.setData(historical);
      const overlays = [
        ["p10_return", "#d16d7f", "P10"],
        ["p50_return", "#2c9c91", "P50"],
        ["p90_return", "#d49735", "P90"],
      ] as const;
      overlays.forEach(([field, color, title]) => {
        const line = chart.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          lineStyle: 2,
          title,
        });
        const points = buildForecastPath({
          startDate: String(last.time),
          endDate,
          startValue: last.value,
          endpointReturn: Number(forecast[field]),
        }).map((point) => ({ ...point, time: point.time as Time }));
        line.setData(points);
      });
      chart.timeScale().fitContent();
    }
    const resize = new ResizeObserver(() => {
      chart.applyOptions({ width: host.clientWidth });
    });
    resize.observe(host);
    return () => {
      resize.disconnect();
      chart.remove();
    };
  }, [endDate, forecast, historical, last, snapshot]);

  if (
    snapshot === null ||
    last === undefined ||
    forecast === undefined ||
    endDate === null
  ) {
    return null;
  }

  const lastObservedDate = String(last.time);
  const p50Return = Number(forecast.p50_return);
  const values = [
    ["P10", forecast.p10_return],
    ["P50", forecast.p50_return],
    ["P90", forecast.p90_return],
  ] as const;

  return (
    <div className="forecast-chart-frame">
      <div
        className="forecast-window"
        aria-label={`${snapshot.horizon_days}-day forecast interval from ${formatForecastDate(lastObservedDate)} through ${formatForecastDate(endDate)}`}
      >
        <span className="forecast-window-date">
          <small>Observed through</small>
          <strong>{formatForecastDate(lastObservedDate)}</strong>
        </span>
        <span className="forecast-window-span">
          <span aria-hidden="true" />
          <strong>{snapshot.horizon_days} calendar days</strong>
          <span aria-hidden="true" />
        </span>
        <span className="forecast-window-date forecast-window-end">
          <small>Forecast ends</small>
          <strong>{formatForecastDate(endDate)}</strong>
        </span>
      </div>
      <div
        className="crypto-chart"
        ref={container}
        role="img"
        aria-label={`${asset} historical USD prices with ${snapshot.horizon_days}-day P10, P50, and P90 forecast overlays ending ${formatForecastDate(endDate)}`}
      />
      <dl className="forecast-values" aria-label={`${asset} forecast values`}>
        {values.map(([label, rawReturn]) => {
          const returnValue = Number(rawReturn);
          return (
            <div
              className={`forecast-value forecast-value-${label}`}
              key={label}
            >
              <dt>{label}</dt>
              <dd>{formatForecastPrice(last.value * (1 + returnValue))}</dd>
              <dd>{formatForecastReturn(returnValue)}</dd>
            </div>
          );
        })}
      </dl>
      {p50Return === 0 && (
        <p className="forecast-median-note">
          <strong>P50 matches the latest observed price</strong> because the
          approved model's median {snapshot.horizon_days}-day return is 0.00%.
          It is a no-change forecast, not another observed price.
        </p>
      )}
    </div>
  );
}
