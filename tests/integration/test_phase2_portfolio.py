from __future__ import annotations

import hashlib
import json
import math
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from ml.evaluation.phase1 import TrainingConfig
from ml.runs.phase1 import Phase1Config, run_phase1_research
from server.app.application.phase2_portfolio import Phase2PortfolioService
from server.app.domain.crypto import CryptoAsset, ObservationChannel, ProviderObservation
from server.app.domain.portfolio import RiskAnswers, RiskProfile
from server.app.infrastructure.blob_repository import EncryptedBlobRepository
from server.app.infrastructure.crypto_repository import CryptoResearchRepository
from server.app.infrastructure.encryption import AesGcmCipher, canonical_json_bytes
from server.app.infrastructure.phase1_forecast_repository import Phase1ForecastRepository
from tests.contract.test_authentication import MemoryKeyValueStore

NOW = datetime(2026, 11, 14, 12, tzinfo=UTC)
HISTORICAL_EVIDENCE_SHA256 = "4b2fa48c32584dffd2c1e11b7d1db6b918d7da730bc3b9c340fa07e426398b2f"


def test_phase1_v2_artifacts_feed_the_seven_day_optimizer_without_retraining() -> None:
    observations = _observations(430)
    result = run_phase1_research(
        observations,
        run_id="phase1-vasa-v2-integration",
        generated_at_utc=NOW,
        config=Phase1Config(
            dropout=0,
            volatility_lookback_candidates=(7,),
            seeds=(17,),
            walk_forward_folds=1,
            walk_forward_test_days=12,
            walk_forward_validation_days=12,
            training=TrainingConfig(
                epochs=1,
                batch_size=128,
                learning_rate=0,
                weight_decay=0,
                patience=1,
            ),
        ),
    )
    assert result.selected_model == "original-mspciformer"
    assert set(result.evidence["comparison"]) == {
        "original-mspciformer",
        "vasa-mspciformer",
    }

    store = MemoryKeyValueStore()
    blobs = EncryptedBlobRepository(
        store,
        AesGcmCipher(b"p" * 32, key_id="phase2-integration-key-v1"),
    )
    market = CryptoResearchRepository(store)
    market.put_observations(observations)
    persisted: dict[str, object] = {}
    for name, content in result.artifacts.items():
        receipt = blobs.put(
            content,
            media_type="application/octet-stream",
            producing_run_id=result.run_id,
        )
        persisted[name] = {"sha256": receipt.sha256, "manifest_key": receipt.manifest_key}
    manifest = {**result.manifest, "persisted_artifacts": persisted}
    store.put(
        f"phase1-run:{result.run_id}:manifest",
        canonical_json_bytes(manifest).decode(),
    )

    repository = Phase1ForecastRepository(store, blobs, market)
    bundle = repository.latest_forecast(now_utc=NOW)
    assert bundle.forecast.model_key == "original-mspciformer"
    assert bundle.forecast.market_data_cutoff_utc.date() == date(2026, 11, 13)
    assert bundle.forecast.status == "current"
    assert not bundle.forecast.refreshed_from_checkpoint
    assert len(bundle.price_history) == 430 * 3
    for asset in bundle.forecast.assets:
        assert len(asset.p10_prices) == 7
        assert len(asset.p50_prices) == 7
        assert len(asset.p90_prices) == 7
        assert all(
            Decimal(p10) <= Decimal(p50) <= Decimal(p90)
            for p10, p50, p90 in zip(
                asset.p10_prices,
                asset.p50_prices,
                asset.p90_prices,
                strict=True,
            )
        )

    recommendation = Phase2PortfolioService(repository).recommend(
        capital_minor_units=100_000,
        risk_profile=RiskProfile(
            answers=RiskAnswers(investment_horizon=2, risk_tolerance=2, liquidity_needs=1),
            score=78,
            policy_version="risk-questionnaire-v3",
            source_event_id="evt_risk_profile_integration",
            recorded_at_utc=NOW,
        ),
    )
    assert recommendation.forecast_snapshot_id == bundle.forecast.snapshot_id
    assert (
        sum(item.amount_minor_units for item in recommendation.allocations)
        + recommendation.cash_reserve.amount_minor_units
        == 100_000
    )
    assert (
        abs(
            sum(float(item.weight) for item in recommendation.allocations)
            + float(recommendation.cash_reserve.weight)
            - 1.0
        )
        < 1e-8
    )
    assert recommendation.policy_version == "phase2-risk-profile-model-blend-v4"
    assert recommendation.risk_profile == "growth"


def test_historical_three_model_evidence_remains_byte_for_byte_unchanged() -> None:
    path = Path("config/crypto-intelligence/phase1-vasa-2026-11-14.json")
    assert hashlib.sha256(path.read_bytes()).hexdigest() == HISTORICAL_EVIDENCE_SHA256
    value = json.loads(path.read_text(encoding="utf-8"))
    assert "naive-persistence" in value["comparison"]


def _observations(days: int) -> list[ProviderObservation]:
    end = date(2026, 11, 13)
    start = end - timedelta(days=days - 1)
    result: list[ProviderObservation] = []
    for offset in range(days):
        observed = datetime.combine(start + timedelta(days=offset), datetime.min.time(), UTC)
        for asset_index, asset in enumerate(CryptoAsset):
            price = 100 * (asset_index + 1) * math.exp(offset * (0.0008 + asset_index * 0.0001))
            result.append(
                ProviderObservation(
                    asset=asset,
                    channel=ObservationChannel.MARKET,
                    metric="price_usd",
                    interval="1d",
                    observed_at_utc=observed,
                    available_at_utc=observed + timedelta(days=1),
                    retrieved_at_utc=NOW,
                    decimal_value=f"{price:.8f}",
                    missing=False,
                    provider="coin-metrics",
                    source_reference="test://phase2-market",
                    provider_revision="community-api-v4",
                    response_sha256=hashlib.sha256(f"{offset}-{asset.value}".encode()).hexdigest(),
                    terms_reference="test://terms",
                    license_status="test-only",
                )
            )
    return result
