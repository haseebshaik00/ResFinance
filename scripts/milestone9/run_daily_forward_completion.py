from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIRECTORY = ROOT / "config" / "crypto-intelligence"
FIXED_PST = timezone(-timedelta(hours=8), name="PST")
FORWARD_MODULE = "scripts.milestone9.run_forward_completion"


@dataclass(frozen=True)
class DailyForwardPlan:
    run_date_pst: date
    cutoff_date: date
    output_path: Path


def current_pst_date(now: datetime | None = None) -> date:
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        raise ValueError("daily automation clock must be timezone-aware")
    return current.astimezone(FIXED_PST).date()


def build_plan(
    *,
    run_date: date | None = None,
    cutoff_date: date | None = None,
    output_directory: Path = OUTPUT_DIRECTORY,
    now: datetime | None = None,
) -> DailyForwardPlan:
    selected_run_date = run_date or current_pst_date(now)
    selected_cutoff = cutoff_date or selected_run_date - timedelta(days=1)
    if selected_cutoff >= selected_run_date:
        raise ValueError("daily cutoff must precede the fixed-PST run date")
    return DailyForwardPlan(
        run_date_pst=selected_run_date,
        cutoff_date=selected_cutoff,
        output_path=(
            output_directory
            / f"milestone9-forward-completion-{selected_run_date.isoformat()}.json"
        ),
    )


def run_daily_forward_completion(
    plan: DailyForwardPlan,
    *,
    python_executable: Path = Path(sys.executable),
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> int:
    plan.output_path.parent.mkdir(parents=True, exist_ok=True)
    command = (
        str(python_executable),
        "-m",
        FORWARD_MODULE,
        "--current-cutoff-date",
        plan.cutoff_date.isoformat(),
        "--output",
        str(plan.output_path),
    )
    completed = runner(command, cwd=ROOT, check=False, text=True)
    if not plan.output_path.is_file():
        raise RuntimeError(
            "forward completion did not write its dated evidence file "
            f"(exit {completed.returncode})"
        )
    evidence = _load_evidence(plan.output_path)
    if evidence.get("current_cutoff_date") != plan.cutoff_date.isoformat():
        raise RuntimeError("forward evidence cutoff does not match the daily plan")
    published = evidence.get("live_forecast_snapshot_published")
    if completed.returncode == 0 and published is not True:
        raise RuntimeError("successful forward completion did not publish a snapshot")
    if completed.returncode == 2 and published is not False:
        raise RuntimeError("rejected forward completion has inconsistent evidence")
    print(
        json.dumps(
            {
                "run_date_pst": plan.run_date_pst.isoformat(),
                "cutoff_date": plan.cutoff_date.isoformat(),
                "output_path": _display_path(plan.output_path),
                "forward_exit_code": completed.returncode,
            },
            sort_keys=True,
        )
    )
    return completed.returncode


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(
        description=(
            "Run the fixed-PST daily Crypto Intelligence forward completion and "
            "write dated, commit-safe evidence under config/crypto-intelligence."
        )
    )
    value.add_argument("--run-date", type=date.fromisoformat)
    value.add_argument("--current-cutoff-date", type=date.fromisoformat)
    value.add_argument("--output-directory", type=Path, default=OUTPUT_DIRECTORY)
    return value


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    plan = build_plan(
        run_date=args.run_date,
        cutoff_date=args.current_cutoff_date,
        output_directory=args.output_directory,
    )
    return run_daily_forward_completion(plan)


def _load_evidence(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError("forward evidence must be a JSON object")
    return value


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main())
