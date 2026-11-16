from __future__ import annotations

import hashlib
import math
import unittest
from datetime import UTC, date, datetime, timedelta

import torch

from ml.data.market_daily import (
    ASSETS,
    align_daily_market,
    build_market_sequences,
    fit_price_standardizer,
    predicted_returns,
    trailing_volatility,
)
from ml.models.vasa_mspciformer import MarketMSPCIFormer, ScaleAggregation
from server.app.domain.crypto import ObservationChannel, ProviderObservation


class Phase1ForecastingContractTest(unittest.TestCase):
    def test_alignment_sequences_volatility_and_no_future_scaler(self) -> None:
        observations = _observations(80)
        history = align_daily_market(list(reversed(observations)))
        self.assertEqual(history.prices.shape, (80, 3))
        sequences = build_market_sequences(
            history,
            lookback=5,
            volatility_lookback=14,
        )
        self.assertEqual(sequences.inputs.shape[1:], (5, 3))
        self.assertEqual(sequences.targets.shape[1:], (7, 3))
        first_origin = int(sequences.origin_indices[0])
        expected = torch.log(
            history.prices[first_origin - 14 + 1 : first_origin + 1]
            / history.prices[first_origin - 14 : first_origin]
        ).std(dim=0, unbiased=False)
        torch.testing.assert_close(sequences.volatility[0], expected)

        cutoff = 40
        baseline = fit_price_standardizer(history, through_index=cutoff)
        mutated_prices = history.prices.clone()
        mutated_prices[cutoff + 1 :] *= 100
        mutated = type(history)(history.dates, mutated_prices, history.observation_ids, "changed")
        after_future_mutation = fit_price_standardizer(mutated, through_index=cutoff)
        torch.testing.assert_close(baseline.mean, after_future_mutation.mean)
        torch.testing.assert_close(baseline.scale, after_future_mutation.scale)

    def test_volatility_uses_only_trailing_returns(self) -> None:
        prices = torch.tensor([[100.0], [101.0], [99.0], [102.0], [5000.0]])
        value = trailing_volatility(prices, origin_index=3, lookback=3)
        expected = torch.log(prices[1:4] / prices[:3]).std(dim=0, unbiased=False)
        torch.testing.assert_close(value, expected)

    def test_vasa_shapes_normalized_weights_and_zero_adjustment_reduction(self) -> None:
        torch.manual_seed(9)
        baseline = MarketMSPCIFormer(
            aggregation=ScaleAggregation.GLOBAL,
            lookback=5,
            patch_sizes=(4, 5),
        )
        torch.manual_seed(9)
        adaptive = MarketMSPCIFormer(
            aggregation=ScaleAggregation.VOLATILITY_ADAPTIVE,
            lookback=5,
            patch_sizes=(4, 5),
        )
        adaptive.load_state_dict(baseline.state_dict(), strict=False)
        values = torch.randn(4, 5, 3)
        volatility = torch.randn(4, 3)
        baseline.eval()
        adaptive.eval()
        with torch.inference_mode():
            original_output = baseline(values, volatility)
            adaptive_output = adaptive(values, volatility)
        self.assertEqual(adaptive_output.standardized_log_prices.shape, (4, 7, 3))
        self.assertEqual(adaptive_output.scale_weights.shape, (4, 3, 2))
        torch.testing.assert_close(adaptive_output.scale_weights.sum(dim=-1), torch.ones(4, 3))
        torch.testing.assert_close(
            original_output.standardized_log_prices,
            adaptive_output.standardized_log_prices,
        )
        torch.testing.assert_close(original_output.scale_weights, adaptive_output.scale_weights)

    def test_price_to_daily_and_cumulative_returns(self) -> None:
        origin = torch.tensor([[100.0, 200.0, 50.0]])
        prices = torch.tensor(
            [
                [
                    [101.0, 202.0, 51.0],
                    [102.0, 204.0, 52.0],
                    [103.0, 206.0, 53.0],
                    [104.0, 208.0, 54.0],
                    [105.0, 210.0, 55.0],
                    [106.0, 212.0, 56.0],
                    [107.0, 214.0, 57.0],
                ]
            ]
        )
        daily, cumulative = predicted_returns(prices, origin)
        self.assertAlmostEqual(float(daily[0, 0, 0]), 0.01, places=6)
        self.assertAlmostEqual(float(daily[0, 1, 0]), 102 / 101 - 1, places=6)
        self.assertAlmostEqual(float(cumulative[0, 0]), 0.07, places=6)


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
