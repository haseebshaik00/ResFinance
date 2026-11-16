from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from server.app.domain.events import DomainEvent

RISK_POLICY_VERSION = "risk-questionnaire-v3"
SUPERSEDED_RISK_POLICY_VERSION = "risk-questionnaire-v2"
LEGACY_RISK_POLICY_VERSION = "risk-questionnaire-v1"


class PortfolioProjectionError(ValueError):
    pass


@dataclass(frozen=True)
class RiskAnswers:
    investment_horizon: int
    risk_tolerance: int
    liquidity_needs: int

    def __post_init__(self) -> None:
        for name, value in self.__dict__.items():
            if isinstance(value, bool) or not 1 <= value <= 3:
                raise ValueError(f"{name} must be an integer from one through three")

    @property
    def score(self) -> int:
        points = self.investment_horizon + self.risk_tolerance + (4 - self.liquidity_needs)
        return (100 * points + 4) // 9

    def to_dict(self) -> dict[str, int]:
        return dict(self.__dict__)


@dataclass(frozen=True)
class RiskProfile:
    answers: RiskAnswers
    score: int
    policy_version: str
    source_event_id: str
    recorded_at_utc: datetime


@dataclass(frozen=True)
class RiskProjection:
    projection_version: int = 0
    profile: RiskProfile | None = None
    source_event_ids: tuple[str, ...] = ()


def reduce_risk_event(projection: RiskProjection, event: DomainEvent) -> RiskProjection:
    if event.aggregate_type != "risk-profile":
        raise PortfolioProjectionError("risk reducer received another aggregate type")
    if event.aggregate_version != projection.projection_version + 1:
        raise PortfolioProjectionError("risk event versions are not contiguous")
    if event.event_type != "risk.profile-recorded":
        raise PortfolioProjectionError(f"unsupported risk event: {event.event_type}")
    payload = event.payload
    policy_version = payload.get("policy_version")
    if policy_version in {LEGACY_RISK_POLICY_VERSION, SUPERSEDED_RISK_POLICY_VERSION}:
        # Historical answers remain auditable but require an explicit v3 response.
        return RiskProjection(
            projection_version=event.aggregate_version,
            profile=None,
            source_event_ids=(*projection.source_event_ids, event.event_id),
        )
    if policy_version != RISK_POLICY_VERSION:
        raise PortfolioProjectionError("unsupported risk policy version")
    answers_value = payload.get("answers")
    if not isinstance(answers_value, dict):
        raise PortfolioProjectionError("risk answers are invalid")
    try:
        answers = RiskAnswers(
            investment_horizon=_risk_answer(answers_value, "investment_horizon"),
            risk_tolerance=_risk_answer(answers_value, "risk_tolerance"),
            liquidity_needs=_risk_answer(answers_value, "liquidity_needs"),
        )
    except ValueError as exc:
        raise PortfolioProjectionError("risk answers are invalid") from exc
    if set(answers_value) != set(answers.to_dict()) or payload.get("score") != answers.score:
        raise PortfolioProjectionError("stored risk profile is invalid")
    return RiskProjection(
        projection_version=event.aggregate_version,
        profile=RiskProfile(
            answers=answers,
            score=answers.score,
            policy_version=RISK_POLICY_VERSION,
            source_event_id=event.event_id,
            recorded_at_utc=event.occurred_at_utc.astimezone(UTC),
        ),
        source_event_ids=(*projection.source_event_ids, event.event_id),
    )


def _risk_answer(value: dict[str, object], field: str) -> int:
    answer = value.get(field)
    if isinstance(answer, bool) or not isinstance(answer, int):
        raise ValueError(f"{field} must be an integer")
    return answer
