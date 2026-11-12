from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from server.app.domain.crypto import CryptoAsset, canonical_decimal, utc_datetime
from server.app.domain.events import DomainEvent

RISK_POLICY_VERSION = "risk-questionnaire-v2"
LEGACY_RISK_POLICY_VERSION = "risk-questionnaire-v1"
PORTFOLIO_POLICY_VERSION = "portfolio-policy-v1"
FORECAST_HORIZON_DAYS = 15
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


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
        # Scores remain whole numbers for the portfolio policy. This is the
        # nearest-integer form of 100 × (horizon + tolerance + liquidity) / 9.
        points = self.investment_horizon + self.risk_tolerance + self.liquidity_needs
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
    if policy_version == LEGACY_RISK_POLICY_VERSION:
        _validate_legacy_risk_payload(payload)
        # The previous questionnaire cannot be mapped faithfully to the new
        # three-answer formula. Keep the append-only history, but require a
        # fresh v2 response before using it for a portfolio recommendation.
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
    if set(answers_value) != set(answers.to_dict()):
        raise PortfolioProjectionError("risk answers contain unknown fields")
    score = payload.get("score")
    if score != answers.score:
        raise PortfolioProjectionError("stored risk score does not match its answers")
    profile = RiskProfile(
        answers=answers,
        score=answers.score,
        policy_version=RISK_POLICY_VERSION,
        source_event_id=event.event_id,
        recorded_at_utc=event.occurred_at_utc.astimezone(UTC),
    )
    return RiskProjection(
        projection_version=event.aggregate_version,
        profile=profile,
        source_event_ids=(*projection.source_event_ids, event.event_id),
    )


def _validate_legacy_risk_payload(payload: dict[str, object]) -> None:
    answers = payload.get("answers")
    fields = {
        "time_horizon",
        "loss_tolerance",
        "income_stability",
        "liquidity_need",
        "investing_experience",
    }
    if not isinstance(answers, dict) or set(answers) != fields:
        raise PortfolioProjectionError("legacy risk answers are invalid")
    try:
        values = {name: _risk_answer(answers, name) for name in fields}
    except ValueError as exc:
        raise PortfolioProjectionError("legacy risk answers are invalid") from exc
    if any(isinstance(value, bool) or not 0 <= value <= 4 for value in values.values()):
        raise PortfolioProjectionError("legacy risk answers are invalid")
    legacy_score = (
        values["time_horizon"]
        + values["loss_tolerance"]
        + values["income_stability"]
        + (4 - values["liquidity_need"])
        + values["investing_experience"]
    ) * 5
    if payload.get("score") != legacy_score:
        raise PortfolioProjectionError("stored legacy risk score does not match its answers")


@dataclass(frozen=True)
class PricePoint:
    asset: CryptoAsset
    observed_at_utc: datetime
    price_usd: str
    source_record_id: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "observed_at_utc",
            utc_datetime(self.observed_at_utc, field="observed_at_utc"),
        )
        price = canonical_decimal(self.price_usd)
        if Decimal(price) <= 0:
            raise ValueError("price must be positive")
        object.__setattr__(self, "price_usd", price)
        if not self.source_record_id:
            raise ValueError("price source record ID is required")


@dataclass(frozen=True)
class AssetForecast:
    asset: CryptoAsset
    expected_return: str
    probability_up: str
    p10_return: str
    p50_return: str
    p90_return: str

    def __post_init__(self) -> None:
        for name in (
            "expected_return",
            "probability_up",
            "p10_return",
            "p50_return",
            "p90_return",
        ):
            object.__setattr__(self, name, canonical_decimal(getattr(self, name)))
        probability = Decimal(self.probability_up)
        if not Decimal("0") <= probability <= Decimal("1"):
            raise ValueError("probability_up must be between zero and one")
        if not (Decimal(self.p10_return) <= Decimal(self.p50_return) <= Decimal(self.p90_return)):
            raise ValueError("forecast quantiles must be ordered")


@dataclass(frozen=True)
class ForecastSnapshot:
    as_of_utc: datetime
    expires_at_utc: datetime
    horizon_days: int
    run_id: str
    model_name: Literal["adaptive-gating"]
    model_hash: str
    dataset_hash: str
    promotion_event_id: str
    forecasts: tuple[AssetForecast, ...]
    price_history: tuple[PricePoint, ...]
    scope: str = "research"

    def __post_init__(self) -> None:
        as_of = utc_datetime(self.as_of_utc, field="as_of_utc")
        expires = utc_datetime(self.expires_at_utc, field="expires_at_utc")
        object.__setattr__(self, "as_of_utc", as_of)
        object.__setattr__(self, "expires_at_utc", expires)
        if expires <= as_of:
            raise ValueError("forecast expiry must follow its as-of time")
        if self.horizon_days != FORECAST_HORIZON_DAYS:
            raise ValueError("portfolio forecasts must use the 15-day horizon")
        if {item.asset for item in self.forecasts} != set(CryptoAsset):
            raise ValueError("forecast snapshot must contain exactly BTC, ETH, and SOL")
        if len(self.forecasts) != 3:
            raise ValueError("forecast snapshot cannot contain duplicate assets")
        if {item.asset for item in self.price_history} != set(CryptoAsset):
            raise ValueError("price history must cover BTC, ETH, and SOL")
        if not self.run_id:
            raise ValueError("run_id is required")
        for field_name in ("model_hash", "dataset_hash", "promotion_event_id"):
            if not _SHA256.fullmatch(getattr(self, field_name)):
                raise ValueError(f"{field_name} must be a SHA-256 digest")
        if self.scope not in {"research", "local-synthetic-acceptance"}:
            raise ValueError("unsupported forecast scope")

    @property
    def snapshot_id(self) -> str:
        return hashlib.sha256(
            json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": 1,
            "as_of_utc": _timestamp(self.as_of_utc),
            "expires_at_utc": _timestamp(self.expires_at_utc),
            "horizon_days": self.horizon_days,
            "run_id": self.run_id,
            "model_name": self.model_name,
            "model_hash": self.model_hash,
            "dataset_hash": self.dataset_hash,
            "promotion_event_id": self.promotion_event_id,
            "scope": self.scope,
            "forecasts": [
                {
                    "asset": item.asset.value,
                    "expected_return": item.expected_return,
                    "probability_up": item.probability_up,
                    "p10_return": item.p10_return,
                    "p50_return": item.p50_return,
                    "p90_return": item.p90_return,
                }
                for item in self.forecasts
            ],
            "price_history": [
                {
                    "asset": item.asset.value,
                    "observed_at_utc": _timestamp(item.observed_at_utc),
                    "price_usd": item.price_usd,
                    "source_record_id": item.source_record_id,
                }
                for item in self.price_history
            ],
        }

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> ForecastSnapshot:
        if value.get("schema_version") != 1:
            raise ValueError("unsupported forecast snapshot schema")
        if value.get("model_name") != "adaptive-gating":
            raise ValueError("unsupported forecast model")
        forecasts = value.get("forecasts")
        prices = value.get("price_history")
        if not isinstance(forecasts, list) or not isinstance(prices, list):
            raise ValueError("forecast snapshot rows are invalid")
        if not all(isinstance(item, dict) for item in (*forecasts, *prices)):
            raise ValueError("forecast snapshot rows must be objects")
        return cls(
            as_of_utc=_datetime(value, "as_of_utc"),
            expires_at_utc=_datetime(value, "expires_at_utc"),
            horizon_days=int(str(value["horizon_days"])),
            run_id=str(value["run_id"]),
            model_name="adaptive-gating",
            model_hash=str(value["model_hash"]),
            dataset_hash=str(value["dataset_hash"]),
            promotion_event_id=str(value["promotion_event_id"]),
            scope=str(value.get("scope", "research")),
            forecasts=tuple(
                AssetForecast(
                    asset=CryptoAsset.parse(str(item["asset"])),
                    expected_return=str(item["expected_return"]),
                    probability_up=str(item["probability_up"]),
                    p10_return=str(item["p10_return"]),
                    p50_return=str(item["p50_return"]),
                    p90_return=str(item["p90_return"]),
                )
                for item in forecasts
                if isinstance(item, dict)
            ),
            price_history=tuple(
                PricePoint(
                    asset=CryptoAsset.parse(str(item["asset"])),
                    observed_at_utc=_datetime(item, "observed_at_utc"),
                    price_usd=str(item["price_usd"]),
                    source_record_id=str(item["source_record_id"]),
                )
                for item in prices
                if isinstance(item, dict)
            ),
        )


@dataclass(frozen=True)
class Allocation:
    asset: CryptoAsset
    weight: str
    amount_minor_units: int
    cap: str


@dataclass(frozen=True)
class PortfolioRecommendation:
    capital_minor_units: int
    source_kind: Literal["finance_savings", "scenario"]
    savings_calculation_id: str | None
    savings_source_event_ids: tuple[str, ...]
    risk_score: int
    risk_profile_event_id: str
    policy_version: str
    forecast_snapshot_id: str
    promotion_event_id: str
    solver: str
    fallback_used: bool
    covariance_repaired: bool
    allocations: tuple[Allocation, ...]
    warnings: tuple[str, ...] = field(default_factory=tuple)


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _datetime(value: dict[str, object], field: str) -> datetime:
    return datetime.fromisoformat(str(value[field]).replace("Z", "+00:00"))


def _risk_answer(value: dict[str, object], field: str) -> int:
    answer = value.get(field)
    if isinstance(answer, bool) or not isinstance(answer, int):
        raise ValueError(f"{field} must be an integer")
    return answer
