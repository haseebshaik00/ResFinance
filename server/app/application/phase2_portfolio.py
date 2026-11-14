from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Protocol

from ml.portfolio.phase2_optimizer import optimize_seven_day_portfolio
from server.app.domain.phase2_portfolio import (
    Phase2Recommendation,
    SevenDayForecast,
)
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

    def __post_init__(self) -> None:
        if not self.risk_aversion.is_finite() or self.risk_aversion <= 0:
            raise ValueError("risk aversion must be positive")
        if self.covariance_lookback_days < 30:
            raise ValueError("covariance lookback must be at least 30 days")


DEFAULT_PHASE2_POLICY = Phase2PortfolioPolicy()


def load_phase2_policy(path: Path) -> Phase2PortfolioPolicy:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Phase 2 portfolio policy must be an object")
    if value.get("policy_version") != "phase2-mean-variance-v1":
        raise ValueError("unsupported Phase 2 portfolio policy version")
    if value.get("covariance_estimator") != "Ledoit-Wolf":
        raise ValueError("Phase 2 requires the Ledoit-Wolf covariance estimator")
    if value.get("covariance_horizon_days") != 7:
        raise ValueError("Phase 2 covariance horizon must be seven days")
    return Phase2PortfolioPolicy(
        risk_aversion=Decimal(str(value["risk_aversion"])),
        covariance_lookback_days=int(str(value["covariance_lookback_days"])),
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

    def recommend(self, *, capital_minor_units: int) -> Phase2Recommendation:
        if (
            isinstance(capital_minor_units, bool)
            or not 0 < capital_minor_units <= _MAX_MONEY
        ):
            raise Phase2PortfolioRejected(
                "investment capital must be positive integer USD cents"
            )
        try:
            bundle = self._forecasts.latest_forecast()
            forecast = bundle.forecast
            expected = {
                item.asset: Decimal(item.predicted_return_7d) for item in forecast.assets
            }
            result = optimize_seven_day_portfolio(
                capital_minor_units=capital_minor_units,
                expected_returns=expected,
                price_history=bundle.price_history,
                risk_aversion=self._policy.risk_aversion,
                covariance_lookback_days=self._policy.covariance_lookback_days,
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
        if all(value < 0 for value in expected.values()):
            warnings.append(
                "All predicted seven-day returns are negative. The allocation is conditional "
                "on investing the full amount among BTC, ETH, and SOL; it does not imply that "
                "investing is preferable to holding cash."
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
            policy_version="phase2-mean-variance-v1",
            allocations=result.allocations,
            warnings=tuple(warnings),
        )
