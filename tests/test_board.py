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


class BoardChecks(unittest.TestCase):
    def setUp(self):
        (ROOT / ".local").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / ".local")
        self.addCleanup(self.temp.cleanup)
        self.fleet = Path(self.temp.name)
        (self.fleet / "dispatch/jobs").mkdir(parents=True)

    def write_card(self, name, value):
        (self.fleet / "dispatch/jobs" / name).write_text(json.dumps(value))

    def test_example_end_to_end(self):
        result = subprocess.run(
            ["python3", "scripts/fleet_board.py"], cwd=ROOT,
            env={**os.environ, "FLEET_ROOT": "example", "FLEET_TIMEZONE": "UTC", "FLEET_USAGE": ""},
            capture_output=True, text=True, check=True,
        )
        data = json.loads(result.stdout)
        self.assertEqual(len(data["jobs"]), 4)
        self.assertEqual(data["errors"], [])
        blocked = next(row for row in data["jobs"] if row["status"] == "blocked")
        self.assertEqual((blocked["done"], blocked["total"]), (1, 3))
        self.assertTrue(blocked["blocked_on"].startswith("Human:"))
        # Usage is off by default, so cost stays unknown (null), never a made-up zero.
        self.assertEqual(data["usage"]["status"], "off")
        self.assertTrue(all(row["cost"] is None for row in data["jobs"]))

    def test_bad_cards_are_isolated_and_do_not_echo_contents(self):
        self.write_card("valid.json", {"id": "GOOD", "steps": [{"name": "Build", "done": True}]})
        self.write_card("array.json", [])
        self.write_card("steps.json", {"steps": [{"name": "Wrong", "done": "false"}]})
        self.write_card("duplicate.json", {"id": "GOOD"})
        self.write_card("_sessions.json", [])
        (self.fleet / "dispatch/jobs/broken.json").write_text("NOT_FOR_OUTPUT {")
        data = BOARD.build_board(self.fleet)
        self.assertEqual(len(data["jobs"]), 1)
        self.assertEqual(len(data["errors"]), 4)
        self.assertNotIn("NOT_FOR_OUTPUT", json.dumps(data))

    def test_symbolic_card_is_not_read(self):
        outside = self.fleet / "outside.json"
        outside.write_text('{"title":"NOT_FOR_OUTPUT"}')
        (self.fleet / "dispatch/jobs/link.json").symlink_to(outside)
        data = BOARD.build_board(self.fleet)
        self.assertEqual(len(data["errors"]), 1)
        self.assertEqual(data["jobs"], [])

    def test_dates_need_offsets_and_are_normalized(self):
        self.assertEqual(BOARD.timestamp("2026-01-01T08:00:00+08:00"), BOARD.timestamp("2026-01-01T00:00:00Z"))
        for value in ["2026-01-01", 17, "not-a-date"]:
            with self.assertRaises(ValueError):
                BOARD.timestamp(value)

    def test_empty_valid_root_and_missing_root_are_distinct(self):
        self.assertEqual(BOARD.build_board(self.fleet)["jobs"], [])
        result = subprocess.run(
            ["python3", "scripts/fleet_board.py", "--root", str(self.fleet / "missing")],
            cwd=ROOT, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")

    def test_invalid_time_zone_is_rejected(self):
        result = subprocess.run(
            ["python3", "scripts/fleet_board.py", "--root", str(self.fleet), "--timezone", "Unknown/Zone"],
            cwd=ROOT, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
