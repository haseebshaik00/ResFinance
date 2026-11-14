from __future__ import annotations

import hashlib
import re
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol

from ml.portfolio.optimizer import optimize_portfolio
from server.app.application.finance import FinanceService
from server.app.application.projections import rebuild_projection
from server.app.domain.events import AppendEventCommand, AppendResult
from server.app.domain.portfolio import (
    PORTFOLIO_POLICY_VERSION,
    RISK_POLICY_VERSION,
    ForecastSnapshot,
    PortfolioRecommendation,
    RiskAnswers,
    RiskProfile,
    RiskProjection,
    reduce_risk_event,
)
from server.app.infrastructure.event_repository import EncryptedEventRepository

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_MONTH = re.compile(r"^\d{4}-\d{2}$")
_MAX_MONEY = 9_000_000_000_000_000


class PortfolioRejected(ValueError):
    pass


@dataclass(frozen=True)
class CryptoOverview:
    month: str
    risk_profile: RiskProfile | None
    risk_projection_version: int
    forecast: ForecastSnapshot | None
    recommendation: PortfolioRecommendation | None
    savings_calculation_id: str
    savings_source_event_ids: tuple[str, ...]
    available_savings_minor_units: int
    savings_formula_version: str


class ForecastSnapshotReader(Protocol):
    def latest_forecast_snapshot(self) -> ForecastSnapshot | None: ...


class PortfolioService:
    def __init__(
        self,
        events: EncryptedEventRepository,
        forecasts: ForecastSnapshotReader,
        finance: FinanceService,
        *,
        allow_synthetic_acceptance: bool = False,
    ) -> None:
        self._events = events
        self._forecasts = forecasts
        self._finance = finance
        self._allow_synthetic_acceptance = allow_synthetic_acceptance
        self._lock = threading.Lock()

    def record_risk_profile(
        self,
        *,
        actor_address: str,
        idempotency_key: str,
        expected_version: int,
        answers: RiskAnswers,
    ) -> AppendResult:
        command = self._command(
            actor_address=actor_address,
            idempotency_key=idempotency_key,
            expected_version=expected_version,
            payload={
                "answers": answers.to_dict(),
                "score": answers.score,
                "policy_version": RISK_POLICY_VERSION,
            },
        )
        with self._lock:
            if (existing := self._events.find_idempotent(command)) is not None:
                return existing
            return self._events.append(command)

    def risk_profile(self, *, actor_address: str) -> RiskProjection:
        """Return the wallet's append-only questionnaire projection only.

        The active seven-day Crypto Intelligence flow uses this projection for
        its strategic policy; it does not invoke this service's legacy
        fifteen-day recommendation path.
        """

        return self._risk_projection(actor_address)

    def overview(
        self,
        *,
        actor_address: str,
        month: str,
        now_utc: datetime | None = None,
    ) -> CryptoOverview:
        month = _month(month)
        finance = self._finance.overview(actor_address=actor_address, month=month)
        savings = finance.summary
        risk = self._risk_projection(actor_address)
        snapshot = self._eligible_snapshot()
        current_time = (now_utc or datetime.now(UTC)).astimezone(UTC)
        if snapshot is not None and current_time > snapshot.expires_at_utc:
            snapshot = None
        if (
            snapshot is not None
            and snapshot.scope == "local-synthetic-acceptance"
            and not self._allow_synthetic_acceptance
        ):
            snapshot = None
        recommendation = None
        if risk.profile is not None and snapshot is not None:
            recommendation = self._recommend(
                snapshot=snapshot,
                profile=risk.profile,
                capital_minor_units=savings.available_savings_minor_units,
                source_kind="finance_savings",
                savings_calculation_id=savings.savings_calculation_id,
                savings_source_event_ids=savings.source_event_ids,
                now_utc=current_time,
            )
        return CryptoOverview(
            month=month,
            risk_profile=risk.profile,
            risk_projection_version=risk.projection_version,
            forecast=snapshot,
            recommendation=recommendation,
            savings_calculation_id=savings.savings_calculation_id,
            savings_source_event_ids=savings.source_event_ids,
            available_savings_minor_units=savings.available_savings_minor_units,
            savings_formula_version=savings.savings_formula_version,
        )

    def analyze_scenario(
        self,
        *,
        actor_address: str,
        amount_minor_units: int,
        now_utc: datetime | None = None,
    ) -> PortfolioRecommendation:
        if isinstance(amount_minor_units, bool) or not 0 < amount_minor_units <= _MAX_MONEY:
            raise PortfolioRejected("scenario amount must be positive integer USD cents")
        risk = self._risk_projection(actor_address)
        if risk.profile is None:
            raise PortfolioRejected("complete the risk questionnaire first")
        snapshot = self._eligible_snapshot()
        if snapshot is None:
            raise PortfolioRejected("no promoted forecast is available")
        if snapshot.scope == "local-synthetic-acceptance" and not self._allow_synthetic_acceptance:
            raise PortfolioRejected("no promoted forecast is available")
        return self._recommend(
            snapshot=snapshot,
            profile=risk.profile,
            capital_minor_units=amount_minor_units,
            source_kind="scenario",
            savings_calculation_id=None,
            savings_source_event_ids=(),
            now_utc=now_utc,
        )

    def _eligible_snapshot(self) -> ForecastSnapshot | None:
        try:
            return self._forecasts.latest_forecast_snapshot()
        except (KeyError, ValueError):
            # Corrupt provenance, content hashes, and missing promotion events are
            # ineligible inputs. The product fails closed instead of rendering them.
            return None

    def _recommend(
        self,
        *,
        snapshot: ForecastSnapshot,
        profile: RiskProfile,
        capital_minor_units: int,
        source_kind: Literal["finance_savings", "scenario"],
        savings_calculation_id: str | None,
        savings_source_event_ids: tuple[str, ...],
        now_utc: datetime | None,
    ) -> PortfolioRecommendation:
        now = (now_utc or datetime.now(UTC)).astimezone(UTC)
        if now > snapshot.expires_at_utc:
            raise PortfolioRejected("the latest promoted forecast is stale")
        optimized = optimize_portfolio(
            capital_minor_units=capital_minor_units,
            risk_score=profile.score,
            forecasts=snapshot.forecasts,
            price_history=snapshot.price_history,
        )
        return PortfolioRecommendation(
            capital_minor_units=capital_minor_units,
            source_kind=source_kind,
            savings_calculation_id=savings_calculation_id,
            savings_source_event_ids=savings_source_event_ids,
            risk_score=profile.score,
            risk_profile_event_id=profile.source_event_id,
            policy_version=PORTFOLIO_POLICY_VERSION,
            forecast_snapshot_id=snapshot.snapshot_id,
            promotion_event_id=snapshot.promotion_event_id,
            solver=optimized.solver,
            fallback_used=optimized.fallback_used,
            covariance_repaired=optimized.covariance_repaired,
            allocations=optimized.allocations,
            warnings=(
                "Research output is informational and does not execute trades or transfer assets.",
            ),
        )

    def _risk_projection(self, actor_address: str) -> RiskProjection:
        tenant_id, aggregate_id, _ = _identity(actor_address)
        events = self._events.load_stream(
            tenant_id=tenant_id,
            aggregate_type="risk-profile",
            aggregate_id=aggregate_id,
        )
        return rebuild_projection(events, initial=RiskProjection(), reducer=reduce_risk_event)

    @staticmethod
    def _command(
        *,
        actor_address: str,
        idempotency_key: str,
        expected_version: int,
        payload: dict[str, object],
    ) -> AppendEventCommand:
        tenant_id, aggregate_id, actor_id = _identity(actor_address)
        if not _ID.fullmatch(idempotency_key):
            raise PortfolioRejected("idempotency_key must be an opaque identifier")
        return AppendEventCommand(
            tenant_id=tenant_id,
            actor_id=actor_id,
            command_type="risk.record-profile",
            idempotency_key=idempotency_key,
            event_type="risk.profile-recorded",
            aggregate_type="risk-profile",
            aggregate_id=aggregate_id,
            expected_version=expected_version,
            payload=payload,
        )


def _identity(actor_address: str) -> tuple[str, str, str]:
    digest = hashlib.sha256(actor_address.encode()).hexdigest()[:32]
    return f"tenant-{digest}", f"risk-{digest}", f"wallet-{digest}"


def _month(value: str) -> str:
    if not _MONTH.fullmatch(value):
        raise PortfolioRejected("month must use YYYY-MM")
    try:
        datetime.strptime(value, "%Y-%m")
    except ValueError as exc:
        raise PortfolioRejected("month must use YYYY-MM") from exc
    return value
