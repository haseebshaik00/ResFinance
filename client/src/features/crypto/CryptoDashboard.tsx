import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FlaskConical, ShieldCheck } from "lucide-react";

import type {
  PortfolioRecommendation,
  SevenDayForecast,
} from "../../lib/api/client";
import { formatUsd, usdToMinorUnits } from "../finance/money";
import { CryptoChart } from "./CryptoChart";
import {
  formatForecastDate,
  formatForecastPrice,
  formatForecastReturn,
} from "./forecastChart";
import { useCryptoDashboard } from "./useCryptoDashboard";

type Asset = "BTC" | "ETH" | "SOL";
const ASSETS: Asset[] = ["BTC", "ETH", "SOL"];
const ASSET_NAMES: Record<Asset, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
};

export function CryptoDashboard({ accessToken }: { accessToken: string }) {
  const dashboard = useCryptoDashboard(accessToken);
  const [asset, setAsset] = useState<Asset>("BTC");
  const [capital, setCapital] = useState("1000.00");
  const [capitalError, setCapitalError] = useState<string | null>(null);
  const snapshotId = dashboard.forecast.data?.snapshot_id;
  const riskProfile = dashboard.riskProfile.data?.profile;

  useEffect(() => {
    if (
      snapshotId === undefined ||
      riskProfile === null ||
      riskProfile === undefined
    )
      return;
    const timer = window.setTimeout(() => {
      try {
        const minorUnits = usdToMinorUnits(capital);
        if (minorUnits <= 0)
          throw new Error("Investment capital must be greater than zero.");
        setCapitalError(null);
        dashboard.recommendation.mutate({
          capital: { currency: "USD", minor_units: minorUnits },
        });
      } catch (error) {
        setCapitalError(
          error instanceof Error ? error.message : "Enter a valid USD amount.",
        );
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [capital, snapshotId, riskProfile?.source_event_id]);

  if (dashboard.forecast.isPending) {
    return (
      <DashboardState
        title="Loading seven-day research forecast…"
        text="Verifying the selected MSPCIFormer model, immutable artifacts, and latest completed UTC market data."
      />
    );
  }
  if (dashboard.forecast.isError) {
    return (
      <DashboardState
        title="Crypto Intelligence is unavailable."
        text={dashboard.forecast.error.message}
        error
      />
    );
  }

  const forecast = dashboard.forecast.data;
  return (
    <div className="finance-dashboard crypto-dashboard phase2-dashboard">
      <section className="dashboard-header" aria-labelledby="crypto-title">
        <div>
          <p className="eyebrow">Experimental · Seven-day outlook</p>
          <h1 id="crypto-title">Crypto Intelligence</h1>
          <p className="lede">
            Review validation-selected MSPCIFormer forecasts and a transparent,
            long-only BTC/ETH/SOL sleeve with an optional USD cash reserve. No
            trades are executed.
          </p>
        </div>
        <span className={`forecast-status-pill ${forecast.status}`}>
          {forecast.status === "current" ? (
            <ShieldCheck size={17} />
          ) : (
            <AlertTriangle size={17} />
          )}
          {forecast.status === "current"
            ? "Current forecast"
            : "Stale forecast"}
        </span>
      </section>

      {forecast.stale_reasons.length > 0 && (
        <section className="phase2-warning" role="alert">
          <AlertTriangle aria-hidden="true" size={20} />
          <div>
            <strong>Forecast freshness warning</strong>
            {forecast.stale_reasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
          </div>
        </section>
      )}

      <MarketOverview forecast={forecast} />

      <RiskQuestionnaire
        profile={riskProfile}
        projectionVersion={dashboard.riskProfile.data?.projection_version ?? 0}
        pending={dashboard.saveRiskProfile.isPending}
        error={
          dashboard.riskProfile.isError || dashboard.saveRiskProfile.isError
            ? (dashboard.riskProfile.error ?? dashboard.saveRiskProfile.error)
                ?.message
            : undefined
        }
        onSave={(answers) =>
          dashboard.saveRiskProfile.mutate({
            answers,
            expected_version:
              dashboard.riskProfile.data?.projection_version ?? 0,
          })
        }
      />

      <section
        className="panel phase2-outlook"
        aria-labelledby="forecast-chart-title"
      >
        <div className="section-heading compact">
          <div>
            <p className="section-kicker">Current observation + model output</p>
            <h2 id="forecast-chart-title">Seven-Day Price Outlook</h2>
          </div>
          <div className="asset-switcher" aria-label="Chart asset">
            {ASSETS.map((value) => (
              <button
                key={value}
                className={value === asset ? "active" : ""}
                type="button"
                onClick={() => setAsset(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <CryptoChart forecast={forecast} asset={asset} />
        <p className="panel-note">
          Solid marker: observed cutoff price. Dashed line: seven future model
          predictions, not realized prices.
        </p>
      </section>

      <section
        className="panel phase2-portfolio"
        aria-labelledby="allocation-title"
      >
        <div className="section-heading">
          <div>
            <p className="section-kicker">Model-informed diversification</p>
            <h2 id="allocation-title">Portfolio Allocation</h2>
          </div>
          <label className="investment-capital-field">
            <span>Investment Capital (USD)</span>
            <span className="capital-input-shell">
              <span aria-hidden="true">$</span>
              <input
                aria-label="Investment Capital (USD)"
                inputMode="decimal"
                value={capital}
                onChange={(event) => setCapital(event.target.value)}
              />
            </span>
          </label>
        </div>
        {capitalError !== null && (
          <p className="form-error" role="alert">
            {capitalError}
          </p>
        )}
        {dashboard.recommendation.isError && (
          <p className="form-error" role="alert">
            {dashboard.recommendation.error.message}
          </p>
        )}
        {dashboard.recommendation.isPending && (
          <p className="panel-note" role="status">
            Calculating the portfolio…
          </p>
        )}
        {riskProfile === undefined && (
          <p className="panel-note" role="status">
            Loading saved risk profile…
          </p>
        )}
        {riskProfile === null && (
          <p className="panel-note">
            Save your risk profile to calculate a questionnaire-led allocation.
          </p>
        )}
        {dashboard.recommendation.data !== undefined &&
          capitalError === null && (
            <RecommendationPanel
              recommendation={dashboard.recommendation.data}
            />
          )}
      </section>

      <MethodPanel forecast={forecast} />
    </div>
  );
}

function RiskQuestionnaire({
  profile,
  projectionVersion,
  pending,
  error,
  onSave,
}: {
  profile:
    | {
        answers: {
          investment_horizon: number;
          risk_tolerance: number;
          liquidity_needs: number;
        };
        score: number;
      }
    | null
    | undefined;
  projectionVersion: number;
  pending: boolean;
  error: string | undefined;
  onSave: (answers: {
    investment_horizon: number;
    risk_tolerance: number;
    liquidity_needs: number;
  }) => void;
}) {
  const [answers, setAnswers] = useState({
    investment_horizon: 2,
    risk_tolerance: 2,
    liquidity_needs: 2,
  });
  const labels = [
    [
      "Investment horizon",
      "How long can this hypothetical allocation remain invested?",
    ],
    [
      "Risk tolerance",
      "How comfortable are you with substantial price changes?",
    ],
    ["Liquidity needs", "How soon might you need this hypothetical capital?"],
  ] as const;
  const keys = [
    "investment_horizon",
    "risk_tolerance",
    "liquidity_needs",
  ] as const;
  return (
    <section
      className="panel risk-questionnaire-card"
      aria-labelledby="risk-profile-title"
    >
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Strategic allocation policy</p>
          <h2 id="risk-profile-title">Risk Questionnaire</h2>
        </div>
        {profile !== null && profile !== undefined && (
          <span className="forecast-status-pill current">
            Score {profile.score}
          </span>
        )}
      </div>
      <p className="panel-note">
        Your answers set the BTC, ETH, SOL, and cash targets. The forecast can
        refine only the crypto sleeve.
      </p>
      <div className="risk-form">
        {keys.map((key, index) => (
          <label className="form-field" key={key}>
            <span>{labels[index]![0]}</span>
            <small>{labels[index]![1]}</small>
            <select
              aria-label={labels[index]![0]}
              value={answers[key]}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [key]: Number(event.target.value),
                }))
              }
            >
              <option value={1}>1 — Low</option>
              <option value={2}>2 — Medium</option>
              <option value={3}>3 — High</option>
            </select>
          </label>
        ))}
        <button
          className="primary-button"
          disabled={pending}
          onClick={() => onSave(answers)}
          type="button"
        >
          {pending
            ? "Saving…"
            : profile === null
              ? "Save risk profile"
              : "Update risk profile"}
        </button>
      </div>
      {error !== undefined && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="panel-note">
        Profile version {projectionVersion}; responses are wallet-scoped and
        informational only.
      </p>
    </section>
  );
}

function MarketOverview({ forecast }: { forecast: SevenDayForecast }) {
  return (
    <section
      className="phase2-market-section"
      aria-labelledby="market-overview-title"
    >
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">BTC · ETH · SOL</p>
          <h2 id="market-overview-title">Crypto Market Overview</h2>
        </div>
        <p className="forecast-timestamps">
          Generated {formatTimestamp(forecast.generated_at_utc)}
          <br />
          Market cutoff{" "}
          {formatForecastDate(forecast.market_data_cutoff_utc.slice(0, 10))}
        </p>
      </div>
      <div className="phase2-market-grid">
        {forecast.assets.map((item) => {
          const change = Number(item.predicted_return_7d);
          return (
            <article
              className={`phase2-market-card ${change >= 0 ? "positive" : "negative"}`}
              key={item.asset}
            >
              <div>
                <span>{item.asset}</span>
                <small>{ASSET_NAMES[item.asset]}</small>
              </div>
              <dl>
                <div>
                  <dt>Observed</dt>
                  <dd>{formatForecastPrice(Number(item.current_price))}</dd>
                </div>
                <div>
                  <dt>Predicted Day 7</dt>
                  <dd>
                    {formatForecastPrice(Number(item.predicted_prices[6]))}
                  </dd>
                </div>
                <div>
                  <dt>Predicted 7-day return</dt>
                  <dd>{formatForecastReturn(change)}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RecommendationPanel({
  recommendation,
}: {
  recommendation: PortfolioRecommendation;
}) {
  const allocations = useMemo(
    () =>
      [...recommendation.allocations].sort(
        (a, b) => ASSETS.indexOf(a.asset) - ASSETS.indexOf(b.asset),
      ),
    [recommendation.allocations],
  );
  const percentages = allocations.map((item) => Number(item.weight) * 100);
  const btcEnd = percentages[0] ?? 0;
  const ethEnd = btcEnd + (percentages[1] ?? 0);
  const solEnd = ethEnd + (percentages[2] ?? 0);
  const gradient = `conic-gradient(#6555a5 0 ${btcEnd}%, #2c9c91 ${btcEnd}% ${ethEnd}%, #d49735 ${ethEnd}% ${solEnd}%, #607184 ${solEnd}% 100%)`;
  const adjustments = new Map(
    recommendation.tactical_adjustments.map((item) => [
      item.asset,
      item.weight,
    ]),
  );
  return (
    <div className="recommendation-layout">
      <div className="allocation-donut-wrap">
        <div
          className="allocation-donut"
          style={{ background: gradient }}
          role="img"
          aria-label={allocations
            .map(
              (item) =>
                `${item.asset} ${formatAllocationWeight(item.weight)}, ${formatUsd(item.amount.minor_units)}`,
            )
            .concat(
              `USD cash reserve ${formatAllocationWeight(recommendation.cash_reserve.weight)}, ${formatUsd(recommendation.cash_reserve.amount.minor_units)}`,
            )
            .join("; ")}
        >
          <span>
            <strong>
              {formatAllocationWeight(recommendation.crypto_allocation_weight)}
            </strong>
            <small>crypto sleeve</small>
          </span>
        </div>
        <span
          className={`forecast-status-pill ${recommendation.forecast_status}`}
        >
          {recommendation.forecast_status} inputs
        </span>
      </div>
      <div className="allocation-table-wrap">
        <p className="panel-note">
          {recommendation.risk_profile} profile · score{" "}
          {recommendation.risk_score} · cash fixed at{" "}
          {formatAllocationWeight(recommendation.strategic_cash_reserve.weight)}
        </p>
        <table className="allocation-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Allocation</th>
              <th className="tactical-adjustment">Model adjustment</th>
              <th>Investment</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((item) => (
              <tr key={item.asset}>
                <th>
                  <i className={`asset-dot ${item.asset.toLowerCase()}`} />
                  {item.asset}
                </th>
                <td>{formatAllocationWeight(item.weight)}</td>
                <td className="tactical-adjustment">
                  {formatForecastReturn(
                    Number(adjustments.get(item.asset) ?? 0),
                  )}
                </td>
                <td>{formatUsd(item.amount.minor_units)}</td>
              </tr>
            ))}
            <tr className="cash-reserve-row">
              <th>
                <i className="asset-dot cash" />
                USD cash reserve
              </th>
              <td>
                {formatAllocationWeight(recommendation.cash_reserve.weight)}
              </td>
              <td className="tactical-adjustment">Fixed</td>
              <td>
                {formatUsd(recommendation.cash_reserve.amount.minor_units)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <td>
                {(Number(recommendation.total_allocation_weight) * 100).toFixed(
                  2,
                )}
                %
              </td>
              <td className="tactical-adjustment">—</td>
              <td>{formatUsd(recommendation.capital.minor_units)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="portfolio-metrics">
          <span>
            <small>Predicted portfolio return</small>
            <strong>
              {formatForecastReturn(
                Number(recommendation.predicted_portfolio_return_7d),
              )}
            </strong>
          </span>
          <span>
            <small>Estimated 7-day volatility</small>
            <strong>
              {formatForecastReturn(
                Number(recommendation.estimated_portfolio_volatility_7d),
              )}
            </strong>
          </span>
        </div>
        <p className="panel-note">
          Model confidence:{" "}
          {(Number(recommendation.model_confidence) * 100).toFixed(2)}%;
          strategic targets are blended with the forecast/covariance model mix.
        </p>
      </div>
      {recommendation.warnings.map((warning) => (
        <p className="panel-note recommendation-warning" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}

function MethodPanel({ forecast }: { forecast: SevenDayForecast }) {
  return (
    <section className="panel phase2-method" aria-labelledby="method-title">
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Transparent methodology</p>
          <h2 id="method-title">How Recommendations Are Calculated</h2>
        </div>
        <FlaskConical aria-hidden="true" size={28} />
      </div>
      <ol className="method-steps">
        <li>
          <strong>Forecast</strong>
          <span>Validation-selected MSPCIFormer predicts Days 1–7.</span>
        </li>
        <li>
          <strong>Return</strong>
          <span>Day-7 price ÷ observed price − 1.</span>
        </li>
        <li>
          <strong>Risk</strong>
          <span>Ledoit–Wolf daily covariance over 365 days, scaled ×7.</span>
        </li>
        <li>
          <strong>Allocate</strong>
          <span>
            The questionnaire fixes crypto exposure and USD cash. The forecast
            applies a confidence-weighted BTC/ETH/SOL model blend inside that
            selected crypto sleeve.
          </span>
        </li>
      </ol>
      <div className="method-facts">
        <span>
          Model <strong>{forecast.model_name}</strong>
        </span>
        <span>
          Horizon <strong>Seven days</strong>
        </span>
        <span>
          Status <strong>Experimental</strong>
        </span>
        <span>
          Execution <strong>No trades</strong>
        </span>
      </div>
      <details className="accuracy-panel">
        <summary>Historical model accuracy and provenance</summary>
        <div className="accuracy-grid">
          {forecast.accuracy.map((item) => (
            <article key={item.model_key}>
              <strong>
                {item.model_key === "original-mspciformer"
                  ? "Original MSPCIFormer"
                  : "VASA-MSPCIFormer"}
              </strong>
              <span>
                Holdout MAPE {formatForecastReturn(Number(item.mape))}
              </span>
              <span>
                7-day return MAE{" "}
                {formatForecastReturn(Number(item.return_7d_mae))}
              </span>
              <span>
                Directional accuracy{" "}
                {formatForecastReturn(Number(item.directional_accuracy))}
              </span>
            </article>
          ))}
        </div>
        <p>
          Run <code>{forecast.run_id}</code> · Model{" "}
          <code>{forecast.model_version}</code>
        </p>
      </details>
    </section>
  );
}

function DashboardState({
  title,
  text,
  error = false,
}: {
  title: string;
  text: string;
  error?: boolean;
}) {
  return (
    <section
      className={`dashboard-state${error ? " error-state" : ""}`}
      role={error ? "alert" : "status"}
    >
      <span className="loading-orb" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatAllocationWeight(weight: string): string {
  const percentage = Number(weight) * 100;
  if (percentage > 0 && percentage < 0.01) return "<0.01%";
  return `${percentage.toFixed(2)}%`;
}
