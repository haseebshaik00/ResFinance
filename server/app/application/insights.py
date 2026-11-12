from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Protocol

from server.app.application.finance import FinanceOverview, FinanceService
from server.app.application.groups import GroupService
from server.app.application.portfolio import PortfolioService
from server.app.domain.finance import ObligationDirection
from server.app.domain.groups import ObligationStatus
from server.app.domain.insights import (
    AuthorizedFact,
    AuthorizedFactBundle,
    FactSelection,
    InsightMode,
    InsightNotification,
    InsightResponse,
    InsightsOverview,
    InsightTopic,
)

MODEL_ID = "Qwen/Qwen2.5-1.5B-Instruct"
MODEL_REVISION = "989aa7980e4cf806f80c7fef2b1adb7bc71aa306"
_MONTH = re.compile(r"^\d{4}-\d{2}$")
_INJECTION = re.compile(
    r"(?i)(ignore\s+(all\s+)?(previous|prior)|system\s+prompt|developer\s+message|"
    r"reveal\s+(your|the)\s+(instructions|prompt)|jailbreak|act\s+as\s+if|"
    r"override\s+(the\s+)?(rules|instructions)|<\/?(?:system|assistant|developer)>)"
)
_ACTION = re.compile(
    r"(?i)\b(buy|sell|trade|transfer|withdraw|deposit|settle|approve|sign|"
    r"create|update|change|edit|delete|execute)\b"
)
_TOPIC_TERMS: dict[InsightTopic, tuple[str, ...]] = {
    "savings": ("save", "saving", "surplus", "income", "expense", "spend", "recurring"),
    "budgets": ("budget", "limit", "category", "over budget"),
    "obligations": (
        "group",
        "owe",
        "owed",
        "obligation",
        "payable",
        "receivable",
        "split",
    ),
    "crypto": (
        "crypto",
        "btc",
        "bitcoin",
        "eth",
        "ethereum",
        "sol",
        "solana",
        "forecast",
        "portfolio",
        "risk",
        "allocation",
    ),
    "general": ("overview", "summary", "finance", "dashboard", "insight"),
}
_NON_ADVICE = (
    "This is a read-only explanation of your recorded data, not financial, "
    "tax, or investment advice."
)


class InstructionFactSelector(Protocol):
    @property
    def model_id(self) -> str: ...

    @property
    def model_revision(self) -> str: ...

    def select_facts(
        self,
        *,
        question: str,
        topics: tuple[InsightTopic, ...],
        bundle: AuthorizedFactBundle,
    ) -> FactSelection: ...


@dataclass(frozen=True)
class TemplateFactSelector:
    model_id: str = MODEL_ID
    model_revision: str = MODEL_REVISION

    def select_facts(
        self,
        *,
        question: str,
        topics: tuple[InsightTopic, ...],
        bundle: AuthorizedFactBundle,
    ) -> FactSelection:
        del question
        selected = tuple(
            fact.fact_id for fact in bundle.facts if fact.topic in topics
        )[:4]
        return FactSelection(fact_ids=selected, confidence=1.0)


class InsightsService:
    def __init__(
        self,
        finance: FinanceService,
        portfolio: PortfolioService,
        groups: GroupService | None,
        selector: InstructionFactSelector | None = None,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._finance = finance
        self._portfolio = portfolio
        self._groups = groups
        self._selector = selector
        self._fallback = TemplateFactSelector()
        self._clock = clock or (lambda: datetime.now(UTC))

    def overview(self, *, actor_address: str, month: str) -> InsightsOverview:
        bundle = self.authorized_fact_bundle(actor_address=actor_address, month=month)
        # Keep passive dashboard reads deterministic and fast. The optional local
        # model is reserved for an explicit user question, so repeated overview
        # refreshes cannot queue expensive inference ahead of that question.
        response = self._answer(
            bundle=bundle,
            question="How can I improve my savings?",
            use_selector=False,
        )
        return InsightsOverview(
            bundle=bundle,
            response=response,
            notifications=self._notifications(bundle),
        )

    def answer(
        self,
        *,
        actor_address: str,
        month: str,
        question: str,
    ) -> InsightResponse:
        bundle = self.authorized_fact_bundle(actor_address=actor_address, month=month)
        return self._answer(bundle=bundle, question=question)

    def authorized_fact_bundle(
        self,
        *,
        actor_address: str,
        month: str,
    ) -> AuthorizedFactBundle:
        if not _MONTH.fullmatch(month):
            raise ValueError("month must use YYYY-MM")
        finance = self._finance.overview(actor_address=actor_address, month=month)
        summary = finance.summary
        facts: list[AuthorizedFact] = [
            self._fact(
                "savings.available",
                "savings",
                f"Available savings for {month} are {_usd(summary.available_savings_minor_units)}.",
                "finance-savings-v1",
                summary.source_event_ids,
                summary.as_of_utc,
            ),
            self._fact(
                "savings.actual",
                "savings",
                f"Recorded income minus recorded expenses for {month} is "
                f"{_usd(summary.actual_savings_minor_units)}.",
                "finance-monthly-summary",
                summary.source_event_ids,
                summary.as_of_utc,
            ),
            self._fact(
                "savings.projected",
                "savings",
                "Projected savings after recurring items and due obligations are "
                f"{_usd(summary.projected_savings_minor_units)}.",
                "finance-savings-v1",
                summary.source_event_ids,
                summary.as_of_utc,
            ),
        ]
        for status in sorted(summary.budget_statuses, key=lambda item: item.budget_id):
            facts.append(
                self._fact(
                    f"budget.{status.budget_id}",
                    "budgets",
                    f"{status.category_name} is {status.status.replace('_', ' ')} at "
                    f"{_basis_points_percent(status.utilization_basis_points)}% of its "
                    f"{month} budget "
                    f"({_usd(status.spent_minor_units)} of {_usd(status.limit_minor_units)}).",
                    "finance-budget",
                    status.source_event_ids,
                    summary.as_of_utc,
                )
            )
            if status.status == "over_budget":
                overspend = status.spent_minor_units - status.limit_minor_units
                facts.append(
                    self._fact(
                        f"savings.opportunity.{status.budget_id}",
                        "savings",
                        f"Bringing {status.category_name} back to its recorded "
                        f"budget limit would reduce monthly expenses by "
                        f"{_usd(overspend)}, before any other changes.",
                        "finance-budget-derived-opportunity",
                        status.source_event_ids,
                        summary.as_of_utc,
                    )
                )
        facts.extend(self._finance_obligation_facts(finance, month))
        facts.extend(self._group_facts(actor_address))
        crypto = self._portfolio.overview(
            actor_address=actor_address,
            month=month,
            now_utc=self._clock(),
        )
        if crypto.risk_profile is None:
            facts.append(
                self._fact(
                    "crypto.risk.missing",
                    "crypto",
                    "No risk profile is recorded yet.",
                    "risk-questionnaire-v2",
                    (),
                    None,
                )
            )
        else:
            facts.append(
                self._fact(
                    "crypto.risk.score",
                    "crypto",
                    f"The recorded risk score is {crypto.risk_profile.score} out of 100.",
                    crypto.risk_profile.policy_version,
                    (crypto.risk_profile.source_event_id,),
                    crypto.risk_profile.recorded_at_utc,
                )
            )
        if crypto.forecast is None:
            facts.append(
                self._fact(
                    "crypto.forecast.gated",
                    "crypto",
                    "No forecast is eligible for portfolio use because no model "
                    "has an active promotion event.",
                    "forecast-promotion-v1",
                    ("state:no-eligible-forecast",),
                    self._clock(),
                )
            )
        elif crypto.recommendation is not None:
            allocation = ", ".join(
                f"{item.asset.value} {Decimal(item.weight) * 100:.1f}%"
                for item in crypto.recommendation.allocations
            )
            facts.append(
                self._fact(
                    "crypto.portfolio.allocation",
                    "crypto",
                    f"The constrained analytical allocation is {allocation}; "
                    "it does not execute trades.",
                    crypto.recommendation.policy_version,
                    (
                        crypto.recommendation.forecast_snapshot_id,
                        crypto.recommendation.promotion_event_id,
                        crypto.recommendation.risk_profile_event_id,
                    ),
                    crypto.forecast.as_of_utc,
                )
            )
        return AuthorizedFactBundle.build(
            actor_address=actor_address,
            month=month,
            facts=tuple(facts),
        )

    def _answer(
        self,
        *,
        bundle: AuthorizedFactBundle,
        question: str,
        use_selector: bool = True,
    ) -> InsightResponse:
        normalized = " ".join(question.split())
        if not normalized or len(normalized) > 500:
            return self._refusal(
                "Ask one read-only question in 500 characters or fewer.",
                "The request was empty or exceeded the supported question length.",
            )
        if _INJECTION.search(normalized):
            return self._refusal(
                "I cannot follow instructions that try to replace the evidence and safety rules.",
                "Prompt-control instructions are treated as untrusted text.",
            )
        if _ACTION.search(normalized):
            return self._refusal(
                "I cannot write records, use the wallet, settle obligations, move money, or trade.",
                "Use the appropriate dashboard and explicit ResWallet approval "
                "for supported actions.",
            )
        topics = _topics(normalized)
        if not topics:
            return self._refusal(
                "I can explain your savings, budgets, group obligations, risk "
                "profile, forecast gate, and analytical allocation.",
                "The question is outside the authorized financial fact bundle.",
            )
        selection: FactSelection
        mode: InsightMode = "template-fallback"
        active_selector: InstructionFactSelector = self._fallback
        if use_selector and self._selector is not None:
            try:
                candidate = self._selector.select_facts(
                    question=normalized,
                    topics=topics,
                    bundle=bundle,
                )
                selection = self._validated_selection(candidate, bundle, topics)
                mode = "local-model"
                active_selector = self._selector
            except (RuntimeError, ValueError, KeyError, TypeError):
                selection = self._fallback.select_facts(
                    question=normalized,
                    topics=topics,
                    bundle=bundle,
                )
        else:
            selection = self._fallback.select_facts(
                question=normalized,
                topics=topics,
                bundle=bundle,
            )
        facts_by_id = bundle.by_id()
        evidence = tuple(facts_by_id[fact_id] for fact_id in selection.fact_ids)
        if not evidence:
            return self._refusal(
                "There is not enough authorized evidence to answer that question yet.",
                "Add relevant Finance, Groups, or risk-profile data and try again.",
            )
        caveats = [
            _NON_ADVICE,
            "The assistant cannot perform any action or change the saved record.",
        ]
        if any(fact.fact_id == "crypto.forecast.gated" for fact in evidence):
            caveats.append(
                "No BTC, ETH, or SOL recommendation is available without a "
                "promoted forecast."
            )
        return InsightResponse(
            summary=" ".join(fact.statement for fact in evidence),
            evidence=evidence,
            caveats=tuple(caveats),
            follow_up_questions=_follow_ups(topics),
            mode=mode,
            model_id=active_selector.model_id,
            model_revision=active_selector.model_revision,
            refused=False,
        )

    def _validated_selection(
        self,
        selection: FactSelection,
        bundle: AuthorizedFactBundle,
        topics: tuple[InsightTopic, ...],
    ) -> FactSelection:
        if selection.confidence < 0.65:
            raise ValueError("model confidence is below the evidence threshold")
        if not 1 <= len(selection.fact_ids) <= 4:
            raise ValueError("model must select between one and four facts")
        known = bundle.by_id()
        if len(set(selection.fact_ids)) != len(selection.fact_ids):
            raise ValueError("model selected duplicate facts")
        for fact_id in selection.fact_ids:
            fact = known.get(fact_id)
            if fact is None or fact.topic not in topics:
                raise ValueError("model selected unauthorized evidence")
        return selection

    def _finance_obligation_facts(
        self,
        finance: FinanceOverview,
        month: str,
    ) -> list[AuthorizedFact]:
        projection = finance.projection
        as_of = finance.summary.as_of_utc
        facts: list[AuthorizedFact] = []
        for direction in ObligationDirection:
            entries = [
                item
                for item in projection.obligations.values()
                if item.direction is direction and not item.settled
            ]
            if not entries:
                continue
            amount = sum(item.outstanding_minor_units for item in entries)
            noun = "receivable" if direction is ObligationDirection.RECEIVABLE else "payable"
            facts.append(
                self._fact(
                    f"obligations.finance.{noun}",
                    "obligations",
                    f"There are {len(entries)} open {noun}(s) totaling "
                    f"{_usd(amount)} in the current ledger view for {month}.",
                    "finance-contract-projection",
                    tuple(sorted(item.source_event_id for item in entries)),
                    as_of,
                )
            )
        return facts

    def _group_facts(self, actor_address: str) -> list[AuthorizedFact]:
        if self._groups is None:
            return []
        facts: list[AuthorizedFact] = []
        for group in self._groups.list_groups(actor_address=actor_address):
            if group.group_id is None or group.name is None:
                continue
            relevant = [
                item
                for item in group.obligations.values()
                if item.status in {ObligationStatus.OPEN, ObligationStatus.PARTIALLY_SETTLED}
                and actor_address in {item.creditor_address, item.debtor_address}
            ]
            if relevant:
                facts.append(
                    self._fact(
                        f"group.{group.group_id}.obligations",
                        "obligations",
                        f"{group.name} has {len(relevant)} open obligation(s) "
                        "involving your wallet.",
                        "group-contract-projection",
                        tuple(sorted(item.source_event_id for item in relevant)),
                        group.as_of_utc,
                    )
                )
            for notification in group.notifications:
                if notification.recipient_address != actor_address:
                    continue
                facts.append(
                    self._fact(
                        f"group.{group.group_id}.notification.{notification.notification_id}",
                        "obligations",
                        notification.message,
                        "group-notification",
                        (notification.source_event_id,),
                        group.as_of_utc,
                    )
                )
        return facts

    def _notifications(
        self, bundle: AuthorizedFactBundle
    ) -> tuple[InsightNotification, ...]:
        values: list[InsightNotification] = []
        for fact in bundle.facts:
            if fact.fact_id.startswith("budget.") and "over budget" in fact.statement:
                values.append(
                    InsightNotification(
                        notification_id=f"notice:{fact.fact_id}",
                        severity="urgent",
                        title="Budget needs attention",
                        message=fact.statement,
                        href="/finance",
                        fact_ids=(fact.fact_id,),
                    )
                )
            elif fact.fact_id.startswith("budget.") and "near limit" in fact.statement:
                values.append(
                    InsightNotification(
                        notification_id=f"notice:{fact.fact_id}",
                        severity="warning",
                        title="Budget is near its limit",
                        message=fact.statement,
                        href="/finance",
                        fact_ids=(fact.fact_id,),
                    )
                )
            elif ".notification." in fact.fact_id:
                values.append(
                    InsightNotification(
                        notification_id=f"notice:{fact.fact_id}",
                        severity="warning",
                        title="Group update",
                        message=fact.statement,
                        href="/groups",
                        fact_ids=(fact.fact_id,),
                    )
                )
        gated = next(
            (fact for fact in bundle.facts if fact.fact_id == "crypto.forecast.gated"),
            None,
        )
        if gated is not None:
            values.append(
                InsightNotification(
                    notification_id="notice:crypto.forecast.gated",
                    severity="info",
                    title="Crypto Intelligence is gated",
                    message=gated.statement,
                    href="/crypto",
                    fact_ids=(gated.fact_id,),
                )
            )
        return tuple(values)

    def _refusal(self, summary: str, caveat: str) -> InsightResponse:
        selector = self._selector or self._fallback
        return InsightResponse(
            summary=summary,
            evidence=(),
            caveats=(caveat, _NON_ADVICE),
            follow_up_questions=(
                "How can I improve my recorded monthly savings?",
                "Which recorded budgets need attention?",
            ),
            mode="refusal",
            model_id=selector.model_id,
            model_revision=selector.model_revision,
            refused=True,
        )

    @staticmethod
    def _fact(
        fact_id: str,
        topic: InsightTopic,
        statement: str,
        source_kind: str,
        source_ids: tuple[str, ...],
        as_of_utc: datetime | None,
    ) -> AuthorizedFact:
        return AuthorizedFact(
            fact_id=fact_id,
            topic=topic,
            statement=statement,
            source_kind=source_kind,
            source_ids=source_ids,
            as_of_utc=as_of_utc,
        )


def _topics(question: str) -> tuple[InsightTopic, ...]:
    lowered = question.lower()
    topics = tuple(
        topic
        for topic, terms in _TOPIC_TERMS.items()
        if any(term in lowered for term in terms)
    )
    if "general" in topics:
        return ("savings", "budgets", "obligations", "crypto")
    return topics


def _follow_ups(topics: tuple[InsightTopic, ...]) -> tuple[str, ...]:
    questions: list[str] = []
    if "savings" in topics or "budgets" in topics:
        questions.extend(
            [
                "Which recorded budgets need attention?",
                "How do recurring items affect projected savings?",
            ]
        )
    if "obligations" in topics:
        questions.append("What open obligations involve my wallet?")
    if "crypto" in topics:
        questions.append("Why is the crypto forecast currently gated?")
    return tuple(dict.fromkeys(questions))[:3]


def _usd(minor_units: int) -> str:
    sign = "-" if minor_units < 0 else ""
    absolute = abs(minor_units)
    return f"{sign}${absolute // 100:,}.{absolute % 100:02d}"


def _basis_points_percent(basis_points: int) -> str:
    whole, fraction = divmod(basis_points, 100)
    return str(whole) if fraction == 0 else f"{whole}.{fraction:02d}".rstrip("0")
