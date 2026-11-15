from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import cvxpy as cp
import pytest
from fastapi.testclient import TestClient

from ml.portfolio.phase2_optimizer import optimize_seven_day_portfolio
from server.app.application.phase2_portfolio import Phase2PortfolioRejected, Phase2PortfolioService
from server.app.domain.crypto import CryptoAsset
from server.app.domain.events import AppendResult, DomainEvent
from server.app.domain.phase2_portfolio import (
    ForecastAccuracy,
    HistoricalPrice,
    SevenDayAssetForecast,
    SevenDayForecast,
)
from server.app.domain.portfolio import RiskAnswers, RiskProfile, RiskProjection, reduce_risk_event
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


class RiskProfileFixture:
    def risk_profile(self, *, actor_address: str) -> RiskProjection:
        return RiskProjection(projection_version=1, profile=_risk_profile())

    def record_risk_profile(
        self,
        *,
        actor_address: str,
        idempotency_key: str,
        expected_version: int,
        answers: RiskAnswers,
    ) -> AppendResult:
        return AppendResult(
            event=DomainEvent(
                schema_version=1,
                event_id="evt_risk_profile_saved",
                event_type="risk.profile-recorded",
                occurred_at_utc=NOW,
                tenant_id="tenant_test",
                actor_id="actor_test",
                aggregate_type="risk-profile",
                aggregate_id="risk_test",
                aggregate_version=expected_version + 1,
                idempotency_key_hash="a" * 64,
                payload={"score": answers.score},
                payload_hash="b" * 64,
                source_references=(),
                contract_receipt=None,
            ),
            deduplicated=False,
        )


def test_risk_score_penalizes_higher_liquidity_needs() -> None:
    low_liquidity_need = RiskAnswers(
        investment_horizon=2,
        risk_tolerance=2,
        liquidity_needs=1,
    )
    high_liquidity_need = RiskAnswers(
        investment_horizon=2,
        risk_tolerance=2,
        liquidity_needs=3,
    )

    assert low_liquidity_need.score == 78
    assert high_liquidity_need.score == 56
    assert high_liquidity_need.score < low_liquidity_need.score


def test_superseded_v2_profile_requires_a_fresh_v3_response() -> None:
    answers = {
        "investment_horizon": 2,
        "risk_tolerance": 2,
        "liquidity_needs": 1,
    }
    v2_event = _risk_event(
        version=1,
        policy_version="risk-questionnaire-v2",
        answers=answers,
        score=56,
    )
    v3_event = _risk_event(
        version=2,
        policy_version="risk-questionnaire-v3",
        answers=answers,
        score=78,
    )

    projection = reduce_risk_event(RiskProjection(), v2_event)
    assert projection.projection_version == 1
    assert projection.profile is None

    projection = reduce_risk_event(projection, v3_event)
    assert projection.profile is not None
    assert projection.profile.score == 78
    assert projection.profile.policy_version == "risk-questionnaire-v3"


def _risk_event(
    *, version: int, policy_version: str, answers: dict[str, int], score: int
) -> DomainEvent:
    return DomainEvent(
        schema_version=1,
        event_id=f"evt_risk_profile_{version}",
        event_type="risk.profile-recorded",
        occurred_at_utc=NOW,
        tenant_id="tenant_test",
        actor_id="actor_test",
        aggregate_type="risk-profile",
        aggregate_id="risk_test",
        aggregate_version=version,
        idempotency_key_hash="a" * 64,
        payload={"policy_version": policy_version, "answers": answers, "score": score},
        payload_hash="b" * 64,
        source_references=(),
        contract_receipt=None,
    )


def test_optimizer_allows_a_cash_reserve_and_reconciles_exactly_in_cents() -> None:
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
        strategic_crypto_weights={
            CryptoAsset.BTC: Decimal("0.25"),
            CryptoAsset.ETH: Decimal("0.40"),
            CryptoAsset.SOL: Decimal("0.15"),
        },
        cash_weight=Decimal("0.20"),
    )

    weights = [Decimal(item.weight) for item in result.allocations]
    assert all(value >= 0 for value in weights)
    assert abs(sum(weights) + Decimal(result.cash_reserve.weight) - Decimal(1)) <= Decimal(
        "0.00000001"
    )
    assert (
        sum(item.amount_minor_units for item in result.allocations)
        + result.cash_reserve.amount_minor_units
        == 100_001
    )
    assert result.solver in {"CLARABEL", "SCS"}
    assert result.solver_status in {"optimal", "optimal_inaccurate"}
    assert Decimal(result.predicted_return_7d) > 0
    assert Decimal(result.estimated_volatility_7d) >= 0
    assert all(not hasattr(item, "cap") for item in result.allocations)
    assert Decimal(result.cash_reserve.weight) == Decimal("0.20")
    assert Decimal(result.strategic_cash_reserve.weight) == Decimal("0.20")


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
        strategic_crypto_weights={
            CryptoAsset.BTC: Decimal("0.25"),
            CryptoAsset.ETH: Decimal("0.40"),
            CryptoAsset.SOL: Decimal("0.15"),
        },
        cash_weight=Decimal("0.20"),
    )
    assert result.covariance_repaired
    assert Decimal(result.cash_reserve.weight) == Decimal("0.20")
    assert result.cash_reserve.amount_minor_units == 20_000


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
            strategic_crypto_weights={asset: Decimal("0.20") for asset in CryptoAsset},
            cash_weight=Decimal("0.40"),
        )


def test_service_warns_for_stale_forecasts_and_retains_cash_for_negative_forecasts() -> None:
    service = Phase2PortfolioService(ForecastFixture(_bundle(status="stale", negative=True)))
    recommendation = service.recommend(
        capital_minor_units=100_000, risk_profile=_risk_profile()
    )
    assert recommendation.forecast_status == "stale"
    assert any("risk profile fixes cash" in warning.lower() for warning in recommendation.warnings)
    assert any("Forecast window ended" in warning for warning in recommendation.warnings)
    assert (
        sum(item.amount_minor_units for item in recommendation.allocations)
        + recommendation.cash_reserve.amount_minor_units
        == 100_000
    )
    assert recommendation.risk_aversion == "5.0"


def test_unavailable_forecast_and_invalid_capital_fail_explicitly() -> None:
    failed = Phase2PortfolioService(FailedForecastFixture())
    with pytest.raises(Phase2PortfolioRejected, match="unavailable"):
        failed.forecast()
    service = Phase2PortfolioService(ForecastFixture(_bundle()))
    with pytest.raises(Phase2PortfolioRejected, match="positive integer USD cents"):
        service.recommend(capital_minor_units=0, risk_profile=_risk_profile())


def test_authenticated_phase2_api_returns_one_snapshot_and_backend_allocations() -> None:
    store = MemoryKeyValueStore()
    authentication = auth_service(store)
    service = Phase2PortfolioService(ForecastFixture(_bundle()))
    client = TestClient(
        create_app(
            authentication,
            portfolio_service=RiskProfileFixture(),  # type: ignore[arg-type]
            phase2_portfolio_service=service,
        )
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
    assert (
        sum(item["amount"]["minor_units"] for item in body["allocations"])
        + body["cash_reserve"]["amount"]["minor_units"]
        == 100_000
    )
    assert (
        abs(
            sum(float(item["weight"]) for item in body["allocations"])
            + float(body["cash_reserve"]["weight"])
            - 1
        )
        < 1e-8
    )
    assert body["covariance_lookback_days"] == 365
    assert body["policy_version"] == "phase2-risk-profile-model-blend-v4"
    assert body["risk_profile"] == "growth"
    assert body["model_blend"] == "confidence-weighted"
    assert Decimal(body["model_confidence"]) == Decimal("0")
    risk_response = client.get("/api/v1/crypto/risk-profile", headers=headers)
    assert risk_response.status_code == 200
    assert risk_response.json()["profile"]["score"] == 78
    saved = client.post(
        "/api/v1/crypto/risk-profile",
        headers={**headers, "Idempotency-Key": "risk-profile-api-test"},
        json={
            "expected_version": 1,
            "answers": {
                "investment_horizon": 2,
                "risk_tolerance": 2,
                "liquidity_needs": 1,
            },
        },
    )
    assert saved.status_code == 201
    assert saved.json()["event_id"] == "evt_risk_profile_saved"


def _bundle(*, status: str = "current", negative: bool = False) -> Phase1ForecastBundle:
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


def _risk_profile() -> RiskProfile:
    return RiskProfile(
        answers=RiskAnswers(investment_horizon=2, risk_tolerance=2, liquidity_needs=1),
        score=78,
        policy_version="risk-questionnaire-v3",
        source_event_id="evt_risk_profile_test",
        recorded_at_utc=NOW,
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
                    + Decimal(asset_index) * Decimal(day % 7) * Decimal("0.0001")
                )
            ),
        )
        for day in range(366)
        for asset_index, asset in enumerate(CryptoAsset)
    )
