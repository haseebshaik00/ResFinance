from __future__ import annotations

import json
import subprocess
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from scripts.milestone9.run_daily_forward_completion import (
    build_plan,
    current_pst_date,
    run_daily_forward_completion,
)


def test_fixed_pst_date_does_not_shift_with_daylight_saving_time() -> None:
    assert current_pst_date(datetime(2026, 7, 1, 13, 30, tzinfo=UTC)) == date(
        2026, 7, 1
    )
    assert current_pst_date(datetime(2026, 7, 1, 7, 30, tzinfo=UTC)) == date(
        2026, 6, 30
    )


def test_plan_uses_previous_pst_day_and_requested_directory(tmp_path: Path) -> None:
    plan = build_plan(run_date=date(2026, 11, 12), output_directory=tmp_path)

    assert plan.cutoff_date == date(2026, 11, 11)
    assert plan.output_path == (
        tmp_path / "milestone9-forward-completion-2026-11-12.json"
    )


def test_plan_rejects_same_day_or_future_cutoff(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="cutoff must precede"):
        build_plan(
            run_date=date(2026, 11, 12),
            cutoff_date=date(2026, 11, 12),
            output_directory=tmp_path,
        )


@pytest.mark.parametrize(
    ("exit_code", "published"),
    ((0, True), (2, False)),
)
def test_daily_run_preserves_success_and_rejection_evidence(
    tmp_path: Path,
    exit_code: int,
    published: bool,
) -> None:
    plan = build_plan(run_date=date(2026, 11, 12), output_directory=tmp_path)
    captured: tuple[str, ...] | None = None

    def runner(
        command: tuple[str, ...],
        **_: object,
    ) -> subprocess.CompletedProcess[str]:
        nonlocal captured
        captured = command
        plan.output_path.write_text(
            json.dumps(
                {
                    "current_cutoff_date": "2026-11-11",
                    "live_forecast_snapshot_published": published,
                }
            ),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, exit_code)

    result = run_daily_forward_completion(
        plan,
        python_executable=Path("/test/.venv/bin/python"),
        runner=runner,
    )

    assert result == exit_code
    assert captured == (
        "/test/.venv/bin/python",
        "-m",
        "scripts.milestone9.run_forward_completion",
        "--current-cutoff-date",
        "2026-11-11",
        "--output",
        str(plan.output_path),
    )


def test_daily_run_fails_closed_without_evidence(tmp_path: Path) -> None:
    plan = build_plan(run_date=date(2026, 11, 12), output_directory=tmp_path)

    def runner(
        command: tuple[str, ...],
        **_: object,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(command, 1)

    with pytest.raises(RuntimeError, match="did not write"):
        run_daily_forward_completion(plan, runner=runner)
