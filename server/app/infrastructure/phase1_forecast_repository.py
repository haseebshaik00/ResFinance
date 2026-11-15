from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, cast

from ml.data.market_daily import ASSETS, align_daily_market
from ml.inference.phase1 import forecast_from_deployment_artifacts
from server.app.application.ports import KeyValueStore
from server.app.domain.crypto import ObservationChannel, ProviderObservation
from server.app.domain.phase2_portfolio import (
    ForecastAccuracy,
    HistoricalPrice,
    SevenDayAssetForecast,
    SevenDayForecast,
)
from server.app.infrastructure.blob_repository import EncryptedBlobRepository
from server.app.infrastructure.crypto_repository import CryptoResearchRepository


@dataclass(frozen=True)
class Phase1ForecastBundle:
    forecast: SevenDayForecast
    price_history: tuple[HistoricalPrice, ...]


class Phase1ForecastRepository:
    """Read verified Phase 1 v2 artifacts without mutating research evidence."""

    def __init__(
        self,
        store: KeyValueStore,
        blobs: EncryptedBlobRepository,
        market: CryptoResearchRepository,
    ) -> None:
        self._store = store
        self._blobs = blobs
        self._market = market
        self._cache: Phase1ForecastBundle | None = None
        self._cache_expires_monotonic = 0.0
        self._lock = threading.Lock()

    def latest_forecast(self, *, now_utc: datetime | None = None) -> Phase1ForecastBundle:
        now = (now_utc or datetime.now(UTC)).astimezone(UTC)
        use_cache = now_utc is None
        if use_cache:
            with self._lock:
                if self._cache is not None and time.monotonic() < self._cache_expires_monotonic:
                    return self._cache
        manifest = self._latest_active_manifest()
        artifacts = {
            name: self._restore_artifact(manifest, name)
            for name in (
                "latest-forecast.json",
                "metrics.json",
                "predictions.json",
                "deployment-checkpoint.json",
                "deployment-preprocessing.json",
                "experiment-config.json",
            )
        }
        stored = _object(artifacts["latest-forecast.json"], "latest forecast")
        stored_cutoff = _datetime(stored, "market_data_cutoff_utc")
        observations = self._eligible_observations(now, manifest, stored_cutoff)
        history = align_daily_market(observations)
        latest_market_cutoff = datetime.combine(history.dates[-1], datetime.min.time(), UTC)
        refreshed = False
        if latest_market_cutoff > stored_cutoff:
            stored = forecast_from_deployment_artifacts(
                observations,
                checkpoint=artifacts["deployment-checkpoint.json"],
                preprocessing=artifacts["deployment-preprocessing.json"],
                experiment_config=artifacts["experiment-config.json"],
                generated_at_utc=now,
            )
            refreshed = True
        forecast = self._forecast(
            stored,
            manifest=manifest,
            metrics=_object(artifacts["metrics.json"], "metrics"),
            predictions=_object(artifacts["predictions.json"], "predictions"),
            now=now,
            refreshed=refreshed,
        )
        prices = tuple(
            HistoricalPrice(
                asset=asset,
                observed_date_utc=day,
                price_usd=_price_string(history.prices[day_index, asset_index]),
            )
            for day_index, day in enumerate(history.dates)
            for asset_index, asset in enumerate(ASSETS)
            if day <= forecast.market_data_cutoff_utc.date()
        )
        bundle = Phase1ForecastBundle(forecast=forecast, price_history=prices)
        if use_cache:
            with self._lock:
                self._cache = bundle
                self._cache_expires_monotonic = time.monotonic() + 60.0
        return bundle

    def _latest_active_manifest(self) -> dict[str, Any]:
        candidates: list[dict[str, Any]] = []
        for encoded in self._store.range_values("phase1-run:"):
            value = json.loads(encoded)
            if not isinstance(value, dict):
                continue
            if (
                value.get("schema_version") == 2
                and value.get("purpose") == "phase-1-market-only-mspciformer-vasa-research"
                and value.get("active_models") == ["original-mspciformer", "vasa-mspciformer"]
                and value.get("comparison_protocol") == "original-mspciformer-versus-vasa-only"
            ):
                candidates.append(cast(dict[str, Any], value))
        if not candidates:
            raise KeyError("no active two-model Phase 1 research run is available")
        candidates.sort(key=lambda value: str(value.get("generated_at_utc", "")))
        return candidates[-1]

    def _restore_artifact(self, manifest: dict[str, Any], name: str) -> bytes:
        persisted = manifest.get("persisted_artifacts")
        hashes = manifest.get("artifact_hashes")
        if not isinstance(persisted, dict) or not isinstance(hashes, dict):
            raise ValueError("Phase 1 manifest artifact metadata is missing")
        record = persisted.get(name)
        expected = hashes.get(name)
        if not isinstance(record, dict) or not isinstance(expected, str):
            raise ValueError(f"Phase 1 artifact is missing: {name}")
        digest = record.get("sha256")
        if digest != expected or not isinstance(digest, str):
            raise ValueError(f"Phase 1 artifact hash metadata disagrees: {name}")
        content = self._blobs.get(digest)
        if hashlib.sha256(content).hexdigest() != digest:
            raise ValueError(f"Phase 1 artifact restoration failed: {name}")
        return content

    def _eligible_observations(
        self,
        now: datetime,
        manifest: dict[str, Any],
        stored_cutoff: datetime,
    ) -> list[ProviderObservation]:
        latest_complete = now.date() - timedelta(days=1)
        archive_key = manifest.get("observation_archive_key")
        if stored_cutoff.date() >= latest_complete and isinstance(archive_key, str):
            prefix = "observation-archive:"
            if not archive_key.startswith(prefix):
                raise ValueError("Phase 1 observation archive key is invalid")
            source = list(self._market.restore_observation_archive(archive_key[len(prefix) :]))
        else:
            source = self._market.observations()
        eligible = [
            item
            for item in source
            if item.channel is ObservationChannel.MARKET
            and item.metric == "price_usd"
            and item.interval == "1d"
            and item.observed_at_utc.date() <= latest_complete
            and item.available_at_utc <= now
        ]
        if not eligible:
            raise ValueError("no completed Phase 1 market observations are available")
        selected: dict[tuple[object, object], ProviderObservation] = {}
        for item in eligible:
            key = (item.observed_at_utc.date(), item.asset)
            previous = selected.get(key)
            if previous is None or (
                item.available_at_utc,
                item.retrieved_at_utc,
                item.provider_revision,
                item.record_id,
            ) > (
                previous.available_at_utc,
                previous.retrieved_at_utc,
                previous.provider_revision,
                previous.record_id,
            ):
                selected[key] = item
        return list(selected.values())

    def _forecast(
        self,
        value: dict[str, Any],
        *,
        manifest: dict[str, Any],
        metrics: dict[str, Any],
        predictions: dict[str, Any],
        now: datetime,
        refreshed: bool,
    ) -> SevenDayForecast:
        if value.get("forecast_horizon_days") != 7:
            raise ValueError("Phase 1 artifact is not a seven-day forecast")
        selected = _text(manifest, "selected_latest_forecast_model")
        if selected not in {"original-mspciformer", "vasa-mspciformer"}:
            raise ValueError("Phase 1 manifest selected an unsupported model")
        if value.get("model_key") != selected:
            raise ValueError("forecast model does not match validation-selected metadata")
        assets_value = value.get("assets")
        dates_value = value.get("forecast_dates_utc")
        if not isinstance(assets_value, dict) or not isinstance(dates_value, list):
            raise ValueError("Phase 1 forecast rows are invalid")
        cutoff = _datetime(value, "market_data_cutoff_utc")
        dates = tuple(datetime.fromisoformat(str(item)).date() for item in dates_value)
        reasons: list[str] = []
        latest_complete = now.date() - timedelta(days=1)
        if cutoff.date() < latest_complete:
            reasons.append(
                f"Market data ends {cutoff.date().isoformat()}, before the latest completed "
                f"UTC day {latest_complete.isoformat()}."
            )
        if dates and dates[-1] < now.date():
            reasons.append(f"Forecast window ended {dates[-1].isoformat()}.")
        quality = value.get("quality_checks")
        if (
            not isinstance(quality, dict)
            or quality.get("finite") is not True
            or quality.get("positive_prices") is not True
        ):
            raise ValueError("Phase 1 forecast quality checks did not pass")
        holdout = metrics.get("holdout")
        if not isinstance(holdout, dict):
            raise ValueError("Phase 1 metrics do not contain holdout results")
        return SevenDayForecast(
            run_id=_text(manifest, "run_id"),
            manifest_key=f"phase1-run:{_text(manifest, 'run_id')}:manifest",
            model_key=cast(Any, selected),
            model_name=_text(value, "model"),
            model_version=_text(value, "model_version"),
            generated_at_utc=_datetime(value, "generated_at_utc"),
            market_data_cutoff_utc=cutoff,
            forecast_dates_utc=dates,
            assets=tuple(
                _asset_forecast(
                    asset.value,
                    assets_value.get(asset.value),
                    predictions=predictions,
                    model_key=selected,
                )
                for asset in ASSETS
            ),
            status="stale" if reasons else "current",
            stale_reasons=tuple(reasons),
            refreshed_from_checkpoint=refreshed,
            quality_checks=cast(dict[str, object], quality),
            accuracy=tuple(
                _accuracy(name, holdout.get(name))
                for name in ("original-mspciformer", "vasa-mspciformer")
            ),
        )


def _asset_forecast(
    asset: str,
    raw: object,
    *,
    predictions: dict[str, Any],
    model_key: str,
) -> SevenDayAssetForecast:
    if not isinstance(raw, dict):
        raise ValueError(f"Phase 1 forecast is missing {asset}")
    predicted_prices = tuple(str(value) for value in _list(raw, "predicted_prices"))
    p10_prices, p50_prices, p90_prices = _empirical_price_quantiles(
        asset=asset,
        predicted_prices=predicted_prices,
        predictions=predictions,
        model_key=model_key,
    )
    return SevenDayAssetForecast(
        asset=next(item for item in ASSETS if item.value == asset),
        current_price=str(raw["current_price"]),
        predicted_prices=predicted_prices,
        predicted_daily_returns=tuple(
            str(value) for value in _list(raw, "predicted_daily_returns")
        ),
        predicted_return_7d=str(raw["predicted_return_7d"]),
        p10_prices=p10_prices,
        p50_prices=p50_prices,
        p90_prices=p90_prices,
    )


def _empirical_price_quantiles(
    *,
    asset: str,
    predicted_prices: tuple[str, ...],
    predictions: dict[str, Any],
    model_key: str,
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    """Apply immutable holdout residual quantiles to the current point path.

    The active model has a point-price head. These visualization-only paths
    form an empirical predictive distribution from the selected model's
    untouched holdout residuals; portfolio return and covariance inputs retain
    the original point forecast.
    """

    if predictions.get("assets") != [item.value for item in ASSETS]:
        raise ValueError("Phase 1 prediction artifact assets are invalid")
    rows = _list(predictions, "rows")
    asset_index = next(index for index, item in enumerate(ASSETS) if item.value == asset)
    residuals: list[list[Decimal]] = [[] for _ in predicted_prices]
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Phase 1 prediction row is invalid")
        actual = _matrix(row.get("actual_prices"), "actual_prices")
        predicted_by_model = row.get("predicted_prices")
        if not isinstance(predicted_by_model, dict):
            raise ValueError("Phase 1 prediction model paths are invalid")
        predicted = _matrix(predicted_by_model.get(model_key), f"{model_key} predicted_prices")
        if len(actual) != len(predicted_prices) or len(predicted) != len(predicted_prices):
            raise ValueError("Phase 1 prediction horizon is invalid")
        for day in range(len(predicted_prices)):
            actual_price = _positive_decimal(actual[day][asset_index], "actual price")
            predicted_price = _positive_decimal(predicted[day][asset_index], "predicted price")
            residuals[day].append(actual_price / predicted_price - Decimal(1))
    if any(not values for values in residuals):
        raise ValueError("Phase 1 prediction artifact has no residuals")

    p10: list[str] = []
    p50: list[str] = []
    p90: list[str] = []
    for point_price, day_residuals in zip(predicted_prices, residuals, strict=True):
        point = _positive_decimal(point_price, "latest predicted price")
        p10.append(_decimal_string(point * (Decimal(1) + _quantile(day_residuals, 10))))
        p50.append(_decimal_string(point * (Decimal(1) + _quantile(day_residuals, 50))))
        p90.append(_decimal_string(point * (Decimal(1) + _quantile(day_residuals, 90))))
    return tuple(p10), tuple(p50), tuple(p90)


def _matrix(value: object, label: str) -> list[list[object]]:
    if not isinstance(value, list) or len(value) != 7:
        raise ValueError(f"Phase 1 {label} is invalid")
    result: list[list[object]] = []
    for row in value:
        if not isinstance(row, list) or len(row) != len(ASSETS):
            raise ValueError(f"Phase 1 {label} is invalid")
        result.append(row)
    return result


def _positive_decimal(value: object, label: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except Exception as exc:
        raise ValueError(f"Phase 1 {label} is invalid") from exc
    if not parsed.is_finite() or parsed <= 0:
        raise ValueError(f"Phase 1 {label} is invalid")
    return parsed


def _quantile(values: list[Decimal], percentile: int) -> Decimal:
    ordered = sorted(values)
    numerator = (len(ordered) - 1) * percentile
    lower = numerator // 100
    remainder = numerator % 100
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * Decimal(remainder) / Decimal(100)


def _decimal_string(value: Decimal) -> str:
    if not value.is_finite() or value <= 0:
        raise ValueError("Phase 1 empirical quantile price is invalid")
    return format(value, "f")


def _accuracy(name: str, raw: object) -> ForecastAccuracy:
    if (
        not isinstance(raw, dict)
        or not isinstance(raw.get("aggregate"), dict)
        or not isinstance(raw.get("by_asset"), dict)
    ):
        raise ValueError(f"Phase 1 holdout metrics are invalid for {name}")
    aggregate = cast(dict[str, object], raw["aggregate"])
    by_asset = cast(dict[str, Any], raw["by_asset"])
    return ForecastAccuracy(
        model_key=cast(Any, name),
        mape=str(aggregate["mape"]),
        return_7d_mae=str(aggregate["return_7d_mae"]),
        directional_accuracy=str(aggregate["mda"]),
        btc_day_7_mae_usd=str(by_asset["BTC"]["day_7_mae_usd"]),
        eth_day_7_mae_usd=str(by_asset["ETH"]["day_7_mae_usd"]),
        sol_day_7_mae_usd=str(by_asset["SOL"]["day_7_mae_usd"]),
    )


def _object(content: bytes, label: str) -> dict[str, Any]:
    value = json.loads(content)
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return cast(dict[str, Any], value)


def _list(value: dict[str, Any], field: str) -> list[object]:
    item = value.get(field)
    if not isinstance(item, list):
        raise ValueError(f"{field} must be a list")
    return cast(list[object], item)


def _text(value: dict[str, Any], field: str) -> str:
    item = value.get(field)
    if not isinstance(item, str) or not item:
        raise ValueError(f"{field} must be non-empty text")
    return item


def _datetime(value: dict[str, Any], field: str) -> datetime:
    return datetime.fromisoformat(_text(value, field).replace("Z", "+00:00")).astimezone(UTC)


def _price_string(value: object) -> str:
    return format(Decimal(str(float(cast(Any, value)))).quantize(Decimal("0.00000001")), "f")
