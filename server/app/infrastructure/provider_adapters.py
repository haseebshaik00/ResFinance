from __future__ import annotations

import hashlib
import json
import urllib.parse
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Protocol, cast

from server.app.domain.crypto import CryptoAsset, ObservationChannel, ProviderObservation

COIN_METRICS_TERMS = "https://github.com/coinmetrics/data"
COINGECKO_TERMS = "https://www.coingecko.com/en/api_terms"


@dataclass(frozen=True)
class JsonResponse:
    url: str
    retrieved_at_utc: datetime
    payload: object
    sha256: str


class JsonFetcher(Protocol):
    def __call__(self, url: str) -> JsonResponse: ...


def fetch_json(url: str) -> JsonResponse:
    request = urllib.request.Request(url, headers={"User-Agent": "ResFinance-Crypto/1.0"})
    retrieved = datetime.now(UTC)
    with urllib.request.urlopen(request, timeout=60) as response:
        content = response.read()
    return JsonResponse(
        url=url,
        retrieved_at_utc=retrieved,
        payload=json.loads(content, parse_float=str, parse_int=str),
        sha256=hashlib.sha256(content).hexdigest(),
    )


class CoinMetricsMarketAdapter:
    provider = "coin-metrics"
    adapter_id = "coin-metrics-market"
    supported_assets: frozenset[CryptoAsset] = frozenset(
        (CryptoAsset.BTC, CryptoAsset.ETH, CryptoAsset.SOL)
    )

    def __init__(self, *, fetcher: JsonFetcher = fetch_json) -> None:
        self._fetcher = fetcher

    def observations(
        self,
        *,
        assets: Sequence[CryptoAsset],
        start_utc: datetime,
        end_utc: datetime,
    ) -> Sequence[ProviderObservation]:
        requested = tuple(assets)
        if not requested or not set(requested).issubset(self.supported_assets):
            raise ValueError("Coin Metrics market adapter supports BTC, ETH, and SOL only")
        query = urllib.parse.urlencode(
            {
                "assets": ",".join(asset.value.lower() for asset in requested),
                "metrics": "PriceUSD",
                "frequency": "1d",
                "start_time": start_utc.date().isoformat(),
                "end_time": end_utc.date().isoformat(),
                "page_size": "10000",
                "paging_from": "start",
            }
        )
        next_url: str | None = (
            "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?" + query
        )
        result: list[ProviderObservation] = []
        while next_url:
            response = self._fetcher(next_url)
            body = _object(response.payload, "Coin Metrics response")
            rows = body.get("data")
            if not isinstance(rows, list):
                raise ValueError("Coin Metrics response data must be a list")
            for raw in rows:
                row = _object(raw, "Coin Metrics row")
                asset = CryptoAsset.parse(str(row["asset"]).upper())
                if asset not in requested:
                    raise ValueError("Coin Metrics returned an unrequested asset")
                observed = _parse_provider_time(str(row["time"]))
                raw_value = row.get("PriceUSD")
                value = None if raw_value is None else _decimal(str(raw_value))
                result.append(
                    ProviderObservation(
                        asset=asset,
                        channel=ObservationChannel.MARKET,
                        metric="price_usd",
                        interval="1d",
                        observed_at_utc=observed,
                        available_at_utc=observed + timedelta(days=1),
                        retrieved_at_utc=response.retrieved_at_utc,
                        decimal_value=value,
                        missing=value is None,
                        provider=self.provider,
                        source_reference=response.url,
                        provider_revision="community-api-v4",
                        response_sha256=response.sha256,
                        terms_reference=COIN_METRICS_TERMS,
                        license_status="cc-by-nc-4.0-noncommercial-research-with-attribution",
                    )
                )
            raw_next = body.get("next_page_url")
            next_url = str(raw_next) if raw_next else None
        return result


class CoinGeckoCurrentQuoteAdapter:
    provider = "coingecko"
    adapter_id = "coingecko-current-quote"
    supported_assets: frozenset[CryptoAsset] = frozenset(
        (CryptoAsset.BTC, CryptoAsset.ETH, CryptoAsset.SOL)
    )
    _ids = {CryptoAsset.BTC: "bitcoin", CryptoAsset.ETH: "ethereum", CryptoAsset.SOL: "solana"}

    def __init__(self, *, fetcher: JsonFetcher = fetch_json) -> None:
        self._fetcher = fetcher

    def observations(
        self,
        *,
        assets: Sequence[CryptoAsset],
        start_utc: datetime,
        end_utc: datetime,
    ) -> Sequence[ProviderObservation]:
        del start_utc, end_utc
        query = urllib.parse.urlencode(
            {
                "ids": ",".join(self._ids[asset] for asset in assets),
                "vs_currencies": "usd",
                "include_last_updated_at": "true",
            }
        )
        response = self._fetcher(f"https://api.coingecko.com/api/v3/simple/price?{query}")
        body = _object(response.payload, "CoinGecko response")
        result: list[ProviderObservation] = []
        for asset in assets:
            quote = _object(body.get(self._ids[asset]), f"CoinGecko {self._ids[asset]} quote")
            observed = datetime.fromtimestamp(int(str(quote.get("last_updated_at"))), UTC)
            result.append(
                ProviderObservation(
                    asset=asset,
                    channel=ObservationChannel.MARKET,
                    metric="price_usd_spot",
                    interval="spot",
                    observed_at_utc=observed,
                    available_at_utc=observed,
                    retrieved_at_utc=response.retrieved_at_utc,
                    decimal_value=_decimal(str(quote["usd"])),
                    missing=False,
                    provider=self.provider,
                    source_reference=response.url,
                    provider_revision="simple-price-v3",
                    response_sha256=response.sha256,
                    terms_reference=COINGECKO_TERMS,
                    license_status="current-display-with-attribution-no-redistribution",
                )
            )
        return result


def _parse_provider_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("provider timestamp must include a timezone")
    return parsed.astimezone(UTC)


def _decimal(value: str) -> str:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("provider value is not a decimal") from exc
    if not parsed.is_finite():
        raise ValueError("provider value must be finite")
    return "0" if parsed == 0 else format(parsed.normalize(), "f")


def _object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return cast(dict[str, object], value)
