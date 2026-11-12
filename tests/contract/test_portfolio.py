from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

import cvxpy as cp
import pytest
from fastapi.testclient import TestClient

from ml.portfolio.optimizer import optimize_portfolio
from server.app.application.finance import FinanceService
from server.app.application.portfolio import PortfolioRejected, PortfolioService
from server.app.domain.crypto import CryptoAsset
from server.app.domain.events import AppendEventCommand
from server.app.domain.finance import EntryDirection
from server.app.domain.portfolio import AssetForecast, ForecastSnapshot, PricePoint, RiskAnswers
from server.app.infrastructure.encryption import AesGcmCipher
from server.app.infrastructure.event_repository import EncryptedEventRepository
from server.app.main import create_app
from tests.contract.test_authentication import (
    ORIGIN,
    challenge,
    create_session,
    login_intent,
    wallet,
)
from tests.contract.test_authentication import service as auth_service

NOW = datetime(2026, 10, 14, 12, tzinfo=UTC)
ACTOR = "0x" + "c" * 40


def _risk_identity() -> tuple[str, str, str]:
    digest = hashlib.sha256(ACTOR.encode()).hexdigest()[:32]
    return f"tenant-{digest}", f"risk-{digest}", f"wallet-{digest}"


class MemoryKeyValueStore:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def put(self, key: str, value: str) -> None:
        self.values[key] = value

    def range_values(self, prefix: str) -> Sequence[str]:
        return [self.values[key] for key in sorted(self.values) if key.startswith(prefix)]


class ForecastFixture:
    def __init__(self, snapshot: ForecastSnapshot | None) -> None:
        self.snapshot = snapshot

    def latest_forecast_snapshot(self) -> ForecastSnapshot | None:
        return self.snapshot


class CorruptForecastFixture:
    def latest_forecast_snapshot(self) -> ForecastSnapshot | None:
        raise ValueError("forecast snapshot content hash does not match")


def test_risk_score_uses_the_three_question_nine_point_formula() -> None:
    conservative = RiskAnswers(1, 1, 1)
    balanced = RiskAnswers(2, 2, 2)
    aggressive = RiskAnswers(3, 3, 3)

    assert conservative.score == 33
    assert balanced.score == 67
    assert aggressive.score == 100
    with pytest.raises(ValueError):
        RiskAnswers(4, 1, 1)


def test_legacy_risk_profile_requires_a_fresh_three_question_response() -> None:
    store = MemoryKeyValueStore()
    events = EncryptedEventRepository(
        store,
        AesGcmCipher(b"l" * 32, key_id="legacy-risk-test-v1"),
        clock=lambda: NOW,
    )
    finance = FinanceService(events)
    service = PortfolioService(events, ForecastFixture(_snapshot()), finance)
    tenant_id, aggregate_id, actor_id = _risk_identity()
    events.append(
        AppendEventCommand(
            tenant_id=tenant_id,
            actor_id=actor_id,
            command_type="risk.record-profile",
            idempotency_key="legacy-risk-profile-0001",
            event_type="risk.profile-recorded",
            aggregate_type="risk-profile",
            aggregate_id=aggregate_id,
            expected_version=0,
            payload={
                "answers": {
                    "time_horizon": 2,
                    "loss_tolerance": 2,
                    "income_stability": 2,
                    "liquidity_need": 2,
                    "investing_experience": 2,
                },
                "score": 50,
                "policy_version": "risk-questionnaire-v1",
            },
        )
    )

    legacy = service.overview(actor_address=ACTOR, month="2026-10", now_utc=NOW)
    assert legacy.risk_projection_version == 1
    assert legacy.risk_profile is None

    service.record_risk_profile(
        actor_address=ACTOR,
        idempotency_key="v2-risk-profile-0001",
        expected_version=1,
        answers=RiskAnswers(2, 2, 2),
    )
    current = service.overview(actor_address=ACTOR, month="2026-10", now_utc=NOW)
    assert current.risk_profile is not None
    assert current.risk_profile.score == 67


def test_recommendation_obeys_caps_reconciles_cents_and_scenario_does_not_mutate() -> None:
    store = MemoryKeyValueStore()
    events = EncryptedEventRepository(
        store,
        AesGcmCipher(b"7" * 32, key_id="portfolio-test-v1"),
        clock=lambda: NOW,
    )
    finance = FinanceService(events)
    _record_savings(finance)
    service = PortfolioService(
        events,
        ForecastFixture(_snapshot()),
        finance,
        allow_synthetic_acceptance=True,
    )
    profile = service.record_risk_profile(
        actor_address=ACTOR,
        idempotency_key="risk-profile-0001",
        expected_version=0,
        answers=RiskAnswers(2, 2, 2),
    )
    before_finance = finance.overview(actor_address=ACTOR, month="2026-10")
    before_keys = set(store.values)

    overview = service.overview(actor_address=ACTOR, month="2026-10", now_utc=NOW)
    recommendation = overview.recommendation
    assert recommendation is not None
    assert recommendation.capital_minor_units == 100_001
    assert recommendation.savings_calculation_id == before_finance.summary.savings_calculation_id
    assert recommendation.risk_profile_event_id == profile.event.event_id
    assert sum(item.amount_minor_units for item in recommendation.allocations) == 100_001
    assert abs(sum(float(item.weight) for item in recommendation.allocations) - 1) < 1e-7
    assert all(float(item.weight) <= float(item.cap) + 1e-7 for item in recommendation.allocations)
    sol = next(item for item in recommendation.allocations if item.asset is CryptoAsset.SOL)
    assert float(sol.cap) == pytest.approx(0.2675)

    scenario = service.analyze_scenario(actor_address=ACTOR, amount_minor_units=77_777, now_utc=NOW)
    assert scenario.source_kind == "scenario"
    assert scenario.savings_calculation_id is None
    assert sum(item.amount_minor_units for item in scenario.allocations) == 77_777
    assert set(store.values) == before_keys
    assert finance.overview(actor_address=ACTOR, month="2026-10") == before_finance


def test_stale_promoted_forecast_is_rejected() -> None:
    store = MemoryKeyValueStore()
    events = EncryptedEventRepository(
        store,
        AesGcmCipher(b"s" * 32, key_id="stale-test-v1"),
        clock=lambda: NOW,
    )
    finance = FinanceService(events)
    snapshot = _snapshot(expires_at=NOW - timedelta(seconds=1))
    service = PortfolioService(
        events,
        ForecastFixture(snapshot),
        finance,
        allow_synthetic_acceptance=True,
    )
    service.record_risk_profile(
        actor_address=ACTOR,
        idempotency_key="risk-stale-0001",
        expected_version=0,
        answers=RiskAnswers(2, 2, 2),
    )

    with pytest.raises(PortfolioRejected, match="stale"):
        service.analyze_scenario(actor_address=ACTOR, amount_minor_units=10_000, now_utc=NOW)

    overview = service.overview(actor_address=ACTOR, month="2026-10", now_utc=NOW)
    assert overview.forecast is None
    assert overview.recommendation is None


def test_corrupted_or_unpromoted_forecasts_fail_closed() -> None:
    store = MemoryKeyValueStore()
    events = EncryptedEventRepository(
        store,
        AesGcmCipher(b"c" * 32, key_id="corrupt-test-v1"),
        clock=lambda: NOW,
    )
    finance = FinanceService(events)
    service = PortfolioService(events, CorruptForecastFixture(), finance)
    service.record_risk_profile(
        actor_address=ACTOR,
        idempotency_key="risk-corrupt-0001",
        expected_version=0,
        answers=RiskAnswers(2, 2, 2),
    )

    overview = service.overview(actor_address=ACTOR, month="2026-10", now_utc=NOW)
    assert overview.forecast is None
    assert overview.recommendation is None
    with pytest.raises(PortfolioRejected, match="no promoted forecast"):
        service.analyze_scenario(actor_address=ACTOR, amount_minor_units=10_000, now_utc=NOW)


def test_authenticated_crypto_api_records_risk_profile() -> None:
    store = MemoryKeyValueStore()
    authentication = auth_service(store)
    events = EncryptedEventRepository(
        store,
        AesGcmCipher(b"a" * 32, key_id="portfolio-api-test-v1"),
        clock=lambda: NOW,
    )
    finance = FinanceService(events)
    portfolio = PortfolioService(events, ForecastFixture(None), finance)
    client = TestClient(create_app(authentication, finance, None, portfolio))
    private_key, identity = wallet()
    challenge_body = challenge(client, identity)
    token = create_session(
        client,
        challenge_body,
        login_intent(private_key, identity, challenge_body),
    ).json()["access_token"]
    headers = {
        "Origin": ORIGIN,
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": "risk-api-0001",
    }
    payload = {
        "answers": {
            "investment_horizon": 3,
            "risk_tolerance": 2,
            "liquidity_needs": 3,
        },
        "expected_version": 0,
    }

    created = client.post("/api/v1/crypto/risk-profile", headers=headers, json=payload)
    assert created.status_code == 201
    overview = client.get(
        "/api/v1/crypto/overview?month=2026-10",
        headers={"Origin": ORIGIN, "Authorization": f"Bearer {token}"},
    )
    assert overview.status_code == 200
    body = overview.json()
    assert body["risk_profile"]["score"] == 89
    assert body["recommendation"] is None
    assert body["forecast"] is None
    assert body["default_capital"] == {"currency": "USD", "minor_units": 0}


def _record_savings(finance: FinanceService) -> None:
    finance.create_category(
        actor_address=ACTOR,
        idempotency_key="income-category-0001",
        expected_version=0,
        category_id="income",
        name="Income",
        direction=EntryDirection.INCOME,
    )
    finance.record_transaction(
        actor_address=ACTOR,
        idempotency_key="income-transaction-0002",
        expected_version=1,
        transaction_id="paycheck",
        direction=EntryDirection.INCOME,
        category_id="income",
        amount_minor_units=100_001,
        occurred_on=date(2026, 10, 1),
        description="Paycheck",
        recurring_entry_id=None,
    )


def _snapshot(*, expires_at: datetime | None = None) -> ForecastSnapshot:
    prices: list[PricePoint] = []
    starts = {CryptoAsset.BTC: 60_000, CryptoAsset.ETH: 3_000, CryptoAsset.SOL: 150}
    for offset in range(40):
        observed = NOW - timedelta(days=40 - offset)
        for asset_index, asset in enumerate(CryptoAsset):
            price = starts[asset] * (1 + 0.002 * offset + 0.0003 * asset_index * (offset % 3))
            prices.append(
                PricePoint(
                    asset=asset,
                    observed_at_utc=observed,
                    price_usd=f"{price:.8f}",
                    source_record_id=f"price-{asset.value.lower()}-{offset:03d}",
                )
            )
    forecasts = tuple(
        AssetForecast(
            asset=asset,
            expected_return=value,
            probability_up="0.60",
            p10_return="-0.05",
            p50_return=value,
            p90_return="0.10",
        )
        for asset, value in zip(CryptoAsset, ("0.04", "0.05", "0.08"), strict=True)
    )
    return ForecastSnapshot(
        as_of_utc=NOW - timedelta(hours=1),
        expires_at_utc=expires_at or NOW + timedelta(days=1),
        horizon_days=15,
        run_id="run-m7-acceptance",
        model_name="adaptive-gating",
        model_hash="1" * 64,
        dataset_hash="2" * 64,
        promotion_event_id="3" * 64,
        forecasts=forecasts,
        price_history=tuple(prices),
        scope="local-synthetic-acceptance",
    )


def test_optimizer_uses_minimum_variance_when_primary_solvers_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_solve = cp.Problem.solve
    calls = 0

    def fail_primary_solvers(problem: cp.Problem, *args: object, **kwargs: object) -> object:
        nonlocal calls
        calls += 1
        if calls <= 2:
            raise cp.SolverError("injected solver failure")
        return original_solve(problem, *args, **kwargs)

    monkeypatch.setattr(cp.Problem, "solve", fail_primary_solvers)
    snapshot = _snapshot()
    result = optimize_portfolio(
        capital_minor_units=10_001,
        risk_score=50,
        forecasts=snapshot.forecasts,
        price_history=snapshot.price_history,
    )

    assert result.fallback_used
    assert result.solver == "minimum-variance"
    assert sum(item.amount_minor_units for item in result.allocations) == 10_001
