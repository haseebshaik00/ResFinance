from __future__ import annotations

import hashlib
import math
import unittest
from datetime import UTC, date, datetime, timedelta

from ml.data.market_daily import ASSETS
from ml.evaluation.phase1 import TrainingConfig
from ml.runs.phase1 import Phase1Config, run_phase1_research
from server.app.domain.crypto import ObservationChannel, ProviderObservation


class Phase1ResearchIntegrationTest(unittest.TestCase):
    def test_real_pipeline_contract_produces_comparison_and_latest_forecast(self) -> None:
        config = Phase1Config(
            volatility_lookback_candidates=(7,),
            seeds=(17,),
            walk_forward_folds=1,
            walk_forward_test_days=12,
            walk_forward_validation_days=12,
            training=TrainingConfig(epochs=2, batch_size=64, patience=1),
        )
        result = run_phase1_research(
            _observations(240),
            run_id="phase1-integration-test",
            generated_at_utc=datetime(2025, 1, 1, tzinfo=UTC),
            config=config,
        )
        metrics = result.evidence["comparison"]
        self.assertIsInstance(metrics, dict)
        self.assertEqual(
            set(metrics),
            {"naive-persistence", "original-mspciformer", "vasa-mspciformer"},
        )
        self.assertIn("latest-forecast.json", result.artifacts)
        self.assertIn("actual-vs-predicted.svg", result.artifacts)
        self.assertFalse(result.evidence["portfolio_or_frontend_changed"])


def _observations(days: int) -> list[ProviderObservation]:
    start = date(2024, 1, 1)
    retrieved = datetime(2025, 1, 1, tzinfo=UTC)
    result: list[ProviderObservation] = []
    for offset in range(days):
        observed = datetime.combine(start + timedelta(days=offset), datetime.min.time(), UTC)
        for asset_index, asset in enumerate(ASSETS):
            value = 100 * (asset_index + 1) * math.exp(offset * (0.001 + asset_index * 0.0002))
            result.append(
                ProviderObservation(
                    asset=asset,
                    channel=ObservationChannel.MARKET,
                    metric="price_usd",
                    interval="1d",
                    observed_at_utc=observed,
                    available_at_utc=observed + timedelta(days=1),
                    retrieved_at_utc=retrieved,
                    decimal_value=f"{value:.8f}",
                    missing=False,
                    provider="coin-metrics",
                    source_reference="test://market",
                    provider_revision="community-api-v4",
                    response_sha256=hashlib.sha256(str(offset).encode()).hexdigest(),
                    terms_reference="test://terms",
                    license_status="test-only",
                )
            )
    return result


if __name__ == "__main__":
    unittest.main()
