#!/usr/bin/env python3
"""Read job cards beneath a fleet root and print JSON. No network or state writes."""

import argparse
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
import sys
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def timestamp(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("timestamp must be an ISO string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a UTC offset")
    result = parsed.timestamp()
    if not math.isfinite(result):
        raise ValueError("timestamp must be finite")
    return result


def card_row(card, fallback_id):
    if not isinstance(card, dict):
        raise ValueError("card must be an object")
    steps = card.get("steps", [])
    if not isinstance(steps, list) or any(
        not isinstance(step, dict)
        or not isinstance(step.get("name"), str)
        or not isinstance(step.get("done", False), bool)
        for step in steps
    ):
        raise ValueError("steps must be objects with a name and boolean done")
    for field in ("id", "title", "lane", "status", "session", "blocked_on", "blocker"):
        if card.get(field) is not None and not isinstance(card[field], str):
            raise ValueError("card text fields must be strings")
    return {
        "id": card.get("id") or fallback_id,
        "title": card.get("title", ""),
        "lane": card.get("lane", ""),
        "status": card.get("status", "proposed"),
        "session": card.get("session"),
        "done": sum(step.get("done", False) for step in steps),
        "total": len(steps),
        "next": next((step["name"] for step in steps if not step.get("done", False)), None),
        "blocked_on": card.get("blocked_on") or card.get("blocker"),
        "cost": None,
        "started": timestamp(card.get("started")),
        "updated": timestamp(card.get("updated")),
    }


def build_board(root, zone=None):
    if zone:
        ZoneInfo(zone)  # Validate before a host tries to format it.
    jobs_dir = root / "dispatch" / "jobs"
    if not jobs_dir.is_dir():
        raise ValueError("fleet root must contain dispatch/jobs")
    jobs = []
    ids = set()
    errors = []
    for path in sorted(jobs_dir.glob("*.json")):
        if path.name.startswith("_"):
            continue
        if path.is_symlink():
            errors.append({"chat": path.name, "error": "symbolic card links are not read"})
            continue
        try:
            row = card_row(json.loads(path.read_text(encoding="utf-8")), path.stem)
            if row["id"] in ids:
                raise ValueError("duplicate job id")
            ids.add(row["id"])
            jobs.append(row)
        except (OSError, UnicodeError, ValueError, OverflowError):
            # Do not echo file contents, paths or parser snippets into the pane.
            errors.append({"chat": path.name, "error": "invalid card; check schema and unique id"})
    return {
        "generated": datetime.now(timezone.utc).timestamp(),
        "timezone": zone or None,
        "jobs": jobs,
        "chats": [],
        "prices": {"note": "Cost ledger omitted; missing usage is unknown, not a bill"},
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=os.environ.get("FLEET_ROOT", "~/fleet"))
    parser.add_argument("--timezone", default=os.environ.get("FLEET_TIMEZONE", ""))
    args = parser.parse_args()
    try:
        board = build_board(Path(args.root).expanduser().resolve(), args.timezone)
        json.dump(board, sys.stdout, allow_nan=False)
        print()
    except (OSError, ValueError, ZoneInfoNotFoundError):
        print("fleet-board: root unavailable or invalid time zone", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
