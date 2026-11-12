from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time

from scripts.milestone9.run_daily_forward_completion import FIXED_PST, current_pst_date

DEFAULT_REPOSITORY = "haseebshaik00/ResFinance"
DEFAULT_WORKFLOW = "crypto-intelligence-forward-completion.yml"
DAILY_RUN_HOUR_PST = 6


@dataclass(frozen=True)
class DispatchResult:
    evidence_path: str
    run_date_pst: date
    status: str


def evidence_path(run_date: date) -> str:
    return f"config/crypto-intelligence/milestone9-forward-completion-{run_date.isoformat()}.json"


def dispatch_if_due(
    *,
    repository: str = DEFAULT_REPOSITORY,
    workflow: str = DEFAULT_WORKFLOW,
    gh_executable: str = "gh",
    now: datetime | None = None,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> DispatchResult:
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        raise ValueError("daily catch-up clock must be timezone-aware")
    run_date = current_pst_date(current)
    path = evidence_path(run_date)
    if current.astimezone(FIXED_PST).time() < time(DAILY_RUN_HOUR_PST):
        return DispatchResult(path, run_date, "not_due")

    _run_gh(runner, gh_executable, "auth", "status", "--hostname", "github.com")
    if _evidence_exists(runner, gh_executable, repository, path):
        return DispatchResult(path, run_date, "evidence_exists")
    if _same_day_run_exists(runner, gh_executable, repository, workflow, run_date):
        return DispatchResult(path, run_date, "workflow_exists")

    _run_gh(
        runner,
        gh_executable,
        "workflow",
        "run",
        workflow,
        "--repo",
        repository,
        "--ref",
        "main",
    )
    return DispatchResult(path, run_date, "dispatched")


def _evidence_exists(
    runner: Callable[..., subprocess.CompletedProcess[str]],
    gh_executable: str,
    repository: str,
    path: str,
) -> bool:
    completed = _run_gh(
        runner,
        gh_executable,
        "api",
        "--method",
        "GET",
        f"repos/{repository}/commits?path={path}&sha=main&per_page=1",
        check=False,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        raise RuntimeError(f"could not check daily evidence on GitHub: {stderr or 'unknown error'}")
    value = _json_list(completed.stdout, "daily evidence")
    return len(value) > 0


def _same_day_run_exists(
    runner: Callable[..., subprocess.CompletedProcess[str]],
    gh_executable: str,
    repository: str,
    workflow: str,
    run_date: date,
) -> bool:
    completed = _run_gh(
        runner,
        gh_executable,
        "api",
        "--method",
        "GET",
        f"repos/{repository}/actions/workflows/{workflow}/runs?branch=main&per_page=100",
    )
    value = _json_object(completed.stdout, "workflow runs")
    runs = value.get("workflow_runs")
    if not isinstance(runs, list):
        raise RuntimeError("GitHub workflow-runs response is missing workflow_runs")
    for item in runs:
        if not isinstance(item, dict):
            continue
        created_at = item.get("created_at")
        if not isinstance(created_at, str):
            continue
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if created.astimezone(FIXED_PST).date() == run_date:
            return True
    return False


def _run_gh(
    runner: Callable[..., subprocess.CompletedProcess[str]],
    gh_executable: str,
    *args: str,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    completed = runner(
        (gh_executable, *args),
        check=False,
        text=True,
        capture_output=True,
    )
    if check and completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        raise RuntimeError(f"GitHub CLI command failed: {stderr or 'unknown error'}")
    return completed


def _json_list(raw: str | None, label: str) -> list[object]:
    try:
        value = json.loads(raw or "")
    except json.JSONDecodeError as error:
        raise RuntimeError(f"GitHub {label} response was not JSON") from error
    if not isinstance(value, list):
        raise RuntimeError(f"GitHub {label} response must be a list")
    return value


def _json_object(raw: str | None, label: str) -> dict[str, object]:
    try:
        value = json.loads(raw or "")
    except json.JSONDecodeError as error:
        raise RuntimeError(f"GitHub {label} response was not JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"GitHub {label} response must be an object")
    return value


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(
        description="Dispatch a missed fixed-PST daily forward-completion workflow exactly once."
    )
    value.add_argument("--repository", default=DEFAULT_REPOSITORY)
    value.add_argument("--workflow", default=DEFAULT_WORKFLOW)
    value.add_argument("--gh-executable", default="gh")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    result = dispatch_if_due(
        repository=args.repository,
        workflow=args.workflow,
        gh_executable=args.gh_executable,
    )
    print(json.dumps(asdict(result), default=str, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
