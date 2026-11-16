from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Protocol

from ml.portfolio.phase2_optimizer import optimize_seven_day_portfolio
from server.app.domain.crypto import CryptoAsset
from server.app.domain.phase2_portfolio import (
    Phase2Allocation,
    Phase2Recommendation,
    Phase2TacticalAdjustment,
    SevenDayForecast,
)
from server.app.domain.portfolio import RISK_POLICY_VERSION, RiskProfile
from server.app.infrastructure.phase1_forecast_repository import Phase1ForecastBundle

_MAX_MONEY = 9_000_000_000_000_000


class Phase2PortfolioRejected(ValueError):
    pass


class Phase1ForecastReader(Protocol):
    def latest_forecast(self) -> Phase1ForecastBundle: ...


@dataclass(frozen=True)
class Phase2PortfolioPolicy:
    risk_aversion: Decimal = Decimal("5.0")
    covariance_lookback_days: int = 365
    cash_return_7d: Decimal = Decimal("0")
    targets: tuple[RiskProfileTarget, ...] = ()

    def __post_init__(self) -> None:
        if not self.risk_aversion.is_finite() or self.risk_aversion <= 0:
            raise ValueError("risk aversion must be positive")
        if self.covariance_lookback_days < 30:
            raise ValueError("covariance lookback must be at least 30 days")
        if not self.cash_return_7d.is_finite() or self.cash_return_7d != 0:
            raise ValueError("the USD cash reserve return must be zero for this policy")
        if len(self.targets) != 3:
            raise ValueError("Phase 2 requires exactly three risk-profile targets")
        if {target.name for target in self.targets} != {"conservative", "balanced", "growth"}:
            raise ValueError("Phase 2 targets must be conservative, balanced, and growth")

    def target_for_score(self, score: int) -> RiskProfileTarget:
        matches = [
            target
            for target in self.targets
            if target.minimum_score <= score <= target.maximum_score
        ]
        if len(matches) != 1:
            raise ValueError("risk score does not map to exactly one Phase 2 target")
        return matches[0]


@dataclass(frozen=True)
class RiskProfileTarget:
    name: str
    minimum_score: int
    maximum_score: int
    weights: tuple[tuple[CryptoAsset, Decimal], ...]
    cash_weight: Decimal

    def __post_init__(self) -> None:
        if self.name not in {"conservative", "balanced", "growth"}:
            raise ValueError("unsupported risk profile target")
        if not 0 <= self.minimum_score <= self.maximum_score <= 100:
            raise ValueError("risk target scores must be between zero and 100")
        if {asset for asset, _ in self.weights} != set(CryptoAsset):
            raise ValueError("risk target must cover exactly BTC, ETH, and SOL")
        if any(not value.is_finite() or value < 0 for _, value in self.weights):
            raise ValueError("risk target crypto weights must be nonnegative")
        if not self.cash_weight.is_finite() or not Decimal(0) <= self.cash_weight < Decimal(1):
            raise ValueError("risk target cash weight must be between zero and one")
        if sum(value for _, value in self.weights) + self.cash_weight != Decimal(1):
            raise ValueError("risk target weights must total one")

    @property
    def crypto_weights(self) -> dict[CryptoAsset, Decimal]:
        return dict(self.weights)


DEFAULT_PHASE2_POLICY = Phase2PortfolioPolicy(
    targets=(
        RiskProfileTarget(
            "conservative",
            33,
            44,
            (
                (CryptoAsset.BTC, Decimal("0.20")),
                (CryptoAsset.ETH, Decimal("0.15")),
                (CryptoAsset.SOL, Decimal("0.05")),
            ),
            Decimal("0.60"),
        ),
        RiskProfileTarget(
            "balanced",
            56,
            67,
            (
                (CryptoAsset.BTC, Decimal("0.25")),
                (CryptoAsset.ETH, Decimal("0.40")),
                (CryptoAsset.SOL, Decimal("0.15")),
            ),
            Decimal("0.20"),
        ),
        RiskProfileTarget(
            "growth",
            78,
            100,
            (
                (CryptoAsset.BTC, Decimal("0.30")),
                (CryptoAsset.ETH, Decimal("0.35")),
                (CryptoAsset.SOL, Decimal("0.25")),
            ),
            Decimal("0.10"),
        ),
    )
)


def load_phase2_policy(path: Path) -> Phase2PortfolioPolicy:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Phase 2 portfolio policy must be an object")
    if value.get("policy_version") != "phase2-risk-profile-model-blend-v4":
        raise ValueError("unsupported Phase 2 portfolio policy version")
    if value.get("covariance_estimator") != "Ledoit-Wolf":
        raise ValueError("Phase 2 requires the Ledoit-Wolf covariance estimator")
    if value.get("covariance_horizon_days") != 7:
        raise ValueError("Phase 2 covariance horizon must be seven days")
    if Decimal(str(value.get("cash_return_7d"))) != 0:
        raise ValueError("Phase 2 cash reserve return must be zero")
    if value.get("model_blend") != "confidence-weighted":
        raise ValueError("Phase 2 requires confidence-weighted model blending")
    targets_value = value.get("risk_profile_targets")
    if not isinstance(targets_value, list):
        raise ValueError("Phase 2 risk profile targets must be a list")
    targets = tuple(_risk_target(item) for item in targets_value)
    return Phase2PortfolioPolicy(
        risk_aversion=Decimal(str(value["risk_aversion"])),
        covariance_lookback_days=int(str(value["covariance_lookback_days"])),
        cash_return_7d=Decimal(str(value["cash_return_7d"])),
        targets=targets,
    )


class Phase2PortfolioService:
    def __init__(
        self,
        forecasts: Phase1ForecastReader,
        *,
        policy: Phase2PortfolioPolicy = DEFAULT_PHASE2_POLICY,
    ) -> None:
        self._forecasts = forecasts
        self._policy = policy

    def forecast(self) -> SevenDayForecast:
        try:
            return self._forecasts.latest_forecast().forecast
        except (KeyError, RuntimeError, ValueError) as exc:
            raise Phase2PortfolioRejected(f"seven-day forecast is unavailable: {exc}") from exc

    def recommend(
        self, *, capital_minor_units: int, risk_profile: RiskProfile
    ) -> Phase2Recommendation:
        if isinstance(capital_minor_units, bool) or not 0 < capital_minor_units <= _MAX_MONEY:
            raise Phase2PortfolioRejected("investment capital must be positive integer USD cents")
        try:
            if risk_profile.policy_version != RISK_POLICY_VERSION:
                raise ValueError("a current risk questionnaire is required")
            target = self._policy.target_for_score(risk_profile.score)
            bundle = self._forecasts.latest_forecast()
            forecast = bundle.forecast
            expected = {item.asset: Decimal(item.predicted_return_7d) for item in forecast.assets}
            model_confidence = _model_confidence(forecast, expected)
            result = optimize_seven_day_portfolio(
                capital_minor_units=capital_minor_units,
                expected_returns=expected,
                price_history=bundle.price_history,
                risk_aversion=self._policy.risk_aversion,
                covariance_lookback_days=self._policy.covariance_lookback_days,
                model_confidence=model_confidence,
                strategic_crypto_weights=target.crypto_weights,
                cash_weight=target.cash_weight,
            )
        except (KeyError, RuntimeError, ValueError) as exc:
            raise Phase2PortfolioRejected(f"portfolio recommendation failed: {exc}") from exc

        warnings = [
            "Experimental research output: predicted returns are uncertain and are not "
            "guaranteed profits.",
            "This recommendation is informational only and does not execute trades or "
            "transfer assets.",
        ]
        warnings.extend(forecast.stale_reasons)
        warnings.append(
            "The saved risk profile fixes cash and the strategic crypto sleeve. A "
            f"{(model_confidence * Decimal(100)).quantize(Decimal('0.01'))}% "
            "confidence-weighted forecast/covariance model blend refines only BTC, ETH, and SOL."
        )
        if result.covariance_repaired:
            warnings.append(
                "The covariance matrix required a minimal positive-semidefinite numerical repair."
            )
        return Phase2Recommendation(
            capital_minor_units=capital_minor_units,
            forecast_snapshot_id=forecast.snapshot_id,
            forecast_status=forecast.status,
            model_key=forecast.model_key,
            model_version=forecast.model_version,
            expected_returns_7d=tuple(
                (asset, str(expected[asset])) for asset in sorted(expected, key=lambda x: x.value)
            ),
            predicted_portfolio_return_7d=result.predicted_return_7d,
            estimated_portfolio_volatility_7d=result.estimated_volatility_7d,
            risk_aversion=str(self._policy.risk_aversion),
            covariance_lookback_days=self._policy.covariance_lookback_days,
            covariance_estimator="Ledoit-Wolf",
            covariance_repaired=result.covariance_repaired,
            solver=result.solver,
            solver_status=result.solver_status,
            policy_version="phase2-risk-profile-model-blend-v4",
            risk_profile=target.name,  # type: ignore[arg-type]
            risk_score=risk_profile.score,
            risk_profile_event_id=risk_profile.source_event_id,
            risk_policy_version="risk-questionnaire-v3",
            model_confidence=str(model_confidence),
            model_blend="confidence-weighted",
            strategic_allocations=result.strategic_allocations,
            strategic_cash_reserve=result.strategic_cash_reserve,
            tactical_adjustments=_tactical_adjustments(
                result.allocations, result.strategic_allocations
            ),
            allocations=result.allocations,
            cash_reserve=result.cash_reserve,
            warnings=tuple(warnings),
        )


def _model_confidence(
    forecast: SevenDayForecast, expected_returns: dict[CryptoAsset, Decimal]
) -> Decimal:
    """Calibrate the model tilt from selected-model held-out evidence."""

    selected = next(
        (item for item in forecast.accuracy if item.model_key == forecast.model_key), None
    )
    if selected is None:
        return Decimal(0)
    try:
        directional_accuracy = Decimal(selected.directional_accuracy)
        return_mae = Decimal(selected.return_7d_mae)
        strongest_signal = max(abs(value) for value in expected_returns.values())
    except (InvalidOperation, ValueError):
        return Decimal(0)
    if not directional_accuracy.is_finite() or not return_mae.is_finite() or return_mae <= 0:
        return Decimal(0)
    directional_skill = _unit_interval((directional_accuracy - Decimal("0.5")) / Decimal("0.5"))
    signal_to_error = _unit_interval(strongest_signal / return_mae)
    return (directional_skill * signal_to_error).sqrt()


def _unit_interval(value: Decimal) -> Decimal:
    return min(Decimal(1), max(Decimal(0), value))


def _risk_target(value: object) -> RiskProfileTarget:
    if not isinstance(value, dict):
        raise ValueError("risk profile target must be an object")
    weights_value = value.get("weights")
    if not isinstance(weights_value, dict) or set(weights_value) != {"BTC", "ETH", "SOL", "cash"}:
        raise ValueError("risk profile target weights are invalid")
    return RiskProfileTarget(
        name=str(value.get("profile")),
        minimum_score=int(str(value.get("minimum_score"))),
        maximum_score=int(str(value.get("maximum_score"))),
        weights=tuple((asset, Decimal(str(weights_value[asset.value]))) for asset in CryptoAsset),
        cash_weight=Decimal(str(weights_value["cash"])),
    )


def _tactical_adjustments(
    allocations: tuple[Phase2Allocation, ...], strategic: tuple[Phase2Allocation, ...]
) -> tuple[Phase2TacticalAdjustment, ...]:
    strategic_by_asset = {item.asset: Decimal(item.weight) for item in strategic}
    return tuple(
        Phase2TacticalAdjustment(
            asset=item.asset,
            weight=str(Decimal(item.weight) - strategic_by_asset[item.asset]),
        )
        for item in allocations
    )
