from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime

from server.app.main import services_from_environment


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile a local group from ResContract")
    parser.add_argument("--group-id", required=True)
    args = parser.parse_args()
    _, _, groups, _, _, _ = services_from_environment()
    if groups is None:
        raise RuntimeError("group reconciliation services are not configured")
    results = groups.reconcile_group(args.group_id)
    print(
        json.dumps(
            {
                "schema_version": 1,
                "job": "group-reconciliation",
                "group_id": args.group_id,
                "completed_at_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "appended_event_ids": [item.event.event_id for item in results],
                "appended_count": len(results),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
