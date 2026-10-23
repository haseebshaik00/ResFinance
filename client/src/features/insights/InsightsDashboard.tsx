import { Lightbulb } from "lucide-react";
import { useState, type FormEvent } from "react";

import { AlwaysVisibleScroll } from "../../components/AlwaysVisibleScroll";
import type { FinanceOverview, InsightResponse } from "../../lib/api/client";
import { currentMonth } from "../finance/money";
import { useInsightsDashboard } from "./useInsightsDashboard";

export function InsightsDashboard({ accessToken }: { accessToken: string }) {
  const [month, setMonth] = useState(currentMonth());

  return (
    <div className="finance-dashboard insights-dashboard">
      <section className="dashboard-header" aria-labelledby="insights-title">
        <div>
          <p className="eyebrow">Evidence-linked guidance</p>
          <h1 id="insights-title">Smart Savings Insights</h1>
          <p className="lede">
            Ask about your recorded savings, budgets, obligations, and crypto
            analysis. Answers are assembled only from facts authorized for your
            wallet.
          </p>
        </div>
        <label className="month-control">
          <span>Insight month</span>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
      </section>

      <SmartSavingsInsights accessToken={accessToken} month={month} />
    </div>
  );
}

export function SmartSavingsInsights({
  accessToken,
  month,
  financeOverview,
}: {
  accessToken: string;
  month: string;
  financeOverview?: FinanceOverview;
}) {
  const [question, setQuestion] = useState("How can I improve my savings?");
  const [answeredQuestion, setAnsweredQuestion] = useState<string | null>(null);
  const dashboard = useInsightsDashboard(accessToken, month);

  if (dashboard.overview.isPending) {
    return (
      <>
        <DashboardState title="Reviewing verified records…" />
        {financeOverview !== undefined && (
          <CombinedProvenancePanel
            financeOverview={financeOverview}
            savingsStatus="loading"
          />
        )}
      </>
    );
  }
  if (dashboard.overview.isError) {
    return (
      <>
        <DashboardState
          title="Smart Savings Insights are unavailable."
          text={dashboard.overview.error.message}
          error
        />
        {financeOverview !== undefined && (
          <CombinedProvenancePanel
            financeOverview={financeOverview}
            savingsStatus="unavailable"
          />
        )}
      </>
    );
  }
  const response = dashboard.query.data ?? dashboard.overview.data.insight;
  const suggestedQuestions = buildSuggestedQuestions(
    response.follow_up_questions,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    ask(question);
  }

  function ask(value: string) {
    const normalized = value.trim();
    if (normalized.length === 0) return;
    setQuestion(normalized);
    dashboard.query.mutate(normalized, {
      onSuccess: () => setAnsweredQuestion(normalized),
    });
  }

  return (
    <>
      <section
        id="smart-insights"
        className="smart-savings-insights"
        aria-labelledby="smart-insights-title"
      >
        <div className="dashboard-section-heading">
          <div>
            <p className="section-kicker">Evidence-linked guidance</p>
            <h2 id="smart-insights-title">Smart Savings Insights</h2>
            <p>
              Ask about your recorded savings, budgets, obligations, and crypto
              analysis. Answers use only facts authorized for your wallet.
            </p>
          </div>
        </div>
        <div className="insights-workspace">
          <section
            className="insight-composer panel"
            aria-labelledby="ask-title"
          >
            <div className="section-heading compact">
              <div>
                <p className="section-kicker">Read-only assistant</p>
                <h2 id="ask-title">Ask About Your Evidence!</h2>
              </div>
              <span className={`generation-pill ${response.mode}`}>
                {modeLabel(response.mode)}
              </span>
            </div>
            <form onSubmit={submit}>
              <label className="form-field">
                <span>Question</span>
                <textarea
                  value={question}
                  maxLength={500}
                  rows={2}
                  required
                  onChange={(event) => setQuestion(event.target.value)}
                />
              </label>
              <div
                className="follow-up-row"
                role="group"
                aria-label="Suggested questions"
              >
                {suggestedQuestions.map((item) => (
                  <button type="button" key={item} onClick={() => ask(item)}>
                    <Lightbulb
                      className="suggestion-icon"
                      size={14}
                      aria-hidden="true"
                    />
                    {item}
                  </button>
                ))}
              </div>
              <button
                className="primary-button"
                disabled={
                  dashboard.query.isPending || question.trim().length === 0
                }
              >
                {dashboard.query.isPending ? "Checking evidence…" : "Explain"}
              </button>
            </form>
            {dashboard.query.isError && (
              <p className="form-error" role="alert">
                {dashboard.query.error.message}
              </p>
            )}
            {dashboard.query.isSuccess && answeredQuestion !== null && (
              <p className="form-success" role="status">
                Answer updated for “{answeredQuestion}”
              </p>
            )}
          </section>

          <InsightResult response={response} />
        </div>
      </section>

      <CombinedProvenancePanel
        financeOverview={financeOverview}
        factBundleId={dashboard.overview.data.fact_bundle_id}
        response={response}
      />
    </>
  );
}

function CombinedProvenancePanel({
  financeOverview,
  factBundleId,
  response,
  savingsStatus,
}: {
  financeOverview: FinanceOverview | undefined;
  factBundleId?: string;
  response?: InsightResponse;
  savingsStatus?: "loading" | "unavailable";
}) {
  return (
    <details className="provenance-panel">
      <summary>Data Freshness and Provenance</summary>
      <div
        className={
          financeOverview === undefined ? undefined : "provenance-columns"
        }
      >
        {financeOverview !== undefined && (
          <section
            className="provenance-column finance-provenance"
            aria-labelledby="finance-provenance-title"
          >
            <AlwaysVisibleScroll>
              <h3 id="finance-provenance-title">Finance Insights</h3>
              <p className="provenance-oneline">
                Projection{" "}
                <strong>
                  v{financeOverview.provenance.projection_version}
                </strong>
                {financeOverview.provenance.as_of_utc === null
                  ? " has no events yet."
                  : ` rebuilt through ${new Date(financeOverview.provenance.as_of_utc).toLocaleString()}.`}{" "}
                Savings calculation{" "}
                <code>{financeOverview.summary.savings.calculation_id}</code>{" "}
                uses{" "}
                <code>{financeOverview.summary.savings.formula_version}</code>{" "}
                and {financeOverview.summary.savings.source_event_ids.length}{" "}
                source event(s).
              </p>
              {financeOverview.provenance.source_event_ids.length > 0 && (
                <ul className="event-id-list">
                  {financeOverview.provenance.source_event_ids.map(
                    (eventId) => (
                      <li key={eventId}>
                        <code>{eventId}</code>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </AlwaysVisibleScroll>
          </section>
        )}
        <section
          className="provenance-column savings-provenance"
          aria-labelledby="savings-provenance-title"
        >
          <h3 id="savings-provenance-title">Savings Insights</h3>
          {savingsStatus === "loading" && <p>Fact bundle is loading.</p>}
          {savingsStatus === "unavailable" && (
            <p>Fact bundle is temporarily unavailable.</p>
          )}
          {factBundleId !== undefined && response !== undefined && (
            <>
              <p>
                Fact bundle <code>{factBundleId}</code>
              </p>
              <p>
                Model <code>{response.model_id}</code> at revision{" "}
                <code>{response.model_revision.slice(0, 12)}</code>. The model
                may rank facts; final claims are rendered from validated
                evidence.
              </p>
              <p>
                This path has no write, ResWallet, ResContract, trading, or
                direct ResilientDB capability.
              </p>
            </>
          )}
        </section>
      </div>
    </details>
  );
}

function InsightResult({ response }: { response: InsightResponse }) {
  const evidenceCards = padEvidenceCards(response.evidence, 4);

  return (
    <section
      className={`insight-result panel${response.refused ? " refusal" : ""}`}
      aria-live="polite"
    >
      <p className="section-kicker">
        {response.refused ? "Request safely declined" : "Evidence-bound answer"}
      </p>
      <h2>
        {response.refused || response.evidence.length === 0
          ? response.summary
          : "What your records show?"}
      </h2>
      {!response.refused && (
        <ul className="evidence-list" aria-label="Evidence used">
          {evidenceCards.map((item, index) =>
            item === null ? (
              <li
                key={`empty-${index}`}
                className="evidence-card-empty"
                aria-hidden="true"
              >
                <p>No additional evidence for this answer.</p>
              </li>
            ) : (
              <li
                key={item.fact_id}
                data-topic={item.topic}
                title={item.statement}
              >
                <p>{item.statement}</p>
                <small>
                  Based on {item.source_ids.length} verified{" "}
                  {item.source_ids.length === 1 ? "record" : "records"}
                </small>
              </li>
            ),
          )}
        </ul>
      )}
      <ul className="caveat-list">
        {response.caveats.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

const SUGGESTED_QUESTION_DEFAULTS = [
  "Which recorded budgets need attention?",
  "How do recurring items affect projected savings?",
  "What is my available savings?",
  "What are my biggest expenses this month?",
] as const;

function buildSuggestedQuestions(followUps: string[]): string[] {
  return [...new Set([...followUps, ...SUGGESTED_QUESTION_DEFAULTS])].slice(
    0,
    4,
  );
}

function padEvidenceCards<T>(items: T[], count: number): Array<T | null> {
  const prioritized = items.slice(0, count);
  return [
    ...prioritized,
    ...Array.from(
      { length: Math.max(0, count - prioritized.length) },
      () => null,
    ),
  ];
}

function DashboardState({
  title,
  text,
  error = false,
}: {
  title: string;
  text?: string;
  error?: boolean;
}) {
  return (
    <section
      className={`dashboard-state${error ? " error-state" : ""}`}
      role={error ? "alert" : "status"}
    >
      <span className="loading-orb" aria-hidden="true" />
      <h2>{title}</h2>
      {text !== undefined && <p>{text}</p>}
    </section>
  );
}

function modeLabel(mode: InsightResponse["mode"]): string {
  if (mode === "local-model") return "Local model + verified facts";
  if (mode === "refusal") return "Safety refusal";
  return "Verified template fallback";
}
