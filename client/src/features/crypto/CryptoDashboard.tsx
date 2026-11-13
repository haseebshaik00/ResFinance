import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Pencil, X } from "lucide-react";

import type {
  CryptoOverview,
  PortfolioRecommendation,
} from "../../lib/api/client";
import { MonthPicker } from "../../components/MonthPicker";
import {
  currentMonth,
  formatUsd,
  minorUnitsToUsdInput,
  usdToMinorUnits,
} from "../finance/money";
import { CryptoChart } from "./CryptoChart";
import { useCryptoDashboard } from "./useCryptoDashboard";

type Asset = "BTC" | "ETH" | "SOL";
const ASSETS: Asset[] = ["BTC", "ETH", "SOL"];
const QUESTIONS = [
  [
    "investment_horizon",
    "Investment Horizon",
    ["Short-term", "Medium-term", "Long-term"],
  ],
  [
    "risk_tolerance",
    "Risk Tolerance",
    ["Prefer safety", "Moderate risk", "High risk"],
  ],
  [
    "liquidity_needs",
    "Liquidity Needs",
    ["High need", "Moderate need", "Low need"],
  ],
] as const;

export function CryptoDashboard({ accessToken }: { accessToken: string }) {
  const [month, setMonth] = useState(currentMonth());
  const [asset, setAsset] = useState<Asset>("BTC");
  const dashboard = useCryptoDashboard(accessToken, month);

  if (dashboard.overview.isPending) {
    return (
      <DashboardState
        title="Building your crypto view…"
        text="Reading actual savings, risk preferences, and approved forecast data."
      />
    );
  }
  if (dashboard.overview.isError) {
    return (
      <DashboardState
        title="Crypto Intelligence is unavailable."
        text={dashboard.overview.error.message}
        error
      />
    );
  }
  const overview = dashboard.overview.data;
  const displayed = dashboard.scenario.data ?? overview.recommendation;
  return (
    <div className="finance-dashboard crypto-dashboard">
      <section className="dashboard-header" aria-labelledby="crypto-title">
        <div>
          <p className="eyebrow">Risk-aware portfolio</p>
          <h1 id="crypto-title">Savings, translated into choices!</h1>
          <p className="lede">
            Explore a BTC, ETH, and SOL portfolio tailored to your savings, risk
            preferences, and an approved 15-day forecast.
          </p>
        </div>
        <MonthPicker month={month} onChange={setMonth} label="Savings month" />
      </section>

      <section
        className="crypto-top-row"
        aria-label="Crypto Intelligence overview"
      >
        <CapitalScenarioCard
          key={`${month}-${overview.default_capital.minor_units}`}
          defaultCapital={overview.default_capital.minor_units}
          overview={overview}
          dashboard={dashboard}
        />
        <RiskQuestionnaire overview={overview} dashboard={dashboard} />
      </section>

      {overview.forecast === null ? (
        <section className="panel empty-forecast" role="status">
          <p className="section-kicker">Forecast unavailable</p>
          <h2>No forecast is eligible for portfolio use.</h2>
          <p>
            No forecast has passed the required quality checks. Portfolio
            analysis will remain unavailable until one qualifies.
          </p>
        </section>
      ) : (
        <section className="panel" aria-labelledby="forecast-chart-title">
          <div className="section-heading compact">
            <div>
              <p className="section-kicker">Observed + forecast interval</p>
              <h2 id="forecast-chart-title">Price outlook</h2>
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
          <CryptoChart overview={overview} asset={asset} />
          <p className="panel-note">
            The P10–P90 range represents model uncertainty, not a guarantee.
          </p>
        </section>
      )}

      {displayed !== null && displayed !== undefined && (
        <AllocationPanel recommendation={displayed} />
      )}
      <details className="provenance-panel">
        <summary>Data Freshness and Provenance</summary>
        <div>
          <p>
            Formula <code>{overview.savings_formula_version}</code>; Finance
            calculation <code>{overview.savings_calculation_id}</code>{" "}
            references {overview.savings_source_event_ids.length} immutable
            event(s).
          </p>
          {overview.forecast !== null && (
            <p>
              Forecast <code>{overview.forecast.snapshot_id}</code> is
              authorized by promotion event{" "}
              <code>{overview.forecast.promotion_event_id}</code>.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

function RiskQuestionnaire({
  overview,
  dashboard,
}: {
  overview: CryptoOverview;
  dashboard: ReturnType<typeof useCryptoDashboard>;
}) {
  const existing = overview.risk_profile?.answers;
  const [answers, setAnswers] = useState<
    Record<(typeof QUESTIONS)[number][0], number>
  >({
    investment_horizon: existing?.investment_horizon ?? 2,
    risk_tolerance: existing?.risk_tolerance ?? 2,
    liquidity_needs: existing?.liquidity_needs ?? 2,
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    dashboard.riskProfile.mutate({
      idempotencyKey: crypto.randomUUID(),
      body: { answers, expected_version: overview.risk_projection_version },
    });
  }
  return (
    <section
      className="entry-panel risk-questionnaire-card"
      aria-labelledby="risk-title"
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">Your preferences</p>
          <h2 id="risk-title">Risk Questionnaire</h2>
        </div>
        {overview.risk_profile !== null && (
          <span className="freshness-pill">
            Score {overview.risk_profile.score}
          </span>
        )}
      </div>
      <form className="risk-form" onSubmit={submit}>
        {QUESTIONS.map(([key, label, options]) => (
          <label className="form-field" key={key}>
            <span>{label}</span>
            <select
              value={answers[key]}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [key]: Number(event.target.value),
                }))
              }
            >
              {options.map((option, index) => {
                const value = index + 1;
                return (
                  <option value={value} key={value}>
                    {value} · {option}
                  </option>
                );
              })}
            </select>
          </label>
        ))}
        <button
          className="primary-button"
          type="submit"
          disabled={dashboard.riskProfile.isPending}
        >
          {dashboard.riskProfile.isPending ? "Saving…" : "Save risk profile"}
        </button>
        {dashboard.riskProfile.isError && (
          <p className="form-error" role="alert">
            {dashboard.riskProfile.error.message}
          </p>
        )}
      </form>
    </section>
  );
}

function PortfolioSignals({ overview }: { overview: CryptoOverview }) {
  const summaryItems = [
    {
      label: "Risk score",
      value: overview.risk_profile?.score.toString() ?? "Not set",
      note: "33 lower risk · 100 growth",
    },
    {
      label: "Forecast",
      value: overview.forecast === null ? "Unavailable" : "15 days",
      note:
        overview.forecast === null
          ? "No eligible forecast"
          : `As of ${new Date(overview.forecast.as_of_utc).toLocaleDateString()}`,
    },
    {
      label: "Portfolio mode",
      value: "Investment Guidance",
      note: "Personalized allocation suggestions",
    },
  ];

  return (
    <section className="capital-signals" aria-label="Portfolio signals">
      <p className="crypto-summary-title">Portfolio signals</p>
      <div className="crypto-summary-items">
        {summaryItems.map((item) => (
          <div className="crypto-summary-item" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.note}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function CapitalScenarioCard({
  defaultCapital,
  overview,
  dashboard,
}: {
  defaultCapital: number;
  overview: CryptoOverview;
  dashboard: ReturnType<typeof useCryptoDashboard>;
}) {
  const [amount, setAmount] = useState(() =>
    minorUnitsToUsdInput(defaultCapital),
  );
  const [activeCapital, setActiveCapital] = useState(defaultCapital);
  const [isEditing, setIsEditing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const amountInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      amountInput.current?.focus();
      amountInput.current?.select();
    }
  }, [isEditing]);

  function startEditing() {
    setAmount(minorUnitsToUsdInput(activeCapital));
    setValidationError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setAmount(minorUnitsToUsdInput(activeCapital));
    setValidationError(null);
    setIsEditing(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const cents = usdToMinorUnits(amount);
      setValidationError(null);
      dashboard.scenario.mutate(
        {
          amount: { currency: "USD", minor_units: cents },
        },
        {
          onSuccess: (recommendation) => {
            setActiveCapital(recommendation.capital.minor_units);
            setIsEditing(false);
          },
        },
      );
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "Enter a valid USD amount.",
      );
    }
  }
  return (
    <article
      className={`metric-card capital-card${isEditing ? " is-editing" : ""}`}
      aria-labelledby="capital-title"
    >
      <div className="capital-card-heading">
        <p id="capital-title">Investment Capital</p>
        <span className="capital-source">
          {dashboard.scenario.data === undefined
            ? "AVAILABLE SAVINGS"
            : "SCENARIO ACTIVE"}
        </span>
      </div>
      {isEditing ? (
        <form className="capital-scenario-form" onSubmit={submit}>
          <label className="capital-edit-field">
            <span className="sr-only">Scenario amount (USD)</span>
            <span aria-hidden="true">$</span>
            <input
              ref={amountInput}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <p className="capital-edit-hint">
            Analyze an alternate amount without changing Finance.
          </p>
          <div className="capital-actions">
            <button
              className="capital-scenario-button"
              type="submit"
              disabled={dashboard.scenario.isPending}
            >
              <Check aria-hidden="true" size={15} />
              {dashboard.scenario.isPending ? "Analyzing…" : "Analyze scenario"}
            </button>
            <button
              className="capital-cancel-button"
              type="button"
              onClick={cancelEditing}
              disabled={dashboard.scenario.isPending}
            >
              <X aria-hidden="true" size={15} />
              Cancel
            </button>
          </div>
          {dashboard.scenario.isError && (
            <p className="form-error" role="alert">
              {dashboard.scenario.error.message}
            </p>
          )}
          {validationError !== null && (
            <p className="form-error" role="alert">
              {validationError}
            </p>
          )}
        </form>
      ) : (
        <>
          <div className="capital-amount-display">
            <strong>{formatUsd(activeCapital)}</strong>
            <button
              className="capital-edit-button"
              type="button"
              onClick={startEditing}
              aria-label="Edit scenario amount"
              title="Edit scenario amount"
            >
              <Pencil aria-hidden="true" size={17} />
            </button>
          </div>
          <p className="capital-disclaimer">
            Read Only · Edit the amount to explore other scenarios
          </p>
        </>
      )}
      {dashboard.scenario.data !== undefined && (
        <p className="scenario-result">
          <Check aria-hidden="true" size={16} />
          <span>
            <strong>Scenario active: </strong>
            {formatUsd(dashboard.scenario.data.capital.minor_units)}. Finance
            default unchanged.
          </span>
        </p>
      )}
      <PortfolioSignals overview={overview} />
    </article>
  );
}

function AllocationPanel({
  recommendation,
}: {
  recommendation: PortfolioRecommendation;
}) {
  return (
    <section className="panel" aria-labelledby="allocation-title">
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Constrained recommendation</p>
          <h2 id="allocation-title">Portfolio allocation</h2>
        </div>
      </div>
      <div className="allocation-grid">
        {recommendation.allocations.map((item) => (
          <article key={item.asset}>
            <span>{item.asset}</span>
            <strong>{formatUsd(item.amount.minor_units)}</strong>
            <small>
              {(Number(item.weight) * 100).toFixed(1)}% · cap{" "}
              {(Number(item.cap) * 100).toFixed(0)}%
            </small>
            <div className="allocation-track">
              <i style={{ width: `${Number(item.weight) * 100}%` }} />
            </div>
          </article>
        ))}
      </div>
      {recommendation.warnings.map((warning) => (
        <p className="panel-note" key={warning}>
          {warning}
        </p>
      ))}
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
