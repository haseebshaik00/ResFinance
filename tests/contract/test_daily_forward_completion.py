from __future__ import annotations

import json
import subprocess
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from scripts.milestone9.dispatch_daily_forward_completion import dispatch_if_due
from scripts.milestone9.install_daily_forward_catchup import launch_agent_definition
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


def test_catchup_does_not_contact_github_before_fixed_pst_due_time() -> None:
    result = dispatch_if_due(now=datetime(2026, 11, 12, 13, 59, tzinfo=UTC))

    assert result.status == "not_due"
    assert result.run_date_pst == date(2026, 11, 12)


def test_catchup_dispatches_only_when_today_has_no_evidence_or_existing_run() -> None:
    captured: list[tuple[str, ...]] = []

    def runner(
        command: tuple[str, ...],
        **_: object,
    ) -> subprocess.CompletedProcess[str]:
        captured.append(command)
        if command[1:4] == ("auth", "status", "--hostname"):
            return subprocess.CompletedProcess(command, 0)
        if "/commits?" in command[-1]:
            return subprocess.CompletedProcess(command, 0, stdout="[]")
        if "/runs?" in command[-1]:
            return subprocess.CompletedProcess(command, 0, stdout='{"workflow_runs": []}')
        return subprocess.CompletedProcess(command, 0)

    result = dispatch_if_due(
        now=datetime(2026, 11, 12, 14, 1, tzinfo=UTC),
        runner=runner,
    )

    assert result.status == "dispatched"
    assert captured[-1] == (
        "gh",
        "workflow",
        "run",
        "crypto-intelligence-forward-completion.yml",
        "--repo",
        "haseebshaik00/ResFinance",
        "--ref",
        "main",
    )


def test_catchup_leaves_a_same_day_active_or_completed_workflow_alone() -> None:
    def runner(
        command: tuple[str, ...],
        **_: object,
    ) -> subprocess.CompletedProcess[str]:
        if command[1:4] == ("auth", "status", "--hostname"):
            return subprocess.CompletedProcess(command, 0)
        if "/commits?" in command[-1]:
            return subprocess.CompletedProcess(command, 0, stdout="[]")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout='{"workflow_runs": [{"created_at": "2026-11-12T14:00:00Z"}]}',
        )

    result = dispatch_if_due(
        now=datetime(2026, 11, 12, 14, 1, tzinfo=UTC),
        runner=runner,
    )

    assert result.status == "workflow_exists"


def test_catchup_agent_runs_at_load_and_checks_while_mac_is_awake(tmp_path: Path) -> None:
    definition = launch_agent_definition(
        repository_root=Path("/work/ResFinance"),
        python_executable=Path("/work/ResFinance/.venv/bin/python"),
        gh_executable=Path("/opt/homebrew/bin/gh"),
        repository="haseebshaik00/ResFinance",
        workflow="crypto-intelligence-forward-completion.yml",
        interval_seconds=300,
        log_directory=tmp_path,
    )

    assert definition["RunAtLoad"] is True
    assert definition["StartInterval"] == 300
    assert definition["WorkingDirectory"] == "/work/ResFinance"
    assert definition["ProgramArguments"] == [
        "/work/ResFinance/.venv/bin/python",
        "-m",
        "scripts.milestone9.dispatch_daily_forward_completion",
        "--repository",
        "haseebshaik00/ResFinance",
        "--workflow",
        "crypto-intelligence-forward-completion.yml",
        "--gh-executable",
        "/opt/homebrew/bin/gh",
    ]
