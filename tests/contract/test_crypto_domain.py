from __future__ import annotations

from datetime import UTC, datetime

import pytest

from server.app.domain.crypto import (
    CryptoAsset,
    ObservationChannel,
    ProviderObservation,
)


def observation(**changes: object) -> ProviderObservation:
    values: dict[str, object] = {
        "asset": CryptoAsset.BTC,
        "channel": ObservationChannel.MARKET,
        "metric": "price_usd",
        "interval": "1d",
        "observed_at_utc": datetime(2025, 1, 1, tzinfo=UTC),
        "available_at_utc": datetime(2025, 1, 2, tzinfo=UTC),
        "retrieved_at_utc": datetime(2026, 10, 14, tzinfo=UTC),
        "decimal_value": "93452.1200",
        "missing": False,
        "provider": "coin-metrics",
        "source_reference": "https://example.test/query",
        "provider_revision": "community-api-v4",
        "response_sha256": "a" * 64,
        "terms_reference": "https://example.test/terms",
        "license_status": "research-only",
    }
    values.update(changes)
    return ProviderObservation(**values)  # type: ignore[arg-type]


def test_crypto_asset_boundary_accepts_exactly_three_assets() -> None:
    assert [asset.value for asset in CryptoAsset] == ["BTC", "ETH", "SOL"]
    assert CryptoAsset.parse("SOL") is CryptoAsset.SOL

    with pytest.raises(ValueError, match="BTC, ETH, or SOL"):
        CryptoAsset.parse("DOGE")


def test_observation_normalizes_decimal_and_requires_explicit_missingness() -> None:
    item = observation()

    assert item.decimal_value == "93452.12"
    assert item.record_id == observation().record_id

    with pytest.raises(ValueError, match="missing must be true"):
        observation(decimal_value=None, missing=False)


def test_observation_rejects_future_availability_or_invalid_timestamps() -> None:
    with pytest.raises(ValueError, match="availability cannot precede"):
        observation(
            available_at_utc=datetime(2024, 12, 31, tzinfo=UTC),
        )
    with pytest.raises(ValueError, match="timezone-aware"):
        observation(observed_at_utc=datetime(2025, 1, 1))
