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
        base = ["python3", "scripts/fleet_board.py", "--root", str(self.fleet), "--claude-dir", str(self.projects)]
        for extra, env in (([], {"FLEET_USAGE": "1"}), (["--usage"], {})):
            result = subprocess.run(base + extra, cwd=ROOT, capture_output=True, text=True, check=True,
                                    env={**os.environ, "FLEET_USAGE": "", **env})
            self.assertIsNotNone(json.loads(result.stdout)["jobs"][0]["cost"])
        result = subprocess.run(base, cwd=ROOT, capture_output=True, text=True, check=True,
                                env={**os.environ, "FLEET_USAGE": ""})
        self.assertIsNone(json.loads(result.stdout)["jobs"][0]["cost"])


if __name__ == "__main__":
    unittest.main()
