from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum


class CryptoAsset(StrEnum):
    BTC = "BTC"
    ETH = "ETH"
    SOL = "SOL"

    @classmethod
    def parse(cls, value: str) -> CryptoAsset:
        try:
            return cls(value)
        except ValueError as exc:
            raise ValueError("crypto asset must be one of BTC, ETH, or SOL") from exc


class ObservationChannel(StrEnum):
    MARKET = "market"
    # Retained solely so immutable historical observation archives remain
    # readable; the active repository accepts market observations only.
    ON_CHAIN = "on_chain"
    SENTIMENT = "sentiment"


_METRIC_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_PROVIDER_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def canonical_decimal(value: str) -> str:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("observation value must be a decimal string") from exc
    if not parsed.is_finite():
        raise ValueError("observation value must be finite")
    if parsed == 0:
        return "0"
    return format(parsed.normalize(), "f")


def utc_datetime(value: datetime, *, field: str) -> datetime:
    if value.tzinfo is None:
        raise ValueError(f"{field} must be timezone-aware")
    return value.astimezone(UTC)


@dataclass(frozen=True)
class ProviderObservation:
    asset: CryptoAsset
    channel: ObservationChannel
    metric: str
    interval: str
    observed_at_utc: datetime
    available_at_utc: datetime
    retrieved_at_utc: datetime
    decimal_value: str | None
    missing: bool
    provider: str
    source_reference: str
    provider_revision: str
    response_sha256: str
    terms_reference: str
    license_status: str

    def __post_init__(self) -> None:
        observed = utc_datetime(self.observed_at_utc, field="observed_at_utc")
        available = utc_datetime(self.available_at_utc, field="available_at_utc")
        retrieved = utc_datetime(self.retrieved_at_utc, field="retrieved_at_utc")
        object.__setattr__(self, "observed_at_utc", observed)
        object.__setattr__(self, "available_at_utc", available)
        object.__setattr__(self, "retrieved_at_utc", retrieved)
        if available < observed:
            raise ValueError("availability cannot precede the observation time")
        if retrieved < available:
            raise ValueError("retrieval cannot precede provider availability")
        if not _METRIC_PATTERN.fullmatch(self.metric):
            raise ValueError("metric must be a lower snake-case identifier")
        if not _PROVIDER_PATTERN.fullmatch(self.provider):
            raise ValueError("provider must be a lower kebab-case identifier")
        if not self.interval or ":" in self.interval:
            raise ValueError("interval must be non-empty and cannot contain ':'")
        if not self.provider_revision or ":" in self.provider_revision:
            raise ValueError("provider revision must be non-empty and cannot contain ':'")
        if not _SHA256_PATTERN.fullmatch(self.response_sha256):
            raise ValueError("response checksum must be a lowercase SHA-256 digest")
        if not self.source_reference or not self.terms_reference or not self.license_status:
            raise ValueError("provider provenance and license fields are required")
        if self.missing != (self.decimal_value is None):
            raise ValueError("missing must be true exactly when decimal_value is null")
        if self.decimal_value is not None:
            object.__setattr__(self, "decimal_value", canonical_decimal(self.decimal_value))

    @property
    def observed_timestamp(self) -> str:
        return self.observed_at_utc.isoformat().replace("+00:00", "Z")

    @property
    def record_id(self) -> str:
        identity = self.to_dict()
        identity.pop("retrieved_at_utc")
        encoded = json.dumps(
            identity, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": 1,
            "asset": self.asset.value,
            "channel": self.channel.value,
            "metric": self.metric,
            "interval": self.interval,
            "observed_at_utc": self.observed_timestamp,
            "available_at_utc": self.available_at_utc.isoformat().replace("+00:00", "Z"),
            "retrieved_at_utc": self.retrieved_at_utc.isoformat().replace("+00:00", "Z"),
            "decimal_value": self.decimal_value,
            "missing": self.missing,
            "provider": self.provider,
            "source_reference": self.source_reference,
            "provider_revision": self.provider_revision,
            "response_sha256": self.response_sha256,
            "terms_reference": self.terms_reference,
            "license_status": self.license_status,
        }

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> ProviderObservation:
        if value.get("schema_version") != 1:
            raise ValueError("unsupported provider observation schema")
        missing = value.get("missing")
        if not isinstance(missing, bool):
            raise ValueError("provider observation missing flag must be boolean")
        return cls(
            asset=CryptoAsset.parse(str(value["asset"])),
            channel=ObservationChannel(str(value["channel"])),
            metric=str(value["metric"]),
            interval=str(value["interval"]),
            observed_at_utc=datetime.fromisoformat(
                str(value["observed_at_utc"]).replace("Z", "+00:00")
            ),
            available_at_utc=datetime.fromisoformat(
                str(value["available_at_utc"]).replace("Z", "+00:00")
            ),
            retrieved_at_utc=datetime.fromisoformat(
                str(value["retrieved_at_utc"]).replace("Z", "+00:00")
            ),
            decimal_value=(
                None if value.get("decimal_value") is None else str(value["decimal_value"])
            ),
            missing=missing,
            provider=str(value["provider"]),
            source_reference=str(value["source_reference"]),
            provider_revision=str(value["provider_revision"]),
            response_sha256=str(value["response_sha256"]),
            terms_reference=str(value["terms_reference"]),
            license_status=str(value["license_status"]),
        )
