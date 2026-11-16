"""Daily market-only refresh for the active MSPCIFormer/VASA forecast path."""

from __future__ import annotations

import argparse
import json
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

from server.app.application.crypto_ingestion import CryptoIngestionService
from server.app.domain.crypto import CryptoAsset
from server.app.infrastructure.crypto_repository import CryptoResearchRepository
from server.app.infrastructure.provider_adapters import CoinMetricsMarketAdapter
from server.app.infrastructure.resilientdb_cli import DockerResilientDBEventStore

MARKET_HISTORY_START = date(2020, 4, 10)


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(
        description=(
            "Ingest completed BTC/ETH/SOL market observations for inference-only "
            "MSPCIFormer/VASA forecast refreshes."
        )
    )
    value.add_argument("--docker", type=Path, default=Path("docker"))
    value.add_argument("--docker-host")
    value.add_argument("--container", default="resfinance-resdb-tools")
    value.add_argument("--config", default="/config/client.config")
    value.add_argument("--current-cutoff-date", type=date.fromisoformat, required=True)
    value.add_argument("--output", type=Path, required=True)
    return value


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    now = datetime.now(UTC)
    latest_complete = now.date() - timedelta(days=1)
    if args.current_cutoff_date > latest_complete:
        raise ValueError("current cutoff must be a completed UTC market day")
    if args.current_cutoff_date < MARKET_HISTORY_START:
        raise ValueError("current cutoff predates the supported market history")

    store = DockerResilientDBEventStore(
        docker=args.docker,
        docker_host=args.docker_host,
        container=args.container,
        config_path=args.config,
        timeout_seconds=120,
    )
    receipt = CryptoIngestionService(CryptoResearchRepository(store)).ingest_archived(
        CoinMetricsMarketAdapter(),
        assets=tuple(CryptoAsset),
        start_utc=datetime.combine(MARKET_HISTORY_START, time.min, tzinfo=UTC),
        end_utc=datetime.combine(args.current_cutoff_date, time.max, tzinfo=UTC),
        attempt_id=f"crypto-market-refresh-{uuid.uuid4().hex}",
    )
    evidence = {
        "schema_version": 2,
        "completed_at_utc": now.isoformat().replace("+00:00", "Z"),
        "scope": "daily-market-only-refresh-for-mspciformer-vasa-inference",
        "assets": [asset.value for asset in CryptoAsset],
        "current_cutoff_date": args.current_cutoff_date.isoformat(),
        "market_history_start": MARKET_HISTORY_START.isoformat(),
        "provider_receipt": dict(receipt.__dict__),
        "market_data_ingested": True,
        "inference_refresh": "The active Phase 1 checkpoint refreshes on the next forecast read.",
        "execution_mode": "market-ingestion-only",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
