from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import cvxpy as cp
import pytest
from fastapi.testclient import TestClient

from ml.portfolio.phase2_optimizer import optimize_seven_day_portfolio
from server.app.application.phase2_portfolio import (
    Phase2PortfolioPolicy,
    Phase2PortfolioRejected,
    Phase2PortfolioService,
)
from server.app.domain.crypto import CryptoAsset
from server.app.domain.phase2_portfolio import (
    ForecastAccuracy,
    HistoricalPrice,
    SevenDayAssetForecast,
    SevenDayForecast,
)
from server.app.infrastructure.phase1_forecast_repository import Phase1ForecastBundle
from server.app.main import create_app
from tests.contract.test_authentication import (
    ORIGIN,
    MemoryKeyValueStore,
    challenge,
    create_session,
    login_intent,
    wallet,
)
from tests.contract.test_authentication import service as auth_service

NOW = datetime(2026, 11, 14, 12, tzinfo=UTC)


class ForecastFixture:
    def __init__(self, bundle: Phase1ForecastBundle) -> None:
        self.bundle = bundle

    def latest_forecast(self) -> Phase1ForecastBundle:
        return self.bundle


class FailedForecastFixture:
    def latest_forecast(self) -> Phase1ForecastBundle:
        raise ValueError("verified Phase 1 artifact is missing")


def test_optimizer_is_long_only_fully_invested_uncapped_and_exact_in_cents() -> None:
    result = optimize_seven_day_portfolio(
        capital_minor_units=100_001,
        expected_returns={
            CryptoAsset.BTC: Decimal("0.01"),
            CryptoAsset.ETH: Decimal("0.02"),
            CryptoAsset.SOL: Decimal("0.03"),
        },
        price_history=_prices(),
        risk_aversion=Decimal("5.0"),
        covariance_lookback_days=365,
    )

    weights = [Decimal(item.weight) for item in result.allocations]
    assert all(value >= 0 for value in weights)
    assert abs(sum(weights) - Decimal(1)) <= Decimal("0.00000001")
    assert sum(item.amount_minor_units for item in result.allocations) == 100_001
    assert result.solver in {"CLARABEL", "SCS"}
    assert result.solver_status in {"optimal", "optimal_inaccurate"}
    assert Decimal(result.predicted_return_7d) > 0
    assert Decimal(result.estimated_volatility_7d) >= 0
    assert all(not hasattr(item, "cap") for item in result.allocations)


def test_singular_covariance_is_repaired_without_changing_the_objective() -> None:
    flat = tuple(
        HistoricalPrice(
            asset=asset,
            observed_date_utc=date(2025, 1, 1) + timedelta(days=day),
            price_usd="100",
        )
        for day in range(366)
        for asset in CryptoAsset
    )
    result = optimize_seven_day_portfolio(
        capital_minor_units=100_000,
        expected_returns={asset: Decimal("-0.01") for asset in CryptoAsset},
        price_history=flat,
        risk_aversion=Decimal("5.0"),
        covariance_lookback_days=365,
    )
    assert result.covariance_repaired
    assert sum(Decimal(item.weight) for item in result.allocations) == Decimal("1.0000000000")


def test_solver_failures_are_explicit_and_never_substitute_another_portfolio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(*args: object, **kwargs: object) -> object:
        raise cp.SolverError("injected failure")

    monkeypatch.setattr(cp.Problem, "solve", fail)
    with pytest.raises(ValueError, match="CLARABEL.*SCS"):
        optimize_seven_day_portfolio(
            capital_minor_units=100_000,
            expected_returns={asset: Decimal("0.01") for asset in CryptoAsset},
            price_history=_prices(),
            risk_aversion=Decimal("5.0"),
            covariance_lookback_days=365,
        )


def test_service_warns_for_stale_and_all_negative_forecasts() -> None:
    service = Phase2PortfolioService(
        ForecastFixture(_bundle(status="stale", negative=True)),
        policy=Phase2PortfolioPolicy(risk_aversion=Decimal("5.0"), covariance_lookback_days=365),
    )
    recommendation = service.recommend(capital_minor_units=100_000)
    assert recommendation.forecast_status == "stale"
    assert any("All predicted" in warning for warning in recommendation.warnings)
    assert any("Forecast window ended" in warning for warning in recommendation.warnings)
    assert sum(item.amount_minor_units for item in recommendation.allocations) == 100_000
    assert recommendation.risk_aversion == "5.0"


def test_unavailable_forecast_and_invalid_capital_fail_explicitly() -> None:
    failed = Phase2PortfolioService(FailedForecastFixture())
    with pytest.raises(Phase2PortfolioRejected, match="unavailable"):
        failed.forecast()
    service = Phase2PortfolioService(ForecastFixture(_bundle()))
    with pytest.raises(Phase2PortfolioRejected, match="positive integer USD cents"):
        service.recommend(capital_minor_units=0)


def test_authenticated_phase2_api_returns_one_snapshot_and_backend_allocations() -> None:
    store = MemoryKeyValueStore()
    authentication = auth_service(store)
    service = Phase2PortfolioService(ForecastFixture(_bundle()))
    client = TestClient(
        create_app(authentication, phase2_portfolio_service=service)
    )
    private_key, identity = wallet()
    challenge_body = challenge(client, identity)
    token = create_session(
        client,
        challenge_body,
        login_intent(private_key, identity, challenge_body),
    ).json()["access_token"]
    headers = {"Origin": ORIGIN, "Authorization": f"Bearer {token}"}

    forecast = client.get("/api/v1/crypto/forecast", headers=headers)
    assert forecast.status_code == 200
    assert forecast.json()["model_key"] == "original-mspciformer"
    assert len(forecast.json()["forecast_dates_utc"]) == 7
    response = client.post(
        "/api/v1/crypto/recommendations",
        headers=headers,
        json={"capital": {"currency": "USD", "minor_units": 100_000}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["forecast_snapshot_id"] == forecast.json()["snapshot_id"]
    assert sum(item["amount"]["minor_units"] for item in body["allocations"]) == 100_000
    assert abs(sum(float(item["weight"]) for item in body["allocations"]) - 1) < 1e-8
    assert body["covariance_lookback_days"] == 365
    assert client.post("/api/v1/crypto/risk-profile", headers=headers, json={}).status_code == 404


def _bundle(
    *, status: str = "current", negative: bool = False
) -> Phase1ForecastBundle:
    cutoff = datetime(2026, 11, 13, tzinfo=UTC)
    returns = ("-0.01", "-0.02", "-0.03") if negative else ("0.01", "0.02", "0.03")
    current = (Decimal("68000"), Decimal("1900"), Decimal("78"))
    forecasts: list[SevenDayAssetForecast] = []
    for index, asset in enumerate(CryptoAsset):
        final = current[index] * (Decimal(1) + Decimal(returns[index]))
        path = tuple(
            current[index] + (final - current[index]) * Decimal(day) / Decimal(7)
            for day in range(1, 8)
        )
        daily = []
        previous = current[index]
        for price in path:
            daily.append(str(price / previous - Decimal(1)))
            previous = price
        forecasts.append(
            SevenDayAssetForecast(
                asset=asset,
                current_price=str(current[index]),
                predicted_prices=tuple(str(value) for value in path),
                predicted_daily_returns=tuple(daily),
                predicted_return_7d=returns[index],
            )
        )
    reasons = ("Forecast window ended 2026-11-10.",) if status == "stale" else ()
    snapshot = SevenDayForecast(
        run_id="phase1-vasa-v2-test",
        manifest_key="phase1-run:phase1-vasa-v2-test:manifest",
        model_key="original-mspciformer",
        model_name="Original MSPCIFormer reimplementation",
        model_version="phase1-market-only-v2",
        generated_at_utc=NOW,
        market_data_cutoff_utc=cutoff,
        forecast_dates_utc=tuple(cutoff.date() + timedelta(days=day) for day in range(1, 8)),
        assets=tuple(forecasts),
        status=status,  # type: ignore[arg-type]
        stale_reasons=reasons,
        quality_checks={"finite": True, "positive_prices": True, "fallback_used": False},
        accuracy=(_accuracy("original-mspciformer"), _accuracy("vasa-mspciformer")),
    )
    return Phase1ForecastBundle(snapshot, _prices())


def _accuracy(model: str) -> ForecastAccuracy:
    return ForecastAccuracy(
        model_key=model,  # type: ignore[arg-type]
        mape="0.044",
        return_7d_mae="0.058",
        directional_accuracy="0.50",
        btc_day_7_mae_usd="3582",
        eth_day_7_mae_usd="174",
        sol_day_7_mae_usd="9",
    )


def _prices() -> tuple[HistoricalPrice, ...]:
    start = date(2025, 11, 13)
    bases = {
        CryptoAsset.BTC: Decimal("40000"),
        CryptoAsset.ETH: Decimal("2000"),
        CryptoAsset.SOL: Decimal("80"),
    }
    return tuple(
        HistoricalPrice(
            asset=asset,
            observed_date_utc=start + timedelta(days=day),
            price_usd=str(
                bases[asset]
                * (
                    Decimal(1)
                    + Decimal(day) * Decimal("0.0005")
                    + Decimal(asset_index)
                    * Decimal(day % 7)
                    * Decimal("0.0001")
                )
            ),
        )
        for day in range(366)
        for asset_index, asset in enumerate(CryptoAsset)
    )
