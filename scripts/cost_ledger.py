"""Opt-in token usage for job cards, read from local Claude Code and Codex logs.

Claude: only the sessions named on job cards are read: <projects>/*/<session>.jsonl
and <projects>/*/<session>/subagents/*.jsonl.
Codex: session logs under <codex home>/sessions and archived_sessions changed in
the last few days. A turn counts toward a job when its prompt names exactly one
card id, else when it ran inside exactly one card's scope folder.
Only numbers are kept (token counts, model names, timestamps, an optional chat
title). Prompt, reply and tool text never leaves this module. No network, no writes.
"""

import json
import re
from datetime import datetime
from pathlib import Path

SESSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
DATE_SUFFIX = re.compile(r"-\d{8}$")
COUNTERS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
PRICE_FIELDS = ("input", "output", "cache_read", "cache_write_5m", "cache_write_1h")
GAP = 600  # seconds between replies; a longer pause counts as idle, not work time


def load_prices(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("claude"), dict):
        raise ValueError("price file needs a claude table")
    for price in data["claude"].values():
        _check_price(price)
        if "long_context" in price:
            _check_price(price["long_context"])
            _count(price["long_context"].get("above_prompt_tokens"))
    return data


def _check_price(price):
    if not isinstance(price, dict):
        raise ValueError("each model price must be a table")
    for name in PRICE_FIELDS:
        if price.get(name) is None:
            raise ValueError("model price is missing a rate")
        _count(price[name])


def price_for(prices, model):
    table = prices.get("claude") or {}
    return table.get(model) or table.get(DATE_SUFFIX.sub("", model or ""))


def reply_usd(price, reply):
    """API-equivalent dollars for one reply, or None when the model has no list price."""
    if not price:
        return None
    long_context = price.get("long_context")
    prompt = reply["input"] + reply["cache_read"] + reply["cache_write_5m"] + reply["cache_write_1h"]
    if long_context and prompt > long_context["above_prompt_tokens"]:
        price = long_context
    return (reply["input"] * price["input"] + reply["output"] * price["output"]
            + reply["cache_read"] * price["cache_read"]
            + reply["cache_write_5m"] * price["cache_write_5m"]
            + reply["cache_write_1h"] * price["cache_write_1h"]) / 1e6


def blank():
    return {
        "claude": {},
        "codex": {"runs": 0, "input": 0, "cached": 0, "output": 0, "reasoning": 0, "total": 0},
        "voice_chars": 0, "active_s": 0.0, "span": [None, None], "usd": 0.0, "unpriced": 0,
        "output_estimated": 0,
    }


def add_bucket(into, other):
    for model, tokens in other["claude"].items():
        row = into["claude"].setdefault(model, dict.fromkeys(tokens, 0))
        for key, value in tokens.items():
            row[key] += value
    into["active_s"] += other["active_s"]
    into["usd"] += other["usd"]
    into["unpriced"] += other["unpriced"]
    starts = [s for s in (into["span"][0], other["span"][0]) if s is not None]
    ends = [s for s in (into["span"][1], other["span"][1]) if s is not None]
    into["span"] = [min(starts) if starts else None, max(ends) if ends else None]


def _count(value):
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or value < 0 or value == float("inf"):
        raise ValueError("bad usage counter")
    return int(value)


def _timestamp(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def session_files(projects, session):
    """Main transcript plus helper transcripts for one session id; symbolic links are skipped."""
    if not SESSION_RE.fullmatch(session):
        return []
    found = []
    for project in sorted(p for p in projects.iterdir() if p.is_dir() and not p.is_symlink()):
        main = project / f"{session}.jsonl"
        if main.is_file() and not main.is_symlink():
            found.append(main)
        folder = project / session
        helpers = folder / "subagents"
        if folder.is_dir() and not folder.is_symlink() and helpers.is_dir() and not helpers.is_symlink():
            found.extend(p for p in sorted(helpers.glob("*.jsonl")) if p.is_file() and not p.is_symlink())
    return found


def read_session(files):
    """Replies keyed by message id. A reply streamed over several lines keeps each counter's maximum."""
    replies, title, bad = {}, None, 0
    for path in files:
        try:
            handle = open(path, "rb")
        except OSError:
            bad += 1  # an unreadable file makes the total partial, not unknown
            continue
        with handle:
            for raw in handle:
                line = raw.decode("utf-8", "ignore")
                if '"custom-title"' in line[:200]:
                    try:
                        record = json.loads(line)
                        if record.get("type") == "custom-title" and isinstance(record.get("customTitle"), str):
                            title = record["customTitle"][:80]
                    except (ValueError, AttributeError):
                        bad += 1
                    continue
                if '"usage"' not in line or '"assistant"' not in line:
                    continue
                try:
                    record = json.loads(line)
                    if record.get("type") != "assistant":
                        continue
                    message = record.get("message") or {}
                    usage = message.get("usage")
                    if not isinstance(usage, dict):
                        continue
                    split = usage.get("cache_creation") or {}
                    if (all(usage.get(name) is None for name in COUNTERS)
                            and split.get("ephemeral_1h_input_tokens") is None):
                        continue
                    model = message.get("model")
                    key = message.get("id")
                    if not isinstance(key, str) or not isinstance(model, str) or model == "<synthetic>":
                        continue
                    nums = {name: _count(usage.get(name)) for name in COUNTERS}
                    write_1h = _count(split.get("ephemeral_1h_input_tokens"))
                except (ValueError, AttributeError, TypeError):
                    bad += 1
                    continue
                reply = {
                    "model": model, "at": _timestamp(record.get("timestamp")),
                    "input": nums["input_tokens"], "output": nums["output_tokens"],
                    "cache_read": nums["cache_read_input_tokens"],
                    "cache_write": nums["cache_creation_input_tokens"], "cache_write_1h": write_1h,
                }
                old = replies.get(key)
                if old is None:
                    replies[key] = reply
                else:
                    for name in ("input", "output", "cache_read", "cache_write", "cache_write_1h"):
                        old[name] = max(old[name], reply[name])
                    if old["at"] is None:
                        old["at"] = reply["at"]
    # Split cache writes only after the streamed maxima, so a later line that moves
    # tokens into the 1h bucket cannot leave them counted in 5m as well.
    for reply in replies.values():
        reply["cache_write_1h"] = min(reply["cache_write_1h"], reply["cache_write"])
        reply["cache_write_5m"] = reply.pop("cache_write") - reply["cache_write_1h"]
    return replies, title, bad


def session_bucket(replies, prices):
    bucket = blank()
    times = sorted(r["at"] for r in replies.values() if r["at"] is not None)
    if times:
        bucket["span"] = [times[0], times[-1]]
        bucket["active_s"] = float(sum(b - a for a, b in zip(times, times[1:]) if b - a <= GAP))
    for reply in replies.values():
        row = bucket["claude"].setdefault(reply["model"], {
            "input": 0, "output": 0, "output_exact": 0, "cache_read": 0,
            "cache_write_5m": 0, "cache_write_1h": 0, "replies": 0,
        })
        for name in ("input", "output", "cache_read", "cache_write_5m", "cache_write_1h"):
            row[name] += reply[name]
        row["output_exact"] += reply["output"]  # logged counts only; nothing here is estimated
        row["replies"] += 1
        usd = reply_usd(price_for(prices, reply["model"]), reply)
        if usd is None:
            bucket["unpriced"] += 1
        else:
            bucket["usd"] += usd
    return bucket


def usage(job_sessions, projects, prices):
    """Fill job costs and chat rows from the sessions each card names.

    job_sessions maps job id -> list of session ids. A session named by exactly one
    card counts toward that job. A session named by several cards is not split; it
    shows on its chat row as coordination and on no job.
    """
    owners = {}
    for job, sessions in job_sessions.items():
        for session in sessions:
            owners.setdefault(session, set()).add(job)
    report = {"enabled": True, "status": "ok", "sessions_named": len(owners), "sessions_found": 0,
              "sessions_missing": 0, "sessions_empty": 0, "shared_sessions": 0, "unreadable_lines": 0}
    projects = projects.expanduser().resolve()  # the folder the person chose; links inside it are skipped
    if not projects.is_dir():
        report.update(status="no_transcripts", reason=f"no Claude Code transcripts found at {_short(projects)}")
        return {}, [], report
    chats, job_costs = [], {}
    for session in sorted(owners):
        files = session_files(projects, session)
        if not files:
            report["sessions_missing"] += 1
            continue
        replies, title, bad = read_session(files)
        report["sessions_found"] += 1
        report["unreadable_lines"] += bad
        if not replies:
            report["sessions_empty"] += 1  # a transcript with no usage records is unknown, not free
            continue
        total = session_bucket(replies, prices)
        jobs = sorted(owners[session])
        chat = {"id": session, "title": title or "", "total": total, "coordination": blank(),
                "jobs_usd": 0.0, "jobs": jobs, "has_cost_state": True}
        if len(jobs) == 1:
            cost = job_costs.setdefault(jobs[0], {"total": blank(), "phases": [], "chats": []})
            add_bucket(cost["total"], total)
            cost["chats"].append(session)
            chat["jobs_usd"] = total["usd"]
        else:
            report["shared_sessions"] += 1
            chat["coordination"] = total
        chats.append(chat)
    if owners and not report["sessions_found"]:
        report.update(status="no_matching_sessions",
                      reason=f"no transcript matches a card's session id under {_short(projects)}")
    elif not owners:
        report.update(status="no_sessions_on_cards", reason="no job card has a session id yet")
    elif report["sessions_missing"] or report["sessions_empty"] or report["unreadable_lines"]:
        report.update(status="partial", reason="usage is incomplete: some named sessions or usage "
                      "records could not be read, so totals cover only what was read")
    chats.sort(key=lambda c: -c["total"]["usd"])
    return job_costs, chats, report


# ---------------------------------------------------------------- Codex

CODEX_FIELDS = ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens")
CODEX_KEYS = (b'"session_meta"', b'"task_started"', b'"token_count"', b'"input_text"')


def codex_blank():
    return {"runs": 0, "input": 0, "cached": 0, "output": 0, "reasoning": 0, "total": 0,
            "total_upper": 0, "drops": 0}


def codex_files(home, days, now):
    """Codex session logs changed within `days`, newest first; links are skipped."""
    found = []
    for folder in (home / "sessions", home / "archived_sessions"):
        if not folder.is_dir() or folder.is_symlink():
            continue
        for path in folder.rglob("*.jsonl"):
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                if now - path.stat().st_mtime <= days * 86400:
                    found.append(path)
            except OSError:
                continue
    return sorted(found)


def read_codex(path, job_ids):
    """Turns of one Codex log: token deltas, time span and the card ids its prompts name."""
    turns, cwd, bad = [], None, 0
    high, prev, drops = [0] * 5, [0] * 5, 0

    def turn(at):
        turns.append({"t0": at, "t1": at, "named": set(), "tokens": [0] * 5, "upper": 0})
        return turns[-1]

    def open_turn(at):
        # A prompt and its task_started event can come in either order. Both belong to
        # the latest turn until that turn has used tokens; after that, a new turn starts.
        if turns and not any(turns[-1]["tokens"]) and not turns[-1]["upper"]:
            return turns[-1]
        return turn(at)

    with open(path, "rb") as handle:
        for raw in handle:
            if not any(key in raw for key in CODEX_KEYS):
                continue
            try:
                record = json.loads(raw.decode("utf-8", "ignore"))
                kind, payload = record.get("type"), record.get("payload")
                if not isinstance(payload, dict):
                    continue
                inner, at = payload.get("type"), _timestamp(record.get("timestamp"))
                if kind == "session_meta":
                    cwd = cwd or payload.get("cwd")
                elif kind == "event_msg" and inner == "task_started":
                    open_turn(at)
                elif kind == "event_msg" and inner == "token_count":
                    info = payload.get("info")
                    total = info.get("total_token_usage") if isinstance(info, dict) else None
                    if not isinstance(total, dict) or not total:
                        continue
                    now = [_count(total.get(name)) for name in CODEX_FIELDS]
                    current = turns[-1] if turns else turn(at)
                    # Totals are cumulative for the log. Count the rise above the highest
                    # reading; if the counter fell (a possible reset), keep an upper bound too.
                    base = prev
                    if now[4] < prev[4]:
                        drops += 1
                        base = [0] * 5
                    for i in range(5):
                        current["tokens"][i] += max(0, now[i] - high[i])
                    current["upper"] += max(0, now[4] - base[4])
                    current["t1"] = at or current["t1"]
                    high = [max(a, b) for a, b in zip(high, now)]
                    prev = now
                elif kind == "response_item" and inner == "message" and payload.get("role") == "user":
                    content = payload.get("content") if isinstance(payload.get("content"), list) else []
                    text = " ".join(str(part.get("text", "")) for part in content if isinstance(part, dict))[:4000]
                    if not text.lstrip().startswith("<"):
                        open_turn(at)["named"] |= {job for job in job_ids if _names(text, job)}
            except (ValueError, AttributeError, TypeError):
                bad += 1
    return turns, cwd, drops, bad


def _names(text, job):
    return re.search(r"(?<![\w-])" + re.escape(job) + r"(?![\w-])", text) is not None


def _folder_job(cwd, job_folders):
    if not isinstance(cwd, str) or not cwd:
        return None
    try:
        where = Path(cwd).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    hits = {job for job, folders in job_folders.items()
            for folder in folders if where == folder or folder in where.parents}
    return hits.pop() if len(hits) == 1 else None


def codex_usage(job_ids, job_folders, home, days=30, now=None):
    """Codex tokens per job, the turns tied to no job, and a short report. Codex is not priced."""
    now = now if now is not None else datetime.now().timestamp()
    report = {"status": "ok", "files": 0, "runs": 0, "unreadable_lines": 0, "days": days}
    unattributed = {"runs": 0, "total": 0, "total_upper": 0, "several_jobs": 0}
    home = home.expanduser().resolve()
    if not (home / "sessions").is_dir() and not (home / "archived_sessions").is_dir():
        report.update(status="no_logs", reason=f"no Codex session logs found at {_short(home)}")
        return {}, unattributed, report
    per_job = {}
    for path in codex_files(home, days, now):
        try:
            turns, cwd, drops, bad = read_codex(path, job_ids)
        except OSError:
            report["unreadable_lines"] += 1
            continue
        report["files"] += 1
        report["unreadable_lines"] += bad
        fallback = _folder_job(cwd, job_folders)
        flagged = set()
        for item in turns:
            total = item["tokens"][4]
            if not total and not item["upper"]:
                continue
            report["runs"] += 1
            named = item["named"]
            job = next(iter(named)) if len(named) == 1 else (fallback if not named else None)
            if not job:
                unattributed["runs"] += 1
                unattributed["total"] += total
                unattributed["total_upper"] += item["upper"]
                unattributed["several_jobs"] += 1 if len(named) > 1 else 0
                continue
            bucket = per_job.setdefault(job, {"codex": codex_blank(), "active_s": 0.0, "span": [None, None]})
            codex = bucket["codex"]
            codex["runs"] += 1
            for key, value in zip(("input", "cached", "output", "reasoning", "total"), item["tokens"]):
                codex[key] += value
            codex["total_upper"] += item["upper"]
            if drops and job not in flagged:
                codex["drops"] += drops
                flagged.add(job)
            if item["t0"] is not None and item["t1"] is not None:
                bucket["active_s"] += max(0.0, item["t1"] - item["t0"])
                starts = [s for s in (bucket["span"][0], item["t0"]) if s is not None]
                ends = [s for s in (bucket["span"][1], item["t1"]) if s is not None]
                bucket["span"] = [min(starts), max(ends)]
    if not report["files"]:
        report.update(status="no_recent_logs", reason=f"no Codex session log changed in the last {days} days")
    elif report["unreadable_lines"]:
        report.update(status="partial", reason="some Codex log lines could not be read")
    return per_job, unattributed, report


def add_codex(job_costs, per_job):
    """Merge Codex buckets into job costs; a job seen only in Codex gets a cost with no Claude part."""
    for job, part in per_job.items():
        cost = job_costs.setdefault(job, {"total": blank(), "phases": [], "chats": []})
        total = cost["total"]
        total["codex"] = {**codex_blank(), **total["codex"]}
        for key, value in part["codex"].items():
            total["codex"][key] += value
        total["active_s"] += part["active_s"]
        starts = [s for s in (total["span"][0], part["span"][0]) if s is not None]
        ends = [s for s in (total["span"][1], part["span"][1]) if s is not None]
        total["span"] = [min(starts) if starts else None, max(ends) if ends else None]
        if "Codex" not in cost["chats"]:
            cost["chats"].append("Codex")


def _short(path):
    home = Path.home()
    try:
        return "~/" + str(path.relative_to(home))
    except ValueError:
        return "the folder set by --claude-dir or FLEET_CLAUDE_PROJECTS"
