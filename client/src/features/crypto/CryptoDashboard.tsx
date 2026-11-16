import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FlaskConical, ShieldCheck } from "lucide-react";

import type {
  PortfolioRecommendation,
  SevenDayForecast,
} from "../../lib/api/client";
import { MonthPicker } from "../../components/MonthPicker";
import {
  currentMonth,
  formatUsd,
  minorUnitsToUsdInput,
  usdToMinorUnits,
} from "../finance/money";
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

function formatSavingsMonth(month: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export function CryptoDashboard({ accessToken }: { accessToken: string }) {
  const [savingsMonth, setSavingsMonth] = useState(currentMonth);
  const dashboard = useCryptoDashboard(accessToken, savingsMonth);
  const [asset, setAsset] = useState<Asset>("BTC");
  const [capital, setCapital] = useState<string | null>(null);
  const [capitalError, setCapitalError] = useState<string | null>(null);
  const snapshotId = dashboard.forecast.data?.snapshot_id;
  const riskProfile = dashboard.riskProfile.data?.profile;
  const availableSavings =
    dashboard.financeOverview.data?.summary.savings.available.minor_units;

  useEffect(() => {
    if (availableSavings === undefined) return;
    setCapital(minorUnitsToUsdInput(availableSavings));
  }, [availableSavings]);

  useEffect(() => {
    if (
      snapshotId === undefined ||
      riskProfile === null ||
      riskProfile === undefined ||
      capital === null
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
        title="Loading 7-day Research Forecast…"
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
          <p className="eyebrow">Crypto Intelligence</p>
          <h1 id="crypto-title">Savings, translated into portfolio!</h1>
          <p className="lede">
            Explore AI-powered 7-day BTC, ETH, and SOL price forecasts and
            personalized portfolio recommendations tailored to your savings and
            risk profile.
          </p>
        </div>
        <div className="crypto-header-actions">
          <ForecastStatus forecast={forecast} />
          <MonthPicker
            label="Savings month"
            month={savingsMonth}
            onChange={setSavingsMonth}
          />
        </div>
      </section>

      <section className="crypto-top-row" aria-label="Portfolio setup">
        <InvestmentCapitalCard
          availableSavings={availableSavings}
          capital={capital}
          capitalError={capitalError}
          financeError={
            dashboard.financeOverview.isError
              ? dashboard.financeOverview.error.message
              : undefined
          }
          financePending={dashboard.financeOverview.isPending}
          month={savingsMonth}
          onChange={setCapital}
        />
        <RiskQuestionnaire
          profile={riskProfile}
          projectionVersion={
            dashboard.riskProfile.data?.projection_version ?? 0
          }
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
      </section>

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
        <MarketOverview forecast={forecast} />
        <CryptoChart forecast={forecast} asset={asset} />
        <p className="panel-note">
          Solid marker: observed cutoff price. The Historical Error Range is
          derived from the selected model&apos;s held-out residuals; it is a
          visualization-only summary of past error, not a validated 80%
          prediction interval or a price guarantee. Portfolio calculations
          continue to use the original seven-day research forecast.
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
        </div>
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
        {dashboard.recommendation.data !== undefined &&
          capitalError === null && (
            <RecommendationPanel
              recommendation={dashboard.recommendation.data}
            />
          )}
        <MethodologySection forecast={forecast} />
      </section>

      <MethodProvenance forecast={forecast} />
    </div>
  );
}

function ForecastStatus({ forecast }: { forecast: SevenDayForecast }) {
  const isCurrent = forecast.status === "current";
  const tooltipId = "forecast-status-details";
  return (
    <div className="forecast-status">
      <button
        aria-describedby={tooltipId}
        aria-label={`${isCurrent ? "Current" : "Stale"} forecast details`}
        className={`forecast-status-pill forecast-status-trigger ${forecast.status}`}
        type="button"
      >
        {isCurrent ? (
          <ShieldCheck aria-hidden="true" size={17} />
        ) : (
          <AlertTriangle aria-hidden="true" size={17} />
        )}
        {isCurrent ? "Current forecast" : "Stale forecast"}
      </button>
      <div className="forecast-status-tooltip" id={tooltipId} role="tooltip">
        <p>Generated {formatTimestamp(forecast.generated_at_utc)}</p>
        <p>
          Market cutoff{" "}
          {formatForecastDate(forecast.market_data_cutoff_utc.slice(0, 10))}
        </p>
        {forecast.stale_reasons.length > 0 && (
          <div className="forecast-status-warning">
            <strong>Forecast freshness warning</strong>
            <ul>
              {forecast.stale_reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function InvestmentCapitalCard({
  availableSavings,
  capital,
  capitalError,
  financeError,
  financePending,
  month,
  onChange,
}: {
  availableSavings: number | undefined;
  capital: string | null;
  capitalError: string | null;
  financeError: string | undefined;
  financePending: boolean;
  month: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="panel capital-card" aria-labelledby="capital-title">
      <div className="capital-card-heading">
        <div>
          <p className="section-kicker">Portfolio starting point</p>
          <h2 id="capital-title">Investment Capital</h2>
        </div>
        <span className="capital-source">Available savings</span>
      </div>
      <label className="capital-edit-field">
        <span className="sr-only">Investment Capital (USD)</span>
        <span aria-hidden="true">$</span>
        <input
          aria-label="Investment Capital (USD)"
          disabled={financePending}
          inputMode="decimal"
          value={capital ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {financePending && (
        <p className="capital-disclaimer" role="status">
          Loading available savings from Personal Finance…
        </p>
      )}
      {financeError !== undefined && (
        <p className="form-error" role="alert">
          Available savings could not be loaded: {financeError}
        </p>
      )}
      {availableSavings !== undefined && (
        <p className="capital-disclaimer">
          Default: <strong>{formatUsd(availableSavings)}</strong> available
          savings from Personal Finance for {formatSavingsMonth(month)}.
        </p>
      )}
      <p className="capital-disclaimer">
        Changing this amount runs a read-only scenario and never updates
        Finance.
      </p>
      {capitalError !== null && (
        <p className="form-error" role="alert">
          {capitalError}
        </p>
      )}
    </section>
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
          <RiskScore
            projectionVersion={projectionVersion}
            score={profile.score}
          />
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
      {profile === undefined && (
        <p className="panel-note" role="status">
          Loading saved risk profile…
        </p>
      )}
      {profile === null && (
        <p className="panel-note">
          Save your risk profile to calculate a questionnaire-led allocation.
        </p>
      )}
    </section>
  );
}

function RiskScore({
  projectionVersion,
  score,
}: {
  projectionVersion: number;
  score: number;
}) {
  const tooltipId = "risk-score-details";
  return (
    <div className="risk-score">
      <button
        aria-describedby={tooltipId}
        aria-label={`Risk score ${score} details`}
        className="freshness-pill risk-score-trigger"
        type="button"
      >
        Score {score}
      </button>
      <div className="risk-score-tooltip" id={tooltipId} role="tooltip">
        Profile version {projectionVersion}; responses are wallet-scoped and
        informational only.
      </div>
    </div>
  );
}

function MarketOverview({ forecast }: { forecast: SevenDayForecast }) {
  return (
    <section
      className="phase2-market-section"
      aria-labelledby="market-overview-title"
    >
      <div className="phase2-market-intro">
        <div>
          <p className="section-kicker">BTC · ETH · SOL market snapshot</p>
          <h3 id="market-overview-title">Crypto Market Overview</h3>
          <p>Observed cutoff price and the model&apos;s Day 7 reference.</p>
        </div>
      </div>
      <div className="phase2-market-grid">
        {forecast.assets.map((item) => {
          const change = Number(item.predicted_return_7d);
          return (
            <article
              className={`phase2-market-card ${item.asset.toLowerCase()} ${change >= 0 ? "positive" : "negative"}`}
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

function MethodologySection({ forecast }: { forecast: SevenDayForecast }) {
  return (
    <section className="portfolio-methodology" aria-labelledby="method-title">
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
    </section>
  );
}

function MethodProvenance({ forecast }: { forecast: SevenDayForecast }) {
  return (
    <>
      <details className="provenance-panel crypto-provenance-panel" open>
        <summary>Historical model accuracy and provenance</summary>
        <div className="provenance-columns crypto-provenance-columns">
          <section className="provenance-column">
            <h3>Historical model accuracy</h3>
            <div className="crypto-accuracy-grid">
              {forecast.accuracy.map((item) => (
                <article key={item.model_key}>
                  <strong>
                    {item.model_key === "original-mspciformer"
                      ? "Original MSPCIFormer"
                      : "VASA-MSPCIFormer"}
                  </strong>
                  <dl>
                    <div>
                      <dt>Holdout MAPE</dt>
                      <dd>{formatForecastReturn(Number(item.mape))}</dd>
                    </div>
                    <div>
                      <dt>7-day return MAE</dt>
                      <dd>
                        {formatForecastReturn(Number(item.return_7d_mae))}
                      </dd>
                    </div>
                    <div>
                      <dt>Directional accuracy</dt>
                      <dd>
                        {formatForecastReturn(
                          Number(item.directional_accuracy),
                        )}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>
          <section className="provenance-column">
            <h3>Forecast provenance</h3>
            <p>
              Snapshot <code>{forecast.snapshot_id}</code>
            </p>
            <p>
              Run <code>{forecast.run_id}</code>
            </p>
            <p>
              Model <code>{forecast.model_version}</code>
            </p>
            <p>
              Completed-market cutoff{" "}
              <strong>
                {formatForecastDate(
                  forecast.market_data_cutoff_utc.slice(0, 10),
                )}
              </strong>
              ; status <strong>{forecast.status}</strong>.
            </p>
          </section>
        </div>
      </details>
    </>
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
