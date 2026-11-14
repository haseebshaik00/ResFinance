from __future__ import annotations

import argparse
import hashlib
import json
import os
import uuid
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any, cast

from ml.evaluation.phase1 import TrainingConfig
from ml.runs.phase1 import Phase1Config, run_phase1_research
from scripts.milestone9.run_full_research import load_research_key
from server.app.domain.crypto import CryptoAsset
from server.app.infrastructure.blob_repository import EncryptedBlobRepository
from server.app.infrastructure.crypto_repository import CryptoResearchRepository
from server.app.infrastructure.encryption import AesGcmCipher, canonical_json_bytes
from server.app.infrastructure.provider_adapters import CoinMetricsMarketAdapter
from server.app.infrastructure.resilientdb_cli import DockerResilientDBEventStore

START_DATE = date(2020, 4, 10)


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(
        description=(
            "Run the active two-model market-only seven-day MSPCIFormer/VASA experiment, "
            "persist full artifacts in ResilientDB, and write bounded local evidence."
        )
    )
    value.add_argument(
        "--experiment-config",
        type=Path,
        default=Path("config/crypto-intelligence/phase1-vasa-v2.json"),
    )
    value.add_argument("--end-date", type=date.fromisoformat)
    value.add_argument("--docker", type=Path, default=Path("docker"))
    value.add_argument("--docker-host")
    value.add_argument("--container", default="resfinance-resdb-tools")
    value.add_argument("--resilientdb-config", default="/config/client.config")
    value.add_argument("--encryption-key-env", default="RESFINANCE_RESEARCH_ENCRYPTION_KEY")
    value.add_argument("--encryption-key-container", default="resfinance-api-1")
    value.add_argument("--encryption-key-path", default="/certs/research-blob.key")
    value.add_argument(
        "--output-directory",
        type=Path,
        default=Path(".resfinance-local/research/phase1-vasa-v2"),
    )
    value.add_argument("--evidence-output", type=Path, required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    generated_at = datetime.now(UTC)
    latest_complete = generated_at.date() - timedelta(days=1)
    end_date = args.end_date or latest_complete
    if end_date > latest_complete:
        raise ValueError("end date must be a completed UTC market day")
    config = load_phase1_config(args.experiment_config)
    store = DockerResilientDBEventStore(
        docker=args.docker,
        docker_host=args.docker_host,
        container=args.container,
        config_path=args.resilientdb_config,
        timeout_seconds=120,
    )
    adapter = CoinMetricsMarketAdapter()
    observations = list(
        adapter.observations(
            assets=tuple(CryptoAsset),
            start_utc=datetime.combine(START_DATE, time.min, tzinfo=UTC),
            end_utc=datetime.combine(end_date, time.max, tzinfo=UTC),
        )
    )
    archive = CryptoResearchRepository(store).put_observation_archive(observations)
    run_id = f"phase1-vasa-v2-{uuid.uuid4().hex}"
    result = run_phase1_research(
        observations,
        run_id=run_id,
        generated_at_utc=generated_at,
        config=config,
    )
    key = load_research_key(
        variable=args.encryption_key_env,
        docker=args.docker,
        docker_host=args.docker_host,
        container=args.encryption_key_container,
        path=args.encryption_key_path,
    )
    environment_key = os.environ.get(args.encryption_key_env)
    blobs = EncryptedBlobRepository(
        store,
        AesGcmCipher(
            key,
            key_id=(
                "local-research-blob-key-v1"
                if environment_key is None
                else "local-research-override-" + hashlib.sha256(key).hexdigest()[:16]
            ),
        ),
    )
    persisted_artifacts: dict[str, object] = {}
    for name, content in sorted(result.artifacts.items()):
        receipt = blobs.put(content, media_type=_media_type(name), producing_run_id=run_id)
        restored = blobs.get(receipt.sha256)
        if restored != content:
            raise RuntimeError(f"persisted artifact restoration failed: {name}")
        persisted_artifacts[name] = {
            "sha256": receipt.sha256,
            "manifest_key": receipt.manifest_key,
            "size_bytes": receipt.size_bytes,
        }
    manifest = {
        **result.manifest,
        "observation_archive_key": archive.key,
        "observation_archive_hash": archive.record_id,
        "observation_count": len(observations),
        "persisted_artifacts": persisted_artifacts,
    }
    manifest_key = f"phase1-run:{run_id}:manifest"
    encoded_manifest = canonical_json_bytes(manifest).decode("utf-8")
    existing = store.get(manifest_key)
    if existing is not None and existing != encoded_manifest:
        raise ValueError(f"immutable Phase 1 manifest conflict: {manifest_key}")
    if existing is None:
        store.put(manifest_key, encoded_manifest)

    args.output_directory.mkdir(parents=True, exist_ok=True)
    for name, content in result.artifacts.items():
        path = args.output_directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    persisted_evidence = {
        **result.evidence,
        "manifest_key": manifest_key,
        "observation_archive_key": archive.key,
        "artifact_restore_verified": True,
    }
    rendered = json.dumps(persisted_evidence, indent=2, sort_keys=True) + "\n"
    args.evidence_output.parent.mkdir(parents=True, exist_ok=True)
    args.evidence_output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


def load_phase1_config(path: Path) -> Phase1Config:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("experiment config must be a JSON object")
    raw = cast(dict[str, Any], value)
    training_value = raw.pop("training", None)
    if not isinstance(training_value, dict):
        raise ValueError("experiment training config must be an object")
    patch_sizes = tuple(raw.pop("patch_sizes"))
    volatility_candidates = tuple(raw.pop("volatility_lookback_candidates"))
    seeds = tuple(raw.pop("seeds"))
    return Phase1Config(
        **raw,
        patch_sizes=patch_sizes,
        volatility_lookback_candidates=volatility_candidates,
        seeds=seeds,
        training=TrainingConfig(**training_value),
    )


def _media_type(name: str) -> str:
    if name.endswith(".json"):
        return "application/json"
    if name.endswith(".svg"):
        return "image/svg+xml"
    return "application/octet-stream"


if __name__ == "__main__":
    raise SystemExit(main())
