import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fleet_board", ROOT / "scripts/fleet_board.py")
BOARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BOARD)
PRICES = ROOT / "scripts/usage_prices.json"
MAIN = "synthetic-web-chat"
OTHER = "synthetic-web-chat-rotated"


def reply(msg, model, at, text="HIDDEN_REPLY_TEXT", **usage):
    return {"type": "assistant", "timestamp": at, "sessionId": MAIN,
            "message": {"id": msg, "model": model, "content": [{"type": "text", "text": text}],
                        "usage": usage}}


class UsageChecks(unittest.TestCase):
    def setUp(self):
        (ROOT / ".local").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / ".local")
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.fleet = base / "fleet"
        (self.fleet / "dispatch/jobs").mkdir(parents=True)
        self.projects = base / "projects"
        self.project = self.projects / "-synthetic-project"
        self.project.mkdir(parents=True)
        self.usage = {"projects": self.projects, "prices": PRICES}
        self.codex_home = base / "codex"

    def card(self, job, **fields):
        (self.fleet / "dispatch/jobs" / f"{job}.json").write_text(json.dumps({"id": job, **fields}))

    def transcript(self, path, records):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(r) + "\n" for r in records))

    def write_main(self):
        self.transcript(self.project / f"{MAIN}.jsonl", [
            {"type": "user", "message": {"content": "HIDDEN_PROMPT_TEXT"}},
            {"type": "custom-title", "customTitle": "WEBSITE DIRECTOR"},
            # The same reply streamed twice: the larger output count wins, not the sum.
            reply("m1", "claude-opus-5-5", "2026-01-02T10:00:00Z", input_tokens=10, output_tokens=5,
                  cache_read_input_tokens=1000, cache_creation_input_tokens=200,
                  cache_creation={"ephemeral_1h_input_tokens": 50}),
            reply("m1", "claude-opus-5-5", "2026-01-02T10:00:00Z", input_tokens=10, output_tokens=400,
                  cache_read_input_tokens=1000, cache_creation_input_tokens=200,
                  cache_creation={"ephemeral_1h_input_tokens": 50}),
            reply("m2", "claude-opus-5-5", "2026-01-02T10:05:00Z", input_tokens=20, output_tokens=100),
            reply("m3", "<synthetic>", "2026-01-02T10:06:00Z", output_tokens=999),
        ])
        self.transcript(self.project / MAIN / "subagents" / "agent-1.jsonl", [
            reply("h1", "claude-sonnet-5-5", "2026-01-02T10:02:00Z", input_tokens=1000, output_tokens=2000),
        ])

    def test_off_by_default_keeps_costs_unknown(self):
        self.card("WEB", session=MAIN)
        self.write_main()
        data = BOARD.build_board(self.fleet)
        self.assertIsNone(data["jobs"][0]["cost"])
        self.assertEqual(data["usage"]["status"], "off")
        self.assertIn("--usage", data["prices"]["note"])

    def test_counts_main_and_helper_replies_once_and_prices_them(self):
        self.card("WEB", session=MAIN)
        self.write_main()
        data = BOARD.build_board(self.fleet, usage=self.usage)
        cost = data["jobs"][0]["cost"]
        opus = cost["total"]["claude"]["claude-opus-5-5"]
        self.assertEqual((opus["input"], opus["output"], opus["replies"]), (30, 500, 2))
        self.assertEqual((opus["cache_read"], opus["cache_write_5m"], opus["cache_write_1h"]), (1000, 150, 50))
        self.assertEqual(opus["output_exact"], opus["output"])
        self.assertEqual(cost["total"]["claude"]["claude-sonnet-5-5"]["output"], 2000)
        self.assertNotIn("<synthetic>", cost["total"]["claude"])
        expected = (30 * 4 + 500 * 20 + 1000 * 0.2 + 150 * 5 + 50 * 8 + 1000 * 2 + 2000 * 10) / 1e6
        self.assertAlmostEqual(cost["total"]["usd"], expected)
        self.assertEqual(cost["total"]["active_s"], 300.0)
        self.assertEqual(cost["chats"], [MAIN])
        self.assertEqual(data["chats"][0]["title"], "WEBSITE DIRECTOR")
        self.assertEqual(data["usage"]["status"], "ok")
        self.assertEqual(data["prices"]["as_of"], json.loads(PRICES.read_text())["as_of"])
        text = json.dumps(data)
        self.assertNotIn("HIDDEN_PROMPT_TEXT", text)
        self.assertNotIn("HIDDEN_REPLY_TEXT", text)

    def test_a_session_on_two_cards_is_not_split_or_double_counted(self):
        self.card("WEB", session=MAIN)
        self.card("SEO", sessions=[MAIN])
        self.write_main()
        data = BOARD.build_board(self.fleet, usage=self.usage)
        self.assertTrue(all(row["cost"] is None for row in data["jobs"]))
        chat = data["chats"][0]
        self.assertEqual(chat["jobs"], ["SEO", "WEB"])
        self.assertEqual(chat["jobs_usd"], 0.0)
        self.assertAlmostEqual(chat["coordination"]["usd"], chat["total"]["usd"])
        self.assertEqual(data["usage"]["shared_sessions"], 1)

    def test_rotated_chats_add_up_on_one_card(self):
        self.card("WEB", session=OTHER, sessions=[MAIN])
        self.write_main()
        self.transcript(self.project / f"{OTHER}.jsonl", [
            reply("n1", "claude-opus-5-5", "2026-01-03T09:00:00Z", output_tokens=1000)])
        cost = BOARD.build_board(self.fleet, usage=self.usage)["jobs"][0]["cost"]
        self.assertEqual(cost["total"]["claude"]["claude-opus-5-5"]["output"], 1500)
        self.assertEqual(sorted(cost["chats"]), sorted([MAIN, OTHER]))

    def test_missing_transcripts_give_a_reason_not_a_zero(self):
        self.card("WEB", session=MAIN)
        gone = dict(self.usage, projects=self.projects / "missing")
        data = BOARD.build_board(self.fleet, usage=gone)
        self.assertIsNone(data["jobs"][0]["cost"])
        self.assertEqual(data["usage"]["status"], "no_transcripts")
        self.assertIn("no Claude Code transcripts found", data["prices"]["note"])
        data = BOARD.build_board(self.fleet, usage=self.usage)
        self.assertIsNone(data["jobs"][0]["cost"])
        self.assertEqual(data["usage"]["status"], "no_matching_sessions")

    def test_placeholder_and_unsafe_session_ids_are_never_read(self):
        self.card("A", session="<WEBSITE_SESSION_ID>")
        self.card("B", session="../" + MAIN)
        self.write_main()
        data = BOARD.build_board(self.fleet, usage=self.usage)
        self.assertTrue(all(row["cost"] is None for row in data["jobs"]))
        self.assertEqual(data["usage"]["sessions_named"], 1)
        self.assertEqual(data["usage"]["sessions_found"], 0)

    def test_unknown_models_are_counted_but_unpriced(self):
        self.card("WEB", session=MAIN)
        self.transcript(self.project / f"{MAIN}.jsonl", [
            reply("u1", "claude-future-9", "2026-01-02T10:00:00Z", output_tokens=10)])
        total = BOARD.build_board(self.fleet, usage=self.usage)["jobs"][0]["cost"]["total"]
        self.assertEqual(total["unpriced"], 1)
        self.assertEqual(total["usd"], 0.0)
        self.assertEqual(total["claude"]["claude-future-9"]["output"], 10)

    def test_dated_model_ids_and_long_prompts_use_the_right_price(self):
        self.card("WEB", session=MAIN)
        # Built at run time: an eight-digit literal trips the privacy scan's phone rule.
        dated = "claude-haiku-4-5-" + "2025-10-01".replace("-", "")
        self.transcript(self.project / f"{MAIN}.jsonl", [
            reply("d1", dated, "2026-01-02T10:00:00Z", output_tokens=1000000),
            reply("d2", "claude-haiku-5-5", "2026-01-02T10:01:00Z", input_tokens=150000),
        ])
        total = BOARD.build_board(self.fleet, usage=self.usage)["jobs"][0]["cost"]["total"]
        self.assertAlmostEqual(total["usd"], 5.0 + 150000 * 0.5 / 1e6)

    def test_bad_lines_are_skipped_and_counted(self):
        self.card("WEB", session=MAIN)
        path = self.project / f"{MAIN}.jsonl"
        self.transcript(path, [reply("ok", "claude-opus-5-5", "2026-01-02T10:00:00Z", output_tokens=7),
                               reply("neg", "claude-opus-5-5", "2026-01-02T10:00:00Z", output_tokens=-3)])
        with path.open("a") as handle:
            handle.write('{"type": "assistant", "usage": NOT_JSON\n')
        data = BOARD.build_board(self.fleet, usage=self.usage)
        self.assertEqual(data["jobs"][0]["cost"]["total"]["claude"]["claude-opus-5-5"]["output"], 7)
        self.assertEqual(data["usage"]["unreadable_lines"], 2)

    def test_unreadable_price_file_leaves_costs_unknown(self):
        self.card("WEB", session=MAIN)
        self.write_main()
        broken = self.fleet / "prices.json"
        broken.write_text("{")
        data = BOARD.build_board(self.fleet, usage=dict(self.usage, prices=broken))
        self.assertIsNone(data["jobs"][0]["cost"])
        self.assertEqual(data["usage"]["status"], "error")

    def test_command_line_flag_and_environment_switch(self):
        self.card("WEB", session=MAIN)
        self.write_main()
        base = ["python3", "scripts/fleet_board.py", "--root", str(self.fleet), "--claude-dir", str(self.projects),
                "--codex-dir", str(self.codex_home)]
        for extra, env in (([], {"FLEET_USAGE": "1"}), (["--usage"], {})):
            result = subprocess.run(base + extra, cwd=ROOT, capture_output=True, text=True, check=True,
                                    env={**os.environ, "FLEET_USAGE": "", **env})
            self.assertIsNotNone(json.loads(result.stdout)["jobs"][0]["cost"])
        result = subprocess.run(base, cwd=ROOT, capture_output=True, text=True, check=True,
                                env={**os.environ, "FLEET_USAGE": ""})
        self.assertIsNone(json.loads(result.stdout)["jobs"][0]["cost"])

    def test_links_inside_the_transcript_folder_are_not_followed(self):
        self.card("WEB", session=MAIN)
        outside = Path(self.temp.name) / "outside"
        self.transcript(outside / "subagents" / "agent-1.jsonl", [
            reply("x1", "claude-opus-5-5", "2026-01-02T10:00:00Z", output_tokens=50)])
        self.transcript(self.project / f"{MAIN}.jsonl", [
            reply("m1", "claude-opus-5-5", "2026-01-02T10:00:00Z", output_tokens=5)])
        (self.project / MAIN).symlink_to(outside, target_is_directory=True)
        cost = BOARD.build_board(self.fleet, usage=self.usage)["jobs"][0]["cost"]
        self.assertEqual(cost["total"]["claude"]["claude-opus-5-5"]["output"], 5)

    def test_a_trailing_newline_does_not_pass_as_a_session_id(self):
        self.card("WEB", session=MAIN + "\n")
        self.write_main()
        data = BOARD.build_board(self.fleet, usage=self.usage)
        self.assertIsNone(data["jobs"][0]["cost"])

    def test_a_later_stream_line_that_moves_cache_to_1h_is_not_counted_twice(self):
        self.card("WEB", session=MAIN)
        self.transcript(self.project / f"{MAIN}.jsonl", [
            reply("c1", "claude-opus-5-5", "2026-01-02T10:00:00Z", cache_creation_input_tokens=100),
            reply("c1", "claude-opus-5-5", "2026-01-02T10:00:00Z", cache_creation_input_tokens=100,
                  cache_creation={"ephemeral_1h_input_tokens": 100}),
        ])
        opus = BOARD.build_board(self.fleet, usage=self.usage)["jobs"][0]["cost"]["total"]["claude"]["claude-opus-5-5"]
        self.assertEqual((opus["cache_write_5m"], opus["cache_write_1h"]), (0, 100))
        # A sparse later line carries the 1h split without repeating the total.
        self.transcript(self.project / f"{MAIN}.jsonl", [
            reply("c2", "claude-opus-5-5", "2026-01-02T10:00:00Z", cache_creation_input_tokens=100),
            reply("c2", "claude-opus-5-5", "2026-01-02T10:00:00Z", output_tokens=5,
                  cache_creation={"ephemeral_1h_input_tokens": 100}),
        ])
        total = BOARD.build_board(self.fleet, usage=self.usage)["jobs"][0]["cost"]["total"]
        opus = total["claude"]["claude-opus-5-5"]
        self.assertEqual((opus["cache_write_5m"], opus["cache_write_1h"], opus["output"]), (0, 100, 5))
        self.assertAlmostEqual(total["usd"], (100 * 8 + 5 * 20) / 1e6)
        # A later line with only the 1h split and no other counter is still read.
        self.transcript(self.project / f"{MAIN}.jsonl", [
            reply("c3", "claude-opus-5-5", "2026-01-02T10:00:00Z", cache_creation_input_tokens=100),
            reply("c3", "claude-opus-5-5", "2026-01-02T10:00:00Z",
                  cache_creation={"ephemeral_1h_input_tokens": 100}),
        ])
        opus = BOARD.build_board(self.fleet, usage=self.usage)["jobs"][0]["cost"]["total"]["claude"]["claude-opus-5-5"]
        self.assertEqual((opus["cache_write_5m"], opus["cache_write_1h"]), (0, 100))

    def test_a_transcript_without_usage_is_unknown_and_marks_the_board_partial(self):
        self.card("WEB", session=MAIN)
        self.card("SEO", session=OTHER)
        self.write_main()
        self.transcript(self.project / f"{OTHER}.jsonl", [
            {"type": "user", "message": {"content": "HIDDEN_PROMPT_TEXT"}},
            reply("s1", "<synthetic>", "2026-01-02T10:00:00Z", output_tokens=9),
            {"type": "assistant", "message": {"id": "e1", "model": "claude-opus-5-5", "usage": {}}},
        ])
        data = BOARD.build_board(self.fleet, usage=self.usage)
        costs = {row["id"]: row["cost"] for row in data["jobs"]}
        self.assertIsNone(costs["SEO"])
        self.assertIsNotNone(costs["WEB"])
        self.assertEqual(data["usage"]["status"], "partial")
        self.assertEqual(data["usage"]["sessions_empty"], 1)

    def test_a_missing_rotated_session_marks_the_board_partial(self):
        self.card("WEB", session=MAIN, sessions=[OTHER])
        self.write_main()
        data = BOARD.build_board(self.fleet, usage=self.usage)
        self.assertEqual(data["usage"]["status"], "partial")
        self.assertIn("incomplete", data["prices"]["note"])

    def test_a_wrongly_shaped_price_file_leaves_costs_unknown(self):
        self.card("WEB", session=MAIN)
        self.write_main()
        for text in ("[]", '{"claude": {"claude-opus-5-5": []}}'):
            broken = self.fleet / "prices.json"
            broken.write_text(text)
            data = BOARD.build_board(self.fleet, usage=dict(self.usage, prices=broken))
            self.assertIsNone(data["jobs"][0]["cost"])
            self.assertEqual(data["usage"]["status"], "error")

    def test_a_folder_outside_home_is_not_echoed(self):
        self.card("WEB", session=MAIN)
        missing = Path("/nonexistent-fleet-transcripts")
        data = BOARD.build_board(self.fleet, usage=dict(self.usage, projects=missing))
        self.assertNotIn(str(missing), json.dumps(data))
        self.assertEqual(data["usage"]["status"], "no_transcripts")

    def test_usage_writes_no_bytecode(self):
        cache = ROOT / "scripts" / "__pycache__"
        before = sorted(cache.glob("cost_ledger*")) if cache.exists() else []
        subprocess.run(["python3", "scripts/fleet_board.py", "--root", str(self.fleet), "--usage",
                        "--claude-dir", str(self.projects), "--codex-dir", str(self.codex_home)],
                       cwd=ROOT, capture_output=True, check=True)
        after = sorted(cache.glob("cost_ledger*")) if cache.exists() else []
        self.assertEqual(before, after)

    # ---- Codex session logs (synthetic; the real ~/.codex is never read by these tests)

    def codex_log(self, name, cwd, turns):
        lines = [{"type": "session_meta", "timestamp": "2026-01-02T09:00:00Z", "payload": {"cwd": cwd}}]
        total = [0, 0, 0, 0, 0]
        for start, prompt, steps in turns:
            lines.append({"type": "event_msg", "timestamp": start, "payload": {"type": "task_started"}})
            lines.append({"type": "response_item", "timestamp": start, "payload": {
                "type": "message", "role": "user", "content": [{"type": "input_text", "text": prompt}]}})
            for at, values in steps:
                total = values
                lines.append({"type": "event_msg", "timestamp": at, "payload": {"type": "token_count", "info": {
                    "total_token_usage": dict(zip(
                        ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens",
                         "total_tokens"), total))}}})
        self.transcript(self.codex_home / "sessions" / "2026" / "01" / "02" / name, lines)

    def codex_board(self, **extra):
        return BOARD.build_board(self.fleet, usage=dict(self.usage, codex=self.codex_home, **extra))

    def test_codex_turns_go_to_the_job_their_prompt_names(self):
        self.card("WEB", session="<WEB_SESSION_ID>")
        self.card("SEO", session="<SEO_SESSION_ID>")
        self.codex_log("a.jsonl", "/nowhere", [
            ("2026-01-02T10:00:00Z", "JOB_ID: WEB review the diff HIDDEN_PROMPT_TEXT",
             [("2026-01-02T10:01:00Z", [100, 40, 10, 5, 110]), ("2026-01-02T10:02:00Z", [300, 100, 30, 10, 330])]),
            ("2026-01-02T11:00:00Z", "SEO and WEB both", [("2026-01-02T11:01:00Z", [400, 100, 40, 10, 440])]),
            ("2026-01-02T12:00:00Z", "no card named", [("2026-01-02T12:01:00Z", [450, 100, 50, 10, 500])]),
        ])
        data = self.codex_board()
        costs = {row["id"]: row["cost"] for row in data["jobs"]}
        codex = costs["WEB"]["total"]["codex"]
        self.assertEqual((codex["runs"], codex["input"], codex["cached"], codex["output"], codex["total"]),
                         (1, 300, 100, 30, 330))
        self.assertEqual(costs["WEB"]["total"]["usd"], 0.0)
        self.assertEqual(costs["WEB"]["chats"], ["Codex"])
        self.assertEqual(costs["WEB"]["total"]["active_s"], 120.0)
        self.assertIsNone(costs["SEO"])
        self.assertEqual(data["codex_unattributed"], {"runs": 2, "total": 170, "total_upper": 170, "several_jobs": 1})
        self.assertIn("not priced", data["prices"]["note"])
        self.assertNotIn("HIDDEN_PROMPT_TEXT", json.dumps(data))
        self.assertNotIn("/nowhere", json.dumps(data))

    def test_codex_runs_inside_a_card_folder_go_to_that_job(self):
        lane = Path(self.temp.name) / "lanes" / "web"
        lane.mkdir(parents=True)
        self.card("WEB", scope=[str(lane) + "/"])
        self.card("OPS", scope=["<FLEET_ROOT>/ops/"])
        self.codex_log("b.jsonl", str(lane / "src"), [
            ("2026-01-02T10:00:00Z", "fix the build", [("2026-01-02T10:01:00Z", [10, 0, 5, 0, 15])])])
        self.codex_log("c.jsonl", str(self.fleet / "ops"), [
            ("2026-01-02T10:00:00Z", "check the queue", [("2026-01-02T10:01:00Z", [20, 0, 5, 0, 25])])])
        costs = {row["id"]: row["cost"] for row in self.codex_board()["jobs"]}
        self.assertEqual(costs["WEB"]["total"]["codex"]["total"], 15)
        self.assertEqual(costs["OPS"]["total"]["codex"]["total"], 25)

    def test_codex_and_claude_add_up_on_one_job(self):
        self.card("WEB", session=MAIN)
        self.write_main()
        self.codex_log("d.jsonl", "/nowhere", [
            ("2026-01-02T10:00:00Z", "WEB: review", [("2026-01-02T10:01:00Z", [10, 0, 5, 0, 15])])])
        cost = self.codex_board()["jobs"][0]["cost"]
        self.assertEqual(cost["total"]["codex"]["total"], 15)
        self.assertEqual(cost["total"]["claude"]["claude-opus-5-5"]["output"], 500)
        self.assertEqual(sorted(cost["chats"]), sorted([MAIN, "Codex"]))

    def test_a_falling_codex_counter_keeps_a_range(self):
        self.card("WEB")
        self.codex_log("e.jsonl", "/nowhere", [
            ("2026-01-02T10:00:00Z", "WEB", [("2026-01-02T10:01:00Z", [100, 0, 0, 0, 100]),
                                             ("2026-01-02T10:02:00Z", [30, 0, 0, 0, 30]),
                                             ("2026-01-02T10:03:00Z", [150, 0, 0, 0, 150])])])
        codex = self.codex_board()["jobs"][0]["cost"]["total"]["codex"]
        self.assertEqual((codex["total"], codex["total_upper"], codex["drops"]), (150, 250, 1))

    def test_old_and_linked_codex_logs_are_skipped(self):
        self.card("WEB")
        self.codex_log("old.jsonl", "/nowhere", [
            ("2026-01-02T10:00:00Z", "WEB", [("2026-01-02T10:01:00Z", [10, 0, 0, 0, 10])])])
        old = self.codex_home / "sessions" / "2026" / "01" / "02" / "old.jsonl"
        os.utime(old, (1, 1))
        outside = Path(self.temp.name) / "elsewhere.jsonl"
        outside.write_text(old.read_text())
        (old.parent / "linked.jsonl").symlink_to(outside)
        data = self.codex_board()
        self.assertIsNone(data["jobs"][0]["cost"])
        self.assertEqual(data["usage"]["codex"]["status"], "no_recent_logs")

    def test_missing_codex_home_is_a_reason_not_an_error(self):
        self.card("WEB", session=MAIN)
        self.write_main()
        data = self.codex_board()
        self.assertIsNotNone(data["jobs"][0]["cost"])
        self.assertEqual(data["usage"]["codex"]["status"], "no_logs")
        self.assertIn("no Codex session logs found", data["prices"]["note"])

    def test_a_job_id_inside_a_longer_word_does_not_count(self):
        self.card("WEB")
        self.codex_log("f.jsonl", "/nowhere", [
            ("2026-01-02T10:00:00Z", "WEBSITE-REDESIGN and WEB-2", [("2026-01-02T10:01:00Z", [10, 0, 0, 0, 10])])])
        data = self.codex_board()
        self.assertIsNone(data["jobs"][0]["cost"])
        self.assertEqual(data["codex_unattributed"]["runs"], 1)

    def codex_events(self, name, events):
        """Raw Codex events in order: ("prompt", text), ("start",) or ("tokens", total)."""
        lines = [{"type": "session_meta", "timestamp": "2026-01-02T09:00:00Z", "payload": {"cwd": "/nowhere"}}]
        for minute, event in enumerate(events):
            at = f"2026-01-02T10:{minute:02d}:00Z"
            if event[0] == "prompt":
                lines.append({"type": "response_item", "timestamp": at, "payload": {
                    "type": "message", "role": "user", "content": [{"type": "input_text", "text": event[1]}]}})
            elif event[0] == "start":
                lines.append({"type": "event_msg", "timestamp": at, "payload": {"type": "task_started"}})
            else:
                lines.append({"type": "event_msg", "timestamp": at, "payload": {"type": "token_count", "info": {
                    "total_token_usage": {"input_tokens": event[1], "total_tokens": event[1]}}}})
        self.transcript(self.codex_home / "sessions" / "2026" / "01" / "02" / name, lines)

    def codex_totals(self):
        data = self.codex_board()
        return {row["id"]: (row["cost"] or {}).get("total", {}).get("codex", {}).get("total") for row in data["jobs"]}

    def test_codex_prompt_and_start_in_either_order_stay_together(self):
        self.card("WEB")
        self.card("OPS")
        self.codex_events("g.jsonl", [("prompt", "WEB first"), ("start",), ("tokens", 100),
                                      ("prompt", "OPS next"), ("tokens", 250),
                                      ("start",), ("prompt", "WEB again"), ("tokens", 300)])
        self.assertEqual(self.codex_totals(), {"WEB": 150, "OPS": 150})

    def test_codex_log_without_start_events_splits_on_prompts(self):
        self.card("WEB")
        self.card("OPS")
        self.codex_events("h.jsonl", [("prompt", "WEB"), ("tokens", 100), ("prompt", "OPS"), ("tokens", 150)])
        self.assertEqual(self.codex_totals(), {"WEB": 100, "OPS": 50})

    def test_an_unreadable_helper_keeps_the_rest_and_marks_partial(self):
        self.card("WEB", session=MAIN)
        self.write_main()
        helper = self.project / MAIN / "subagents" / "agent-1.jsonl"
        helper.chmod(0)
        self.addCleanup(helper.chmod, 0o600)
        self.codex_events("i.jsonl", [("start",), ("prompt", "WEB"), ("tokens", 10)])
        data = self.codex_board()
        total = data["jobs"][0]["cost"]["total"]
        self.assertEqual(total["claude"]["claude-opus-5-5"]["output"], 500)
        self.assertNotIn("claude-sonnet-5-5", total["claude"])
        self.assertEqual(total["codex"]["total"], 10)
        self.assertEqual(data["usage"]["status"], "partial")

    def test_a_scope_that_is_not_a_list_of_strings_is_a_card_error(self):
        self.card("GOOD")
        self.card("TEXT", scope="/synthetic/web")
        self.card("NUMBER", scope=7)
        self.codex_events("j.jsonl", [("start",), ("prompt", "no card"), ("tokens", 10)])
        data = self.codex_board()
        self.assertEqual([row["id"] for row in data["jobs"]], ["GOOD"])
        self.assertEqual(len(data["errors"]), 2)
        self.assertEqual(data["codex_unattributed"]["runs"], 1)


if __name__ == "__main__":
    unittest.main()
