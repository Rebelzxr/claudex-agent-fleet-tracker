#!/usr/bin/env python3
"""Read job cards beneath a fleet root and print JSON. No network or state writes.

With --usage (or FLEET_USAGE=1) it also reads token counts from local Claude Code
transcripts for the session ids on the cards. See docs/BOARD.md.
"""

import argparse
import importlib.util
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
    sessions = card.get("sessions", [])
    if not isinstance(sessions, list) or any(not isinstance(item, str) for item in sessions):
        raise ValueError("sessions must be a list of strings")
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


USAGE_OFF = "Usage off: run with --usage or FLEET_USAGE=1 to read local Claude Code transcripts"


def card_sessions(card):
    named = [card.get("session")] + list(card.get("sessions") or [])
    return sorted({item for item in named if item and not item.startswith("<")})


def load_ledger():
    spec = importlib.util.spec_from_file_location("cost_ledger", Path(__file__).with_name("cost_ledger.py"))
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True  # the board stays read-only: no .pyc next to the script
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


def build_board(root, zone=None, usage=None):
    """usage: None for off, else {"projects": Path, "prices": Path}."""
    if zone:
        ZoneInfo(zone)  # Validate before a host tries to format it.
    jobs_dir = root / "dispatch" / "jobs"
    if not jobs_dir.is_dir():
        raise ValueError("fleet root must contain dispatch/jobs")
    jobs = []
    ids = set()
    errors = []
    sessions = {}
    for path in sorted(jobs_dir.glob("*.json")):
        if path.name.startswith("_"):
            continue
        if path.is_symlink():
            errors.append({"chat": path.name, "error": "symbolic card links are not read"})
            continue
        try:
            card = json.loads(path.read_text(encoding="utf-8"))
            row = card_row(card, path.stem)
            if row["id"] in ids:
                raise ValueError("duplicate job id")
            ids.add(row["id"])
            jobs.append(row)
            sessions[row["id"]] = card_sessions(card)
        except (OSError, UnicodeError, ValueError, OverflowError):
            # Do not echo file contents, paths or parser snippets into the pane.
            errors.append({"chat": path.name, "error": "invalid card; check schema and unique id"})
    board = {
        "generated": datetime.now(timezone.utc).timestamp(),
        "timezone": zone or None,
        "jobs": jobs,
        "chats": [],
        "prices": {"note": USAGE_OFF},
        "usage": {"enabled": False, "status": "off", "reason": USAGE_OFF},
        "errors": errors,
    }
    if usage is not None:
        add_usage(board, sessions, usage)
    return board


def add_usage(board, sessions, usage):
    """Fill costs from transcripts. Any failure leaves costs null with a reason, never a fake zero."""
    try:
        ledger = load_ledger()
        prices = ledger.load_prices(usage["prices"])
        job_costs, chats, report = ledger.usage(sessions, usage["projects"], prices)
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        board["usage"] = {"enabled": True, "status": "error",
                          "reason": "usage could not be read; costs left unknown"}
        board["prices"] = {"note": "Usage on, but it could not be read; costs are unknown, not zero"}
        return
    for row in board["jobs"]:
        row["cost"] = job_costs.get(row["id"])
    board["chats"] = chats
    board["usage"] = report
    note = ("API-equivalent dollars at public list prices, not a bill. "
            "Claude tokens from local transcripts; Codex not counted")
    if report.get("reason"):
        note = f"{report['reason']}. {note}"
    board["prices"] = {"as_of": prices.get("as_of"), "sources": prices.get("sources"), "note": note}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=os.environ.get("FLEET_ROOT", "~/fleet"))
    parser.add_argument("--timezone", default=os.environ.get("FLEET_TIMEZONE", ""))
    parser.add_argument("--usage", action="store_true",
                        default=os.environ.get("FLEET_USAGE", "").lower() in ("1", "true", "yes"),
                        help="read token counts from local Claude Code transcripts")
    parser.add_argument("--claude-dir", default=os.environ.get("FLEET_CLAUDE_PROJECTS", "~/.claude/projects"))
    parser.add_argument("--prices", default=os.environ.get("FLEET_PRICES", str(Path(__file__).with_name("usage_prices.json"))))
    args = parser.parse_args()
    usage = None
    if args.usage:
        usage = {"projects": Path(args.claude_dir).expanduser(), "prices": Path(args.prices).expanduser()}
    try:
        board = build_board(Path(args.root).expanduser().resolve(), args.timezone, usage)
        json.dump(board, sys.stdout, allow_nan=False)
        print()
    except (OSError, ValueError, ZoneInfoNotFoundError):
        print("fleet-board: root unavailable or invalid time zone", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
