from __future__ import annotations

import argparse
import os
import plistlib
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from scripts.milestone9.dispatch_daily_forward_completion import (
    DEFAULT_REPOSITORY,
    DEFAULT_WORKFLOW,
)

ROOT = Path(__file__).resolve().parents[2]
LABEL = "com.resfinance.daily-forward-catchup"
DEFAULT_INTERVAL_SECONDS = 300


@dataclass(frozen=True)
class CatchupAgent:
    label: str
    plist_path: Path


def launch_agent_definition(
    *,
    repository_root: Path,
    python_executable: Path,
    gh_executable: Path,
    repository: str,
    workflow: str,
    interval_seconds: int,
    log_directory: Path,
) -> dict[str, object]:
    if interval_seconds < 60:
        raise ValueError("catch-up interval must be at least 60 seconds")
    command = [
        str(python_executable),
        "-m",
        "scripts.milestone9.dispatch_daily_forward_completion",
        "--repository",
        repository,
        "--workflow",
        workflow,
        "--gh-executable",
        str(gh_executable),
    ]
    return {
        "Label": LABEL,
        "ProgramArguments": command,
        "WorkingDirectory": str(repository_root),
        "RunAtLoad": True,
        "StartInterval": interval_seconds,
        "ProcessType": "Background",
        "StandardOutPath": str(log_directory / "daily-forward-catchup.log"),
        "StandardErrorPath": str(log_directory / "daily-forward-catchup-error.log"),
    }


def install(
    *,
    repository_root: Path = ROOT,
    python_executable: Path | None = None,
    gh_executable: Path | None = None,
    repository: str = DEFAULT_REPOSITORY,
    workflow: str = DEFAULT_WORKFLOW,
    interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
    home_directory: Path | None = None,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> CatchupAgent:
    if sys.platform != "darwin":
        raise RuntimeError("daily catch-up installation is supported only on macOS")
    home = home_directory or Path.home()
    python = (python_executable or Path(sys.executable)).resolve()
    gh = gh_executable or _required_executable("gh")
    _verify_gh_auth(gh, runner)
    launch_agents = home / "Library" / "LaunchAgents"
    log_directory = home / "Library" / "Logs" / "resfinance"
    launch_agents.mkdir(parents=True, exist_ok=True)
    log_directory.mkdir(parents=True, exist_ok=True)
    plist_path = launch_agents / f"{LABEL}.plist"
    definition = launch_agent_definition(
        repository_root=repository_root.resolve(),
        python_executable=python,
        gh_executable=gh,
        repository=repository,
        workflow=workflow,
        interval_seconds=interval_seconds,
        log_directory=log_directory,
    )
    with plist_path.open("wb") as handle:
        plistlib.dump(definition, handle, sort_keys=False)
    domain = f"gui/{os.getuid()}"
    runner(("launchctl", "bootout", domain, str(plist_path)), check=False)
    completed = runner(
        ("launchctl", "bootstrap", domain, str(plist_path)),
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        raise RuntimeError(f"could not load daily catch-up agent: {stderr or 'unknown error'}")
    return CatchupAgent(LABEL, plist_path)


def _required_executable(name: str) -> Path:
    executable = shutil.which(name)
    if executable is None:
        raise RuntimeError(f"{name} must be installed before enabling daily catch-up")
    return Path(executable).resolve()


def _verify_gh_auth(
    gh_executable: Path,
    runner: Callable[..., subprocess.CompletedProcess[str]],
) -> None:
    completed = runner(
        (str(gh_executable), "auth", "status", "--hostname", "github.com"),
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "GitHub CLI is not authenticated; run `gh auth login --hostname github.com "
            '--web --scopes "repo,workflow"` first.'
        )


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(
        description="Install the macOS login/wake catch-up launcher for daily forward completion."
    )
    value.add_argument("--repository", default=DEFAULT_REPOSITORY)
    value.add_argument("--workflow", default=DEFAULT_WORKFLOW)
    value.add_argument("--interval-seconds", type=int, default=DEFAULT_INTERVAL_SECONDS)
    return value


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    agent = install(
        repository=args.repository,
        workflow=args.workflow,
        interval_seconds=args.interval_seconds,
    )
    print(f"Installed {agent.label}: {agent.plist_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
