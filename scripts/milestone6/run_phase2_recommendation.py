from __future__ import annotations

import argparse
import json
import os
from decimal import Decimal
from pathlib import Path

from scripts.milestone9.run_full_research import load_research_key
from server.app.application.phase2_portfolio import (
    Phase2PortfolioService,
    load_phase2_policy,
)
from server.app.infrastructure.blob_repository import EncryptedBlobRepository
from server.app.infrastructure.crypto_repository import CryptoResearchRepository
from server.app.infrastructure.encryption import AesGcmCipher
from server.app.infrastructure.phase1_forecast_repository import Phase1ForecastRepository
from server.app.infrastructure.resilientdb_cli import DockerResilientDBEventStore


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(
        description="Calculate a seven-day research portfolio from verified Phase 1 artifacts."
    )
    value.add_argument("--capital-cents", type=int, default=100_000)
    value.add_argument(
        "--policy-config",
        type=Path,
        default=Path("config/crypto-intelligence/phase2-portfolio-cash-v2.json"),
    )
    value.add_argument("--docker", type=Path, default=Path("docker"))
    value.add_argument("--docker-host")
    value.add_argument("--container", default="resfinance-resdb-tools")
    value.add_argument("--resilientdb-config", default="/config/client.config")
    value.add_argument("--encryption-key-env", default="RESFINANCE_RESEARCH_ENCRYPTION_KEY")
    value.add_argument("--encryption-key-container", default="resfinance-api-1")
    value.add_argument("--encryption-key-path", default="/certs/research-blob.key")
    value.add_argument("--evidence-output", type=Path, required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    if args.capital_cents <= 0:
        raise ValueError("capital cents must be positive")
    store = DockerResilientDBEventStore(
        docker=args.docker,
        docker_host=args.docker_host,
        container=args.container,
        config_path=args.resilientdb_config,
        timeout_seconds=120,
    )
    key = load_research_key(
        variable=args.encryption_key_env,
        docker=args.docker,
        docker_host=args.docker_host,
        container=args.encryption_key_container,
        path=args.encryption_key_path,
    )
    blobs = EncryptedBlobRepository(
        store,
        AesGcmCipher(
            key,
            key_id=(
                "local-research-blob-key-v1"
                if os.environ.get(args.encryption_key_env) is None
                else "local-research-override-portfolio"
            ),
        ),
    )
    repository = Phase1ForecastRepository(
        store,
        blobs,
        CryptoResearchRepository(store),
    )
    service = Phase2PortfolioService(
        repository,
        policy=load_phase2_policy(args.policy_config),
    )
    forecast = service.forecast()
    recommendation = service.recommend(capital_minor_units=args.capital_cents)
    document = {
        "schema_version": 2,
        "scope": "Milestone 6 local non-commercial research recommendation",
        "forecast": {
            "snapshot_id": forecast.snapshot_id,
            "run_id": forecast.run_id,
            "manifest_key": forecast.manifest_key,
            "model_key": forecast.model_key,
            "model_version": forecast.model_version,
            "generated_at_utc": forecast.generated_at_utc.isoformat().replace("+00:00", "Z"),
            "market_data_cutoff_utc": forecast.market_data_cutoff_utc.isoformat().replace(
                "+00:00", "Z"
            ),
            "forecast_dates_utc": [value.isoformat() for value in forecast.forecast_dates_utc],
            "status": forecast.status,
            "stale_reasons": list(forecast.stale_reasons),
            "assets": [
                {
                    "asset": item.asset.value,
                    "current_price": item.current_price,
                    "predicted_prices": list(item.predicted_prices),
                    "predicted_return_7d": item.predicted_return_7d,
                }
                for item in forecast.assets
            ],
        },
        "recommendation": {
            "capital_usd": str(Decimal(args.capital_cents) / Decimal(100)),
            "capital_minor_units": recommendation.capital_minor_units,
            "allocations": [
                {
                    "asset": item.asset.value,
                    "weight": item.weight,
                    "amount_minor_units": item.amount_minor_units,
                }
                for item in recommendation.allocations
            ],
            "cash_reserve": {
                "weight": recommendation.cash_reserve.weight,
                "amount_minor_units": recommendation.cash_reserve.amount_minor_units,
            },
            "predicted_portfolio_return_7d": recommendation.predicted_portfolio_return_7d,
            "estimated_portfolio_volatility_7d": (recommendation.estimated_portfolio_volatility_7d),
            "risk_aversion": recommendation.risk_aversion,
            "covariance_lookback_days": recommendation.covariance_lookback_days,
            "covariance_estimator": recommendation.covariance_estimator,
            "covariance_repaired": recommendation.covariance_repaired,
            "solver": recommendation.solver,
            "solver_status": recommendation.solver_status,
            "policy_version": recommendation.policy_version,
            "warnings": list(recommendation.warnings),
        },
        "trades_executed": False,
    }
    args.evidence_output.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(document, indent=2, sort_keys=True) + "\n"
    args.evidence_output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
