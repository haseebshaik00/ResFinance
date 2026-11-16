from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Protocol

from server.app.domain.crypto import CryptoAsset, ProviderObservation


class MarketDataProvider(Protocol):
    def observations(
        self, *, asset: CryptoAsset, start_utc: datetime, end_utc: datetime
    ) -> Sequence[ProviderObservation]: ...


class CryptoDataProvider(Protocol):
    provider: str
    adapter_id: str
    supported_assets: frozenset[CryptoAsset]

    def observations(
        self,
        *,
        assets: Sequence[CryptoAsset],
        start_utc: datetime,
        end_utc: datetime,
    ) -> Sequence[ProviderObservation]: ...


__all__ = [
    "CryptoDataProvider",
    "MarketDataProvider",
    "ProviderObservation",
]
