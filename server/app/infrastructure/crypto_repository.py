from __future__ import annotations

import base64
import hashlib
import json
import zlib
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, cast

from server.app.application.ports import ImmutableStoreResult, KeyValueStore
from server.app.domain.crypto import ObservationChannel, ProviderObservation
from server.app.infrastructure.encryption import canonical_json_bytes


class ImmutableResearchRecordConflict(ValueError):
    pass


class CorruptResearchRecord(ValueError):
    pass


def _timestamp_key(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y%m%dT%H%M%S.%fZ")


def _safe_key_part(value: str) -> str:
    return value.replace(":", "-").replace("/", "-")


class CryptoResearchRepository:
    _ARCHIVE_CHUNK_BYTES = 64 * 1024

    def __init__(self, store: KeyValueStore) -> None:
        self._store = store
        self._license_cache: set[tuple[str, str]] = set()

    def put_observation(self, observation: ProviderObservation) -> ImmutableStoreResult:
        key = self.observation_key(observation)
        document = {**observation.to_dict(), "record_id": observation.record_id}
        existing = self._store.get(key)
        if existing is not None:
            stored = ProviderObservation.from_dict(self._load(existing))
            if stored.record_id != observation.record_id:
                raise ImmutableResearchRecordConflict(
                    f"immutable research observation already exists with different content: {key}"
                )
            result = ImmutableStoreResult(
                key=key, record_id=observation.record_id, deduplicated=True
            )
        else:
            self._put_immutable(key, document)
            result = ImmutableStoreResult(
                key=key, record_id=observation.record_id, deduplicated=False
            )
        self._put_license(observation)
        return result

    def put_observations(
        self, observations: Sequence[ProviderObservation]
    ) -> tuple[ImmutableStoreResult, ...]:
        return tuple(self.put_observation(item) for item in observations)

    def put_observation_archive(
        self, observations: Sequence[ProviderObservation]
    ) -> ImmutableStoreResult:
        if not observations:
            raise ValueError("observation archive cannot be empty")
        payload = canonical_json_bytes([item.to_dict() for item in observations])
        archive_hash = hashlib.sha256(
            canonical_json_bytes([item.record_id for item in observations])
        ).hexdigest()
        manifest_key = f"observation-archive:{archive_hash}"
        compressed = zlib.compress(payload, level=9)
        chunks = [
            compressed[offset : offset + self._ARCHIVE_CHUNK_BYTES]
            for offset in range(0, len(compressed), self._ARCHIVE_CHUNK_BYTES)
        ]
        manifest = {
            "schema_version": 1,
            "archive_hash": archive_hash,
            "encoding": "zlib-json-v1",
            "observation_count": len(observations),
            "content_sha256": hashlib.sha256(payload).hexdigest(),
            "uncompressed_size_bytes": len(payload),
            "compressed_size_bytes": len(compressed),
            "compressed_sha256": hashlib.sha256(compressed).hexdigest(),
            "chunk_size_bytes": self._ARCHIVE_CHUNK_BYTES,
            "chunk_hashes": [hashlib.sha256(chunk).hexdigest() for chunk in chunks],
        }
        encoded_manifest = canonical_json_bytes(manifest).decode()
        existing = self._store.get(manifest_key)
        if existing is not None:
            existing_manifest = self._load(existing)
            if existing_manifest.get("archive_hash") != archive_hash or existing_manifest.get(
                "observation_count"
            ) != len(observations):
                raise ImmutableResearchRecordConflict(
                    f"immutable observation archive conflict: {manifest_key}"
                )
            return ImmutableStoreResult(
                key=manifest_key,
                record_id=archive_hash,
                deduplicated=True,
            )
        for index, chunk in enumerate(chunks):
            self._store.put(
                f"observation-archive-chunk:{archive_hash}:{index:06d}",
                base64.b64encode(chunk).decode("ascii"),
            )
        self._store.put(manifest_key, encoded_manifest)
        for observation in observations:
            self._put_license(observation)
        return ImmutableStoreResult(
            key=manifest_key,
            record_id=archive_hash,
            deduplicated=False,
        )

    def observations(self) -> list[ProviderObservation]:
        values = self._store.range_values("mkt:")
        records = [ProviderObservation.from_dict(self._load(value)) for value in values]
        for encoded in self._store.range_values("observation-archive:"):
            manifest = self._load(encoded)
            archive_hash = manifest.get("archive_hash")
            if not isinstance(archive_hash, str):
                raise CorruptResearchRecord("observation archive hash is invalid")
            records.extend(self.restore_observation_archive(archive_hash))
        records = list({item.record_id: item for item in records}.values())
        records.sort(
            key=lambda item: (
                item.observed_at_utc,
                item.asset.value,
                item.channel.value,
                item.metric,
                item.available_at_utc,
                item.provider_revision,
            )
        )
        return records

    def restore_observation_archive(self, archive_hash: str) -> tuple[ProviderObservation, ...]:
        manifest_encoded = self._store.get(f"observation-archive:{archive_hash}")
        if manifest_encoded is None:
            raise KeyError(archive_hash)
        manifest = self._load(manifest_encoded)
        if (
            manifest.get("schema_version") != 1
            or manifest.get("archive_hash") != archive_hash
            or manifest.get("encoding") != "zlib-json-v1"
        ):
            raise CorruptResearchRecord("observation archive manifest is invalid")
        chunk_hashes = manifest.get("chunk_hashes")
        if not isinstance(chunk_hashes, list) or not all(
            isinstance(value, str) for value in chunk_hashes
        ):
            raise CorruptResearchRecord("observation archive chunk hashes are invalid")
        chunks: list[bytes] = []
        for index, expected_hash in enumerate(chunk_hashes):
            encoded = self._store.get(f"observation-archive-chunk:{archive_hash}:{index:06d}")
            if encoded is None:
                raise CorruptResearchRecord("observation archive chunk is missing")
            try:
                chunk = base64.b64decode(encoded, validate=True)
            except ValueError as exc:
                raise CorruptResearchRecord(
                    "observation archive chunk is not valid base64"
                ) from exc
            if hashlib.sha256(chunk).hexdigest() != expected_hash:
                raise CorruptResearchRecord("observation archive chunk checksum mismatch")
            chunks.append(chunk)
        compressed = b"".join(chunks)
        if hashlib.sha256(compressed).hexdigest() != manifest.get("compressed_sha256"):
            raise CorruptResearchRecord("observation archive checksum mismatch")
        try:
            payload = zlib.decompress(compressed)
        except zlib.error as exc:
            raise CorruptResearchRecord("observation archive decompression failed") from exc
        if len(payload) != manifest.get("uncompressed_size_bytes"):
            raise CorruptResearchRecord("observation archive size mismatch")
        content_hash = manifest.get("content_sha256", archive_hash)
        if hashlib.sha256(payload).hexdigest() != content_hash:
            raise CorruptResearchRecord("observation archive content hash mismatch")
        value = json.loads(payload)
        if not isinstance(value, list) or len(value) != manifest.get("observation_count"):
            raise CorruptResearchRecord("observation archive rows are invalid")
        if not all(isinstance(item, dict) for item in value):
            raise CorruptResearchRecord("observation archive row must be an object")
        observations = tuple(
            ProviderObservation.from_dict(cast(dict[str, object], item)) for item in value
        )
        restored_hash = hashlib.sha256(
            canonical_json_bytes([item.record_id for item in observations])
        ).hexdigest()
        if manifest.get("content_sha256") is not None and restored_hash != archive_hash:
            raise CorruptResearchRecord("observation archive identity hash mismatch")
        return observations

    def record_ingestion_attempt(self, record: dict[str, object]) -> ImmutableStoreResult:
        attempt_id = record.get("attempt_id")
        if not isinstance(attempt_id, str) or not attempt_id:
            raise ValueError("ingestion attempt requires an attempt_id")
        key = f"ingest:{_safe_key_part(attempt_id)}"
        return self._put_immutable(key, {"schema_version": 1, **record})

    def ingestion_attempts(self) -> list[dict[str, Any]]:
        return [self._load(value) for value in self._store.range_values("ingest:")]

    @staticmethod
    def observation_key(observation: ProviderObservation) -> str:
        timestamp = _timestamp_key(observation.observed_at_utc)
        provider = _safe_key_part(observation.provider)
        revision = _safe_key_part(observation.provider_revision)
        metric = _safe_key_part(observation.metric)
        if observation.channel is ObservationChannel.MARKET:
            return (
                f"mkt:{observation.asset.value}:{observation.interval}:{timestamp}:"
                f"{provider}:{revision}:{metric}"
            )
        raise ValueError("the active market-only repository accepts market observations only")

    def _put_license(self, observation: ProviderObservation) -> None:
        identity = (observation.provider, observation.provider_revision)
        if identity in self._license_cache:
            return
        key = (
            f"license:{_safe_key_part(observation.provider)}:"
            f"{_safe_key_part(observation.provider_revision)}"
        )
        self._put_immutable(
            key,
            {
                "schema_version": 1,
                "provider": observation.provider,
                "provider_revision": observation.provider_revision,
                "terms_reference": observation.terms_reference,
                "license_status": observation.license_status,
            },
        )
        self._license_cache.add(identity)

    def _put_immutable(self, key: str, document: dict[str, object]) -> ImmutableStoreResult:
        encoded = canonical_json_bytes(document).decode("utf-8")
        record_id = hashlib.sha256(encoded.encode()).hexdigest()
        existing = self._store.get(key)
        if existing is not None:
            if existing != encoded:
                raise ImmutableResearchRecordConflict(
                    f"immutable research record already exists with different content: {key}"
                )
            return ImmutableStoreResult(key=key, record_id=record_id, deduplicated=True)
        self._store.put(key, encoded)
        return ImmutableStoreResult(key=key, record_id=record_id, deduplicated=False)

    @staticmethod
    def _load(encoded: str) -> dict[str, Any]:
        try:
            value = json.loads(encoded)
        except json.JSONDecodeError as exc:
            raise CorruptResearchRecord("research record is not valid JSON") from exc
        if not isinstance(value, dict):
            raise CorruptResearchRecord("research record must be an object")
        return cast(dict[str, Any], value)
