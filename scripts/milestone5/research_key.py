from __future__ import annotations

import os
import subprocess
from pathlib import Path


def load_research_key(
    *,
    variable: str,
    docker: Path,
    docker_host: str | None,
    container: str,
    path: str,
) -> bytes:
    encoded = os.environ.get(variable)
    if encoded is not None:
        return _decode_key(encoded, variable)
    command = [str(docker)]
    if docker_host:
        command.extend(("--host", docker_host))
    command.extend(("exec", container, "cat", path))
    completed = subprocess.run(command, check=False, capture_output=True)
    if completed.returncode != 0:
        raise RuntimeError("could not read the local research encryption key")
    return _validate_key(completed.stdout, variable)


def _decode_key(value: str, variable: str) -> bytes:
    try:
        return _validate_key(bytes.fromhex(value), variable)
    except ValueError as exc:
        raise ValueError(f"{variable} must contain a 32-byte hexadecimal key") from exc


def _validate_key(value: bytes, variable: str) -> bytes:
    if len(value) != 32:
        raise ValueError(f"{variable} must contain a 32-byte hexadecimal key")
    return value
