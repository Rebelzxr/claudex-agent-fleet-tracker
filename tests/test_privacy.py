import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("privacy_scan", ROOT / "scripts/privacy_scan.py")
SCAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCAN)


class PrivacyChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def test_optional_denylist_checks_case_and_substrings(self):
        (self.folder / ".privacy-denylist").write_text("\nSunny\n")
        self.assertEqual(SCAN.scan(self.folder), (0, []))
        for value in ["SUNNY", "some sunny text", "not-sunny-here"]:
            with self.subTest(value=value):
                (self.folder / "sample.txt").write_text(value)
                self.assertIn("denylist term", [hit[2] for hit in SCAN.scan(self.folder)[1]])
        (self.folder / "sample.txt").write_text("safe")
        self.assertEqual(SCAN.scan(self.folder)[1], [])

    def test_denylist_is_git_ignored_and_untracked(self):
        result = subprocess.run(["git", "check-ignore", "--no-index", ".privacy-denylist"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), ".privacy-denylist")
        result = subprocess.run(["git", "ls-files", "--", ".privacy-denylist"], cwd=ROOT, capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout, "")

    def test_identifier_rules(self):
        samples = [
            "sample" + "@" + "example.invalid",
            "123456" + "-12-" + "3456",
            "local_" + "ab" * 4,
            "ab" * 4 + "-" + "ab" * 2 + "-" + "ab" * 2 + "-" + "ab" * 2 + "-" + "ab" * 6,
            "/" + "Users/" + "sample/fleet",
            "/" + "home/" + "sample/fleet",
            "gh" + "p_" + "SYNTHETIC" * 3,
            "gh" + "o_" + "SYNTHETIC" * 3,
            "github_" + "pat_" + "SYNTHETIC" * 3,
            "s" + "k-" + "SYNTHETIC" * 3,
            "xo" + "xb-" + "SYNTHETIC" * 3,
            "xo" + "x-" + "SYNTHETIC" * 3,
            "AK" + "IA" + "A" * 16,
            "+" + "60" + "12" + "345" + "6789",
            "+" + "60 12 345 6789",
            "01" + "2-" + "345-" + "6789",
            "01" + "1 " + "2345 " + "6789",
            "234" + "-567-" + "8901",
            "12345" + "67890",
            "-----BEGIN " + "PRIVATE KEY-----",
            "-----BEGIN RSA " + "PRIVATE KEY-----",
            "-----BEGIN OPENSSH " + "PRIVATE KEY-----",
            "sample" + "@" + "users.noreply.github.com.evil.invalid",
        ]
        for number, sample in enumerate(samples):
            with self.subTest(rule=number):
                (self.folder / "sample.txt").write_text(sample)
                self.assertTrue(SCAN.scan(self.folder)[1])

    def test_only_listed_addresses_are_allowed(self):
        own = "Rebelzxr" + "@" + "users.noreply.github.com"
        (self.folder / "sample.txt").write_text(own + "\n" + own.upper())
        self.assertEqual(SCAN.scan(self.folder)[1], [])
        (self.folder / "sample.txt").write_text("sample" + "@" + "users.noreply.github.com")
        self.assertTrue(SCAN.scan(self.folder)[1])

    def test_allowed_emails_can_be_set_for_forks(self):
        other = "sample" + "@" + "users.noreply.github.com"
        (self.folder / "sample.txt").write_text(other)
        with patch.dict(SCAN.os.environ, {"PRIVACY_ALLOWED_EMAILS": other}):
            self.assertEqual(SCAN.scan(self.folder)[1], [])

    def test_plugin_marketplace_syntax_is_not_an_email(self):
        (self.folder / "sample.txt").write_text("hq-board@fleet-mods")
        self.assertEqual(SCAN.scan(self.folder)[1], [])

    def test_safe_placeholders_and_exact_credits(self):
        credit = next(line for line in (ROOT / "README.md").read_text().splitlines() if line.startswith("Created by "))
        license_credit = (ROOT / "LICENSE").read_text().splitlines()[2]
        owner = license_credit.split()[-1]
        (self.folder / ".privacy-denylist").write_text(owner + "\n")
        (self.folder / "sample.txt").write_text("<HQ_SESSION_ID> <DIRECTOR_SESSION_ID> $FLEET_ROOT ~/fleet")
        (self.folder / "LICENSE").write_text(license_credit)
        (self.folder / "README.md").write_text(credit)
        self.assertEqual(SCAN.scan(self.folder)[1], [])
        (self.folder / "README.md").write_text(credit + " extra")
        self.assertTrue(SCAN.scan(self.folder)[1])
        (self.folder / "README.md").write_text(credit)
        (self.folder / "other.md").write_text(credit)
        self.assertTrue(SCAN.scan(self.folder)[1])
        (self.folder / "other.md").unlink()
        (self.folder / "README.md").write_text(credit + "\n" + credit)
        self.assertTrue(SCAN.scan(self.folder)[1])

    def test_ignored_local_config_and_filenames_are_scanned(self):
        local = self.folder / ".local"
        local.mkdir()
        (local / "private.txt").write_text("sample" + "@" + "example.invalid")
        self.assertTrue(SCAN.scan(self.folder)[1])
        (local / "private.txt").unlink()
        (self.folder / ".env.test").write_text("empty")
        self.assertTrue(SCAN.scan(self.folder)[1])
        (self.folder / ".env.test").unlink()
        (self.folder / ("sample" + "@" + "example.invalid")).write_text("empty")
        self.assertTrue(SCAN.scan(self.folder)[1])

    def test_denylist_terms_in_filenames_are_scanned(self):
        (self.folder / ".privacy-denylist").write_text("sunny")
        (self.folder / "SUNNY.txt").write_text("safe")
        self.assertTrue(SCAN.scan(self.folder)[1])

    def test_every_non_git_directory_is_scanned(self):
        for name in ["node_modules", "__pycache__", "nested/.git"]:
            directory = self.folder / name
            directory.mkdir(parents=True, exist_ok=True)
            (directory / "sample.txt").write_text("sample" + "@" + "example.invalid")
        self.assertEqual(len(SCAN.scan(self.folder)[1]), 3)

    def test_symlinks_fail_closed(self):
        (self.folder / "sample.txt").write_text("safe")
        (self.folder / "link").symlink_to(self.folder / "sample.txt")
        self.assertTrue(SCAN.scan(self.folder)[1])

    def test_git_author_and_committer_emails(self):
        noreply = "Rebelzxr" + "@" + "users.noreply.github.com"
        private = "sample" + "@" + "example.invalid"
        local_email = "sample" + "@" + "localhost"
        for author, committer, expected in [(noreply, noreply, []), (private, noreply, ["git author/committer email"]), (noreply, private, ["git author/committer email"]), (local_email, noreply, ["git author/committer email"])]:
            with self.subTest(author_private=author == private, committer_private=committer == private):
                replies = [
                    subprocess.CompletedProcess([], 0, "true\n", ""),
                    subprocess.CompletedProcess([], 0, f"Sample {author} Sample {committer}\n", ""),
                    subprocess.CompletedProcess([], 0, "", ""),
                ]
                with patch.object(SCAN.subprocess, "run", side_effect=replies) as run:
                    self.assertEqual([hit[2] for hit in SCAN.scan(self.folder)[1]], expected)
                    self.assertEqual(run.call_args_list[1].args[0], ["git", "-C", str(self.folder), "log", "--format=%an %ae %cn %ce"])

    def test_tracked_denylist_fails(self):
        replies = [
            subprocess.CompletedProcess([], 0, "true\n", ""),
            subprocess.CompletedProcess([], 0, "Sample " + "Rebelzxr" + "@" + "users.noreply.github.com" + "\n", ""),
            subprocess.CompletedProcess([], 0, ".privacy-denylist\n", ""),
        ]
        with patch.object(SCAN.subprocess, "run", side_effect=replies):
            self.assertIn("denylist must stay untracked", [hit[2] for hit in SCAN.scan(self.folder)[1]])

    def test_cli_fails_without_echoing_value(self):
        value = "sample" + "@" + "example.invalid"
        (self.folder / value).write_text(value)
        result = subprocess.run(["bash", "scripts/privacy_scan.sh", str(self.folder)], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(value, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
