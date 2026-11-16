from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path
from typing import cast

import numpy as np
import torch


def run_provenance(root: Path) -> dict[str, object]:
    git_commit = _command(root, "git", "rev-parse", "HEAD") or "unavailable"
    dirty = _command(root, "git", "status", "--porcelain=v1") or ""
    diff = _command(root, "git", "diff", "--binary", "HEAD") or ""
    dependency_file = root / "requirements" / "requirements-ml.txt"
    dependency_content = dependency_file.read_text(encoding="utf-8")
    lock = json.loads((root / "config" / "milestone0-lock.json").read_text(encoding="utf-8"))
    container = cast(dict[str, object], lock["local_container"])
    code_files = sorted(path for path in (root / "ml").rglob("*.py") if path.is_file())
    return {
        "git_commit": git_commit,
        "git_dirty_state_hash": hashlib.sha256((dirty + "\n" + diff).encode()).hexdigest(),
        "code_hash": _files_hash(code_files, root),
        "dependency_lock_hash": hashlib.sha256(dependency_content.encode()).hexdigest(),
        "dependency_lock": [
            line
            for line in dependency_content.splitlines()
            if line and not line.startswith("#")
        ],
        "container_image_digest": container["image_digest"],
        "environment": {
            "python": platform.python_version(),
            "pytorch": torch.__version__,
            "numpy": np.__version__,
            "operating_system": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor() or "unreported",
            "python_executable_sha256": hashlib.sha256(
                Path(sys.executable).read_bytes()
            ).hexdigest(),
            "device": "cpu",
        },
    }


def _files_hash(paths: list[Path], root: Path) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(str(path.relative_to(root)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _command(root: Path, *args: str) -> str | None:
    result = subprocess.run(args, cwd=root, check=False, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None
