from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from server.app.domain.crypto import CryptoAsset, ObservationChannel
from server.app.infrastructure.provider_adapters import (
    CoinGeckoCurrentQuoteAdapter,
    CoinMetricsMarketAdapter,
    JsonResponse,
)


def _response(url: str, payload: object, marker: str = "a") -> JsonResponse:
    return JsonResponse(
        url,
        datetime(2026, 10, 14, tzinfo=UTC),
        payload,
        hashlib.sha256(marker.encode()).hexdigest(),
    )


def test_coin_metrics_market_adapter_follows_pagination_and_preserves_decimal_strings() -> None:
    calls: list[str] = []

    def fetch(url: str) -> JsonResponse:
        calls.append(url)
        if len(calls) == 1:
            return _response(
                url,
                {
                    "data": [
                        {"asset": "btc", "time": "2025-01-01T00:00:00Z", "PriceUSD": "93452.1200"}
                    ],
                    "next_page_url": "https://example.test/page-2",
                },
            )
        return _response(
            url,
            {"data": [{"asset": "eth", "time": "2025-01-01T00:00:00Z", "PriceUSD": "3350.50"}]},
            "b",
        )

    items = CoinMetricsMarketAdapter(fetcher=fetch).observations(
        assets=(CryptoAsset.BTC, CryptoAsset.ETH),
        start_utc=datetime(2025, 1, 1, tzinfo=UTC),
        end_utc=datetime(2025, 1, 1, tzinfo=UTC),
    )

    assert len(calls) == 2
    assert [item.asset for item in items] == [CryptoAsset.BTC, CryptoAsset.ETH]
    assert [item.decimal_value for item in items] == ["93452.12", "3350.5"]
    assert all(item.channel is ObservationChannel.MARKET for item in items)


def test_coingecko_current_quote_maps_exact_asset_ids_and_provider_time() -> None:
    def fetch(url: str) -> JsonResponse:
        return _response(
            url,
            {
                "bitcoin": {"usd": "90000.25", "last_updated_at": "1760000000"},
                "ethereum": {"usd": "3000", "last_updated_at": "1760000000"},
                "solana": {"usd": "150.5", "last_updated_at": "1760000000"},
            },
        )

    items = CoinGeckoCurrentQuoteAdapter(fetcher=fetch).observations(
        assets=tuple(CryptoAsset),
        start_utc=datetime(2025, 1, 1, tzinfo=UTC),
        end_utc=datetime(2025, 1, 1, tzinfo=UTC),
    )

    assert [item.asset for item in items] == list(CryptoAsset)
    assert [item.decimal_value for item in items] == ["90000.25", "3000", "150.5"]
    assert all(item.metric == "price_usd_spot" for item in items)
