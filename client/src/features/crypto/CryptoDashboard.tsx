import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  Check,
  CircleHelp,
  FileText,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  type PieLabelRenderProps,
} from "recharts";

import type {
  PortfolioRecommendation,
  SevenDayForecast,
} from "../../lib/api/client";
import { MonthPicker } from "../../components/MonthPicker";
import { chartFontFamily } from "../../lib/chartTooltip";
import { useAnimateWhenVisible } from "../../lib/useAnimateWhenVisible";
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
type AllocationAsset = Asset | "USD";
const ASSETS: Asset[] = ["BTC", "ETH", "SOL"];
const ASSET_NAMES: Record<Asset, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
};
const ASSET_LOGOS: Record<Asset, string> = {
  BTC: "/patterns/icons/btc.png",
  ETH: "/patterns/icons/eth.png",
  SOL: "/patterns/icons/sol.png",
};
const USD_LOGO = "/patterns/icons/usd.png";
const ASSET_COLORS: Record<AllocationAsset, string> = {
  BTC: "var(--btc-color)",
  ETH: "var(--eth-color)",
  SOL: "var(--sol-color)",
  USD: "var(--cash-color)",
};
const PIE_ANIMATION_MS = 900;
const DONUT_INNER_RADIUS = 76;
const DONUT_OUTER_RADIUS = 120;
const DONUT_LABEL_OFFSET = 28;
const DONUT_LABEL_SIDE_EXTRA = 10;
const DONUT_ACTIVE_EXPAND = 12;

function formatSavingsMonth(month: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function formatRiskProfile(profile: PortfolioRecommendation["risk_profile"]) {
  return `${profile.charAt(0).toUpperCase()}${profile.slice(1)}`;
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
      <div className="phase2-market-layout">
        <MarketOverview forecast={forecast} />
        <section
          className="panel phase2-outlook"
          aria-labelledby="forecast-chart-title"
        >
          <div className="section-heading compact">
            <div>
              <p className="section-kicker">
                Model observation & Price Outlook
              </p>
              <h2 id="forecast-chart-title">AI-Powered 7-Day Price Forecast</h2>
            </div>
            <div className="forecast-chart-actions">
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
              <div className="forecast-chart-info">
                <button
                  aria-describedby="forecast-chart-info-tooltip"
                  aria-label="Forecast chart details"
                  className="dashboard-info-button forecast-chart-info-trigger"
                  type="button"
                >
                  <CircleHelp size={18} aria-hidden="true" />
                </button>
                <div
                  className="forecast-chart-info-tooltip"
                  id="forecast-chart-info-tooltip"
                  role="tooltip"
                >
                  <ul>
                    <li>Solid marker: observed cutoff price.</li>
                    <li>
                      The Historical Error Range is derived from the selected
                      model&apos;s held-out residuals.
                    </li>
                    <li>
                      It is a visualization-only summary of past error, not a
                      validated 80% prediction interval or a price guarantee.
                    </li>
                    <li>
                      Portfolio calculations continue to use the original
                      seven-day research forecast.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <CryptoChart forecast={forecast} asset={asset} />
        </section>
      </div>

      <div className="portfolio-section-heading">
        <div>
          <p className="section-kicker">Model Informed Diversification</p>
          <h2 id="allocation-title">Portfolio Allocation</h2>
        </div>
        <div className="portfolio-heading-actions">
          <MethodologyInfo
            forecast={forecast}
            modelConfidence={dashboard.recommendation.data?.model_confidence}
            warnings={dashboard.recommendation.data?.warnings ?? []}
          />
          <a
            aria-label="Open portfolio allocation research PDF"
            className="dashboard-info-button portfolio-research-link"
            href="https://github.com/haseebshaik00/ResFinance/blob/feat/haseeb-base-crypto-research/docs/research/ResFinance-Research-Flow.pdf"
            rel="noreferrer"
            target="_blank"
            title="Research behind this allocation"
          >
            <FileText size={22} aria-hidden="true" />
          </a>
          {riskProfile !== null && riskProfile !== undefined && (
            <RiskScore
              projectionVersion={
                dashboard.riskProfile.data?.projection_version ?? 0
              }
              score={riskProfile.score}
            />
          )}
        </div>
      </div>
      <section
        className="panel phase2-portfolio"
        aria-labelledby="allocation-title"
      >
        <div className="portfolio-setup-row" aria-label="Portfolio setup">
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
            recommendationPending={dashboard.recommendation.isPending}
            onChange={setCapital}
          />
          <RiskQuestionnaire
            profile={riskProfile}
            pending={dashboard.saveRiskProfile.isPending}
            error={
              dashboard.riskProfile.isError || dashboard.saveRiskProfile.isError
                ? (
                    dashboard.riskProfile.error ??
                    dashboard.saveRiskProfile.error
                  )?.message
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
  recommendationPending,
  onChange,
}: {
  availableSavings: number | undefined;
  capital: string | null;
  capitalError: string | null;
  financeError: string | undefined;
  financePending: boolean;
  month: string;
  recommendationPending: boolean;
  onChange: (value: string) => void;
}) {
  const [draftCapital, setDraftCapital] = useState(capital ?? "");
  const [scenarioActive, setScenarioActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (capital !== null) setDraftCapital(capital);
  }, [capital]);

  useEffect(() => {
    if (availableSavings !== undefined) setScenarioActive(false);
  }, [availableSavings]);

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (usdToMinorUnits(draftCapital) <= 0) {
        throw new Error("Investment capital must be greater than zero.");
      }
      setValidationError(null);
      setScenarioActive(true);
      onChange(draftCapital);
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "Enter a valid USD amount.",
      );
    }
  }

  return (
    <section className="capital-card" aria-labelledby="capital-title">
      <div className="capital-card-heading">
        <div>
          <p className="section-kicker">Investment Capital</p>
        </div>
        <span className="capital-source">Available savings</span>
      </div>
      <form className="capital-scenario-form" onSubmit={submit}>
        <label className="capital-edit-field">
          <span className="sr-only">Investment Capital (USD)</span>
          <span aria-hidden="true">$</span>
          <input
            aria-label="Investment Capital (USD)"
            disabled={financePending || recommendationPending}
            inputMode="decimal"
            value={draftCapital}
            onChange={(event) => setDraftCapital(event.target.value)}
          />
        </label>
        <button
          className="capital-scenario-button"
          disabled={financePending || recommendationPending}
          type="submit"
        >
          <Check aria-hidden="true" size={16} />
          {recommendationPending ? "Analyzing…" : "Analyze scenario"}
        </button>
        {validationError !== null && (
          <p className="form-error" role="alert">
            {validationError}
          </p>
        )}
      </form>
      {availableSavings !== undefined && (
        <p className="capital-disclaimer">
          Finance default: <strong>{formatUsd(availableSavings)}</strong> for{" "}
          {formatSavingsMonth(month)}. Alternate amounts are read-only.
        </p>
      )}
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
      {scenarioActive && capital !== null && (
        <p className="scenario-result">
          <Check aria-hidden="true" size={16} />
          <span>
            <strong>Scenario active: </strong>${capital}. Finance default
            unchanged.
          </span>
        </p>
      )}
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
  const labels = ["Investment horizon", "Risk tolerance", "Liquidity needs"];
  const keys = [
    "investment_horizon",
    "risk_tolerance",
    "liquidity_needs",
  ] as const;
  return (
    <section
      className="risk-questionnaire-card"
      aria-labelledby="risk-profile-title"
    >
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Strategic allocation policy</p>
          <h2 id="risk-profile-title">Risk Questionnaire</h2>
        </div>
      </div>
      <div className="risk-form">
        {keys.map((key, index) => (
          <label className="form-field" key={key}>
            <span>{labels[index]}</span>
            <select
              aria-label={labels[index]}
              value={answers[key]}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [key]: Number(event.target.value),
                }))
              }
            >
              <option value={1}>1 - Low</option>
              <option value={2}>2 - Medium</option>
              <option value={3}>3 - High</option>
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
              ? "Save Risk Profile"
              : "Update Risk Profile"}
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
        className="dashboard-info-button risk-score-trigger"
        type="button"
      >
        {score}
      </button>
      <div className="risk-score-tooltip" id={tooltipId} role="tooltip">
        <ul>
          <strong className="risk-score-profile-version">
            [Profile version {projectionVersion}]
          </strong>
          <li>Your answers set the BTC, ETH, SOL, and cash targets.</li>
          <li>The forecast can refine only the crypto sleeve.</li>
          <li>The responses are wallet-scoped and informational only.</li>
        </ul>
      </div>
    </div>
  );
}

function MarketOverview({ forecast }: { forecast: SevenDayForecast }) {
  const { ref, animated } = useAnimateWhenVisible<HTMLElement>();
  return (
    <section
      ref={ref}
      className="phase2-market-section"
      data-animated={animated ? "true" : "false"}
      aria-labelledby="market-overview-title"
    >
      <div className="phase2-market-intro">
        <div>
          <p className="section-kicker">BTC · ETH · SOL market snapshot</p>
          <h3 id="market-overview-title">Crypto Market Overview</h3>
          <p>Observed Cutoff Price and the model&apos;s Day 7 Reference.</p>
        </div>
      </div>
      <div className="phase2-market-grid">
        {forecast.assets.map((item, index) => {
          const change = Number(item.predicted_return_7d);
          return (
            <article
              className={`phase2-market-card ${item.asset.toLowerCase()} ${change >= 0 ? "positive" : "negative"}`}
              key={item.asset}
              style={{ "--market-card-index": index } as CSSProperties}
            >
              <div className="phase2-market-card-header">
                <img
                  alt=""
                  className="phase2-market-card-logo"
                  height={28}
                  src={ASSET_LOGOS[item.asset]}
                  width={28}
                />
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

type AllocationSlice = {
  key: AllocationAsset;
  name: string;
  shortName: string;
  weight: string;
  amount: number;
  color: string;
  logo: string;
  adjustmentLabel: string;
  value: number;
};

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
  const adjustments = useMemo(
    () =>
      new Map(
        recommendation.tactical_adjustments.map((item) => [
          item.asset,
          item.weight,
        ]),
      ),
    [recommendation.tactical_adjustments],
  );
  const slices = useMemo<AllocationSlice[]>(
    () => [
      ...allocations.map((item) => ({
        key: item.asset,
        name: ASSET_NAMES[item.asset],
        shortName: item.asset,
        weight: item.weight,
        amount: item.amount.minor_units,
        color: ASSET_COLORS[item.asset],
        logo: ASSET_LOGOS[item.asset],
        adjustmentLabel: formatForecastReturn(
          Number(adjustments.get(item.asset) ?? 0),
        ),
        value: Math.max(Number(item.weight), 0),
      })),
      {
        key: "USD",
        name: "USD cash reserve",
        shortName: "USD",
        weight: recommendation.cash_reserve.weight,
        amount: recommendation.cash_reserve.amount.minor_units,
        color: ASSET_COLORS.USD,
        logo: USD_LOGO,
        adjustmentLabel: "Fixed",
        value: Math.max(Number(recommendation.cash_reserve.weight), 0),
      },
    ],
    [allocations, adjustments, recommendation.cash_reserve],
  );

  return (
    <div className="recommendation-layout">
      <AllocationDonut slices={slices} />
      <div className="allocation-table-wrap">
        <p className="panel-note">
          {formatRiskProfile(recommendation.risk_profile)} Profile · Risk Score{" "}
          {recommendation.risk_score} · Cash{" "}
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
                  <span className="allocation-asset">
                    <img
                      alt=""
                      className="allocation-asset-logo"
                      height={22}
                      src={ASSET_LOGOS[item.asset]}
                      width={22}
                    />
                    <span>{item.asset}</span>
                  </span>
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
                <span className="allocation-asset">
                  <img
                    alt=""
                    className="allocation-asset-logo"
                    height={22}
                    src={USD_LOGO}
                    width={22}
                  />
                  <span>USD cash reserve</span>
                </span>
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
        <div className="portfolio-summary-footer">
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
        </div>
      </div>
    </div>
  );
}

function AllocationDonut({ slices }: { slices: AllocationSlice[] }) {
  const { ref, animated } = useAnimateWhenVisible<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const ariaLabel = slices
    .map(
      (slice) =>
        `${slice.name} ${formatAllocationWeight(slice.weight)}, ${formatUsd(slice.amount)}`,
    )
    .join("; ");

  useEffect(() => {
    if (!animated) return;
    const timer = window.setTimeout(() => setIntroDone(true), PIE_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [animated]);

  return (
    <div className="allocation-donut-wrap">
      <div
        ref={ref}
        className="allocation-donut-chart"
        data-animated={animated ? "true" : "false"}
        role="img"
        aria-label={ariaLabel}
      >
        <ResponsiveContainer
          key={animated ? "animated" : "idle"}
          width="100%"
          height="100%"
        >
          <PieChart margin={{ top: 56, right: 88, bottom: 56, left: 88 }}>
            <Pie
              animationBegin={0}
              animationDuration={PIE_ANIMATION_MS}
              animationEasing="ease-out"
              cx="50%"
              cy="50%"
              data={slices}
              dataKey="value"
              innerRadius={DONUT_INNER_RADIUS}
              isAnimationActive={animated && !introDone}
              label={(props) => renderAllocationSliceLabel(props, activeIndex)}
              labelLine={renderAllocationLabelLine}
              nameKey="shortName"
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              outerRadius={(dataPoint) => {
                const point = dataPoint as AllocationSlice;
                return point.key === slices[activeIndex ?? -1]?.key
                  ? DONUT_OUTER_RADIUS + DONUT_ACTIVE_EXPAND
                  : DONUT_OUTER_RADIUS;
              }}
              paddingAngle={2.5}
              stroke="var(--surface)"
              strokeWidth={2}
            >
              {slices.map((slice) => (
                <Cell
                  key={slice.key}
                  className={
                    slice.key === slices[activeIndex ?? -1]?.key
                      ? "is-active"
                      : undefined
                  }
                  fill={slice.color}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="allocation-donut-center-label" aria-hidden="true">
          <span>Savings</span>
          <span>Allocation</span>
        </div>
      </div>
    </div>
  );
}

function allocationLabelPoint(
  cx: number,
  cy: number,
  midAngle: number,
): { x: number; y: number; onRight: boolean } {
  const radian = Math.PI / 180;
  const cos = Math.cos(-midAngle * radian);
  const sin = Math.sin(-midAngle * radian);
  const onRight = cos >= 0;
  const labelRadius =
    DONUT_OUTER_RADIUS +
    DONUT_LABEL_OFFSET +
    (onRight ? DONUT_LABEL_SIDE_EXTRA : 0);
  return {
    x: cx + labelRadius * cos + (onRight ? 10 : -4),
    y: cy + labelRadius * sin,
    onRight,
  };
}

function renderAllocationLabelLine(props: {
  cx?: number | string;
  cy?: number | string;
  midAngle?: number;
  outerRadius?: number | string;
  stroke?: string;
}) {
  const cx = Number(props.cx ?? 0);
  const cy = Number(props.cy ?? 0);
  const midAngle = Number(props.midAngle ?? 0);
  const outerRadius = Number(props.outerRadius ?? DONUT_OUTER_RADIUS);
  const radian = Math.PI / 180;
  const cos = Math.cos(-midAngle * radian);
  const sin = Math.sin(-midAngle * radian);
  const start = {
    x: cx + (outerRadius + 4) * cos,
    y: cy + (outerRadius + 4) * sin,
  };
  const end = allocationLabelPoint(cx, cy, midAngle);
  return (
    <path
      d={`M${start.x},${start.y}L${end.x},${end.y}`}
      fill="none"
      stroke="var(--control-border)"
      strokeWidth={1}
    />
  );
}

function renderAllocationSliceLabel(
  props: PieLabelRenderProps,
  activeIndex: number | null,
) {
  const { cx = 0, cy = 0, payload, index } = props;
  const midAngle = Number(props.midAngle ?? 0);
  const slice = payload as AllocationSlice | undefined;
  if (slice === undefined) return null;

  const isActive = index === activeIndex;
  const { x, y, onRight } = allocationLabelPoint(
    Number(cx),
    Number(cy),
    midAngle,
  );
  const scale = isActive ? 1.18 : 1;

  return (
    <text
      className={`allocation-donut-label${isActive ? " is-active" : ""}${slice.key === "USD" ? " is-cash" : ""}`}
      dominantBaseline="central"
      fill="var(--page-text)"
      fontFamily={chartFontFamily}
      textAnchor={onRight ? "start" : "end"}
      transform={`translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`}
      x={x}
      y={y}
    >
      <tspan fontSize={11} fontWeight={800} x={x} dy="-0.4em">
        {slice.shortName}
      </tspan>
      <tspan
        fill={slice.key === "USD" ? "var(--page-text)" : "var(--page-muted)"}
        fontSize={10}
        fontWeight={600}
        x={x}
        dy="1.25em"
      >
        {formatAllocationWeight(slice.weight)} · {formatUsd(slice.amount)}
      </tspan>
    </text>
  );
}

function MethodologyInfo({
  forecast,
  modelConfidence,
  warnings,
}: {
  forecast: SevenDayForecast;
  modelConfidence?: string | undefined;
  warnings: string[];
}) {
  return (
    <div className="methodology-info">
      <button
        aria-describedby="methodology-info-tooltip"
        aria-label="How recommendations are calculated"
        className="dashboard-info-button methodology-info-trigger"
        type="button"
      >
        <FlaskConical size={22} aria-hidden="true" />
      </button>
      <div
        className="methodology-info-tooltip"
        id="methodology-info-tooltip"
        role="tooltip"
      >
        <p className="methodology-info-title">
          How recommendations are calculated
        </p>
        <ol className="methodology-info-steps">
          <li>
            <span className="methodology-info-label">Forecast</span>
            <span>Validation-selected MSPCIFormer predicts Days 1–7.</span>
          </li>
          <li>
            <span className="methodology-info-label">Return</span>
            <span>Day-7 price ÷ observed price − 1.</span>
          </li>
          <li>
            <span className="methodology-info-label">Risk</span>
            <span>Ledoit–Wolf daily covariance over 365 days, scaled ×7.</span>
          </li>
          <li>
            <span className="methodology-info-label">Allocate</span>
            <span>
              The questionnaire fixes crypto exposure and USD cash. The forecast
              applies a confidence-weighted BTC/ETH/SOL model blend inside that
              selected crypto sleeve.
            </span>
          </li>
          {modelConfidence !== undefined && (
            <li>
              <span className="methodology-info-label">Confidence</span>
              <span>
                Model confidence: {(Number(modelConfidence) * 100).toFixed(2)}%;
                strategic targets are blended with the forecast/covariance model
                mix.
              </span>
            </li>
          )}
          <li>
            <span className="methodology-info-label">Details</span>
            <span>
              {forecast.model_name}; seven-day horizon; experimental status; no
              trade execution.
            </span>
          </li>
        </ol>
        {warnings.length > 0 && (
          <ul className="methodology-info-notes">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MethodProvenance({ forecast }: { forecast: SevenDayForecast }) {
  return (
    <>
      <details className="provenance-panel crypto-provenance-panel">
        <summary>Historical Model Accuracy and Provenance</summary>
        <div className="provenance-columns crypto-provenance-columns">
          <section className="provenance-column">
            <h3>Historical Model Accuracy</h3>
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
            <h3>Forecast Provenance</h3>
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
