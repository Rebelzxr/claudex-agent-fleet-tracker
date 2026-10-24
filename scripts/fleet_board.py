#!/usr/bin/env python3
"""Read job cards beneath a fleet root and print JSON. No network or state writes.

With --usage (or FLEET_USAGE=1) it also reads token counts from local Claude Code
transcripts for the session ids on the cards, and from recent local Codex session
logs (skip them with --no-codex). See docs/BOARD.md.
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


USAGE_OFF = "Usage off: run with --usage or FLEET_USAGE=1 to read local Claude Code and Codex logs"


def card_sessions(card):
    named = [card.get("session")] + list(card.get("sessions") or [])
    return sorted({item for item in named if item and not item.startswith("<")})


def card_folders(card, root):
    """Absolute scope folders of a card, with <FLEET_ROOT> filled in; used only to tie Codex runs."""
    found = []
    for item in card.get("scope") or []:
        if not isinstance(item, str):
            continue
        path = Path(item.replace("<FLEET_ROOT>", str(root))).expanduser()
        if path.is_absolute():
            found.append(path.resolve())
    return found


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
    """usage: None for off, else {"projects": Path, "prices": Path, "codex": Path or None, "codex_days": int}."""
    if zone:
        ZoneInfo(zone)  # Validate before a host tries to format it.
    jobs_dir = root / "dispatch" / "jobs"
    if not jobs_dir.is_dir():
        raise ValueError("fleet root must contain dispatch/jobs")
    jobs = []
    ids = set()
    errors = []
    sessions, folders = {}, {}
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
            folders[row["id"]] = card_folders(card, root)
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
        add_usage(board, sessions, usage, folders)
    return board


def add_usage(board, sessions, usage, folders=None):
    """Fill costs from transcripts. Any failure leaves costs null with a reason, never a fake zero."""
    try:
        ledger = load_ledger()
        prices = ledger.load_prices(usage["prices"])
        job_costs, chats, report = ledger.usage(sessions, usage["projects"], prices)
        codex = None
        if usage.get("codex"):
            per_job, unattributed, codex = ledger.codex_usage(
                sorted(sessions), folders or {}, usage["codex"], usage.get("codex_days", 30))
            ledger.add_codex(job_costs, per_job)
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        board["usage"] = {"enabled": True, "status": "error",
                          "reason": "usage could not be read; costs left unknown"}
        board["prices"] = {"note": "Usage on, but it could not be read; costs are unknown, not zero"}
        return
    for row in board["jobs"]:
        row["cost"] = job_costs.get(row["id"])
    board["chats"] = chats
    board["usage"] = report
    note = "API-equivalent dollars at public list prices, not a bill. Claude tokens from local transcripts; "
    if codex is None:
        note += "Codex not counted"
    else:
        board["codex_unattributed"] = unattributed
        report["codex"] = codex
        note += "Codex tokens from local session logs, not priced"
    reasons = [r for r in (report.get("reason"), (codex or {}).get("reason")) if r]
    if reasons:
        note = f"{'. '.join(reasons)}. {note}"
    board["prices"] = {"as_of": prices.get("as_of"), "sources": prices.get("sources"), "note": note}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=os.environ.get("FLEET_ROOT", "~/fleet"))
    parser.add_argument("--timezone", default=os.environ.get("FLEET_TIMEZONE", ""))
    parser.add_argument("--usage", action="store_true",
                        default=os.environ.get("FLEET_USAGE", "").lower() in ("1", "true", "yes"),
                        help="read token counts from local Claude Code transcripts")
    parser.add_argument("--claude-dir", default=os.environ.get("FLEET_CLAUDE_PROJECTS", "~/.claude/projects"))
    parser.add_argument("--codex-dir", default=os.environ.get("FLEET_CODEX_HOME", "~/.codex"),
                        help="Codex home with sessions/ (read only with --usage)")
    parser.add_argument("--no-codex", action="store_true",
                        default=os.environ.get("FLEET_CODEX", "").lower() in ("0", "false", "no"),
                        help="skip Codex session logs")
    parser.add_argument("--codex-days", type=int, default=int(os.environ.get("FLEET_CODEX_DAYS") or 30),
                        help="read Codex logs changed in this many days (default 30)")
    parser.add_argument("--prices", default=os.environ.get("FLEET_PRICES", str(Path(__file__).with_name("usage_prices.json"))))
    args = parser.parse_args()
    usage = None
    if args.usage:
        usage = {"projects": Path(args.claude_dir).expanduser(), "prices": Path(args.prices).expanduser(),
                 "codex": None if args.no_codex else Path(args.codex_dir).expanduser(),
                 "codex_days": max(1, args.codex_days)}
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
