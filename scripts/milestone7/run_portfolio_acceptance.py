from __future__ import annotations

import argparse
import hashlib
import json
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from server.app.application.finance import FinanceService
from server.app.application.portfolio import PortfolioService
from server.app.domain.crypto import CryptoAsset
from server.app.domain.finance import EntryDirection
from server.app.domain.portfolio import AssetForecast, ForecastSnapshot, PricePoint, RiskAnswers
from server.app.infrastructure.encryption import AesGcmCipher
from server.app.infrastructure.event_repository import EncryptedEventRepository
from server.app.infrastructure.resilientdb_cli import DockerResilientDBEventStore


class AcceptanceForecasts:
    def __init__(self, snapshot: ForecastSnapshot) -> None:
        self._snapshot = snapshot

    def latest_forecast_snapshot(self) -> ForecastSnapshot:
        return self._snapshot


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Verify Milestone 7 risk persistence and portfolio behavior against the real "
            "local ResilientDB stack using a clearly scoped synthetic forecast fixture."
        )
    )
    parser.add_argument("--docker", type=Path, default=Path("docker"))
    parser.add_argument("--docker-host")
    parser.add_argument("--container", default="resfinance-resdb-tools")
    parser.add_argument("--config", default="/config/client.config")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    now = datetime.now(UTC).replace(microsecond=0)
    suffix = uuid.uuid4().hex
    actor = "0x" + hashlib.sha256(suffix.encode()).hexdigest()[:40]
    store = DockerResilientDBEventStore(
        docker=args.docker,
        docker_host=args.docker_host,
        container=args.container,
        config_path=args.config,
        timeout_seconds=60,
    )
    key = hashlib.sha256(b"resfinance-milestone7-local-acceptance-key-v1").digest()
    events = EncryptedEventRepository(
        store,
        AesGcmCipher(key, key_id="milestone7-local-acceptance-v1"),
        clock=lambda: now,
    )
    finance = FinanceService(events)
    finance.create_category(
        actor_address=actor,
        idempotency_key=f"m7-income-category-{suffix}",
        expected_version=0,
        category_id="acceptance-income",
        name="Acceptance income",
        direction=EntryDirection.INCOME,
    )
    finance.record_transaction(
        actor_address=actor,
        idempotency_key=f"m7-income-{suffix}",
        expected_version=1,
        transaction_id=f"acceptance-income-{suffix}",
        direction=EntryDirection.INCOME,
        category_id="acceptance-income",
        amount_minor_units=123_457,
        occurred_on=date(now.year, now.month, 1),
        description="Milestone 7 synthetic acceptance capital",
        recurring_entry_id=None,
    )
    service = PortfolioService(
        events,
        AcceptanceForecasts(_snapshot(now)),
        finance,
        allow_synthetic_acceptance=True,
    )
    risk = service.record_risk_profile(
        actor_address=actor,
        idempotency_key=f"m7-risk-{suffix}",
        expected_version=0,
        answers=RiskAnswers(3, 2, 3),
    )
    duplicate = service.record_risk_profile(
        actor_address=actor,
        idempotency_key=f"m7-risk-{suffix}",
        expected_version=0,
        answers=RiskAnswers(3, 2, 3),
    )
    month = now.strftime("%Y-%m")
    before = finance.overview(actor_address=actor, month=month)
    default = service.overview(actor_address=actor, month=month, now_utc=now)
    if default.recommendation is None:
        raise RuntimeError("default recommendation was not produced")
    scenario = service.analyze_scenario(
        actor_address=actor, amount_minor_units=98_765, now_utc=now
    )
    after = finance.overview(actor_address=actor, month=month)
    normal_runtime = PortfolioService(
        events,
        AcceptanceForecasts(_snapshot(now)),
        finance,
    ).overview(actor_address=actor, month=month, now_utc=now)
    stale_rejected = False
    stale_service = PortfolioService(
        events,
        AcceptanceForecasts(_snapshot(now, expires_at=now - timedelta(seconds=1))),
        finance,
        allow_synthetic_acceptance=True,
    )
    try:
        stale_service.analyze_scenario(
            actor_address=actor, amount_minor_units=10_000, now_utc=now
        )
    except ValueError as exc:
        stale_rejected = "stale" in str(exc)
    default_weights = {item.asset.value: item.weight for item in default.recommendation.allocations}
    evidence = {
        "schema_version": 1,
        "completed_at_utc": now.isoformat().replace("+00:00", "Z"),
        "scope": "local-synthetic-acceptance-on-real-resilientdb",
        "persistent_database": "Apache ResilientDB LevelDB backend",
        "assets": [asset.value for asset in CryptoAsset],
        "risk_policy_version": risk.event.payload["policy_version"],
        "portfolio_policy_version": default.recommendation.policy_version,
        "risk_score": default.recommendation.risk_score,
        "risk_profile_idempotent": duplicate.deduplicated,
        "default_capital_minor_units": default.recommendation.capital_minor_units,
        "default_allocation_minor_units": sum(
            item.amount_minor_units for item in default.recommendation.allocations
        ),
        "default_weights": default_weights,
        "weights_sum_to_one": abs(sum(float(value) for value in default_weights.values()) - 1)
        < 1e-7,
        "caps_respected": all(
            float(item.weight) <= float(item.cap) + 1e-7
            for item in default.recommendation.allocations
        ),
        "solver": default.recommendation.solver,
        "scenario_capital_minor_units": scenario.capital_minor_units,
        "scenario_allocation_minor_units": sum(
            item.amount_minor_units for item in scenario.allocations
        ),
        "scenario_source_kind": scenario.source_kind,
        "scenario_left_finance_unchanged": before == after,
        "savings_calculation_id": default.savings_calculation_id,
        "savings_source_event_ids": list(default.savings_source_event_ids),
        "stale_forecast_rejected": stale_rejected,
        "synthetic_forecast_hidden_from_normal_runtime": (
            normal_runtime.forecast is None and normal_runtime.recommendation is None
        ),
    }
    required = (
        evidence["risk_profile_idempotent"],
        evidence["weights_sum_to_one"],
        evidence["caps_respected"],
        evidence["scenario_left_finance_unchanged"],
        evidence["stale_forecast_rejected"],
        evidence["synthetic_forecast_hidden_from_normal_runtime"],
        evidence["default_capital_minor_units"] == evidence["default_allocation_minor_units"],
        evidence["scenario_capital_minor_units"] == evidence["scenario_allocation_minor_units"],
    )
    if not all(required):
        raise RuntimeError("Milestone 7 acceptance invariant failed")
    rendered = json.dumps(evidence, indent=2, sort_keys=True) + "\n"
    print(rendered, end="")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    return 0


def _snapshot(now: datetime, *, expires_at: datetime | None = None) -> ForecastSnapshot:
    assets: tuple[CryptoAsset, ...] = tuple(CryptoAsset)
    prices: list[PricePoint] = []
    starts = {CryptoAsset.BTC: 60_000, CryptoAsset.ETH: 3_000, CryptoAsset.SOL: 150}
    for offset in range(60):
        observed = now - timedelta(days=60 - offset)
        for asset_index, asset in enumerate(assets):
            price = starts[asset] * (1 + 0.0015 * offset + 0.0002 * asset_index * (offset % 5))
            prices.append(
                PricePoint(
                    asset=asset,
                    observed_at_utc=observed,
                    price_usd=f"{price:.8f}",
                    source_record_id=f"m7-acceptance-{asset.value.lower()}-{offset:03d}",
                )
            )
    forecasts = tuple(
        AssetForecast(
            asset=asset,
            expected_return=value,
            probability_up="0.60",
            p10_return="-0.05",
            p50_return=value,
            p90_return="0.10",
        )
        for asset, value in zip(assets, ("0.04", "0.05", "0.08"), strict=True)
    )
    return ForecastSnapshot(
        as_of_utc=now - timedelta(hours=1),
        expires_at_utc=expires_at or now + timedelta(days=1),
        horizon_days=15,
        run_id="milestone7-synthetic-acceptance",
        model_name="adaptive-gating",
        model_hash=hashlib.sha256(b"milestone7-synthetic-model").hexdigest(),
        dataset_hash=hashlib.sha256(b"milestone7-synthetic-dataset").hexdigest(),
        promotion_event_id=hashlib.sha256(b"milestone7-synthetic-promotion").hexdigest(),
        forecasts=forecasts,
        price_history=tuple(prices),
        scope="local-synthetic-acceptance",
    )


if __name__ == "__main__":
    raise SystemExit(main())
