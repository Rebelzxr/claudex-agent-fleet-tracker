#!/usr/bin/env python3
"""Fail closed on private identifiers. Never print a matching value."""

from pathlib import Path
import os
import re
import subprocess
import sys


EMAIL = re.compile(r"[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+")
# Git identity fields may use local domains; source can also contain plugin@marketplace syntax.
GIT_EMAIL = re.compile(r"[^\s@]+@[^\s@]+")
RULES = [
    ("identity number", re.compile(r"(?<!\d)\d{6}-\d{2}-\d{4}(?!\d)")),
    ("session identifier", re.compile(r"local_[0-9a-f]{8,}", re.I)),
    ("unique identifier", re.compile(r"\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b", re.I)),
    ("home path", re.compile(r"/(?:Users|home)/[^\s/]+")),
    ("service secret", re.compile(r"\b(?:gh[pousr]_|github_pat_|sk-|xox[baprs]?-)[a-zA-Z0-9_-]{8,}|\bAKIA[A-Z0-9]{16}\b")),
    ("international phone", re.compile(r"(?<![\w])\+\d(?:[ .()-]?\d){7,14}(?!\d)")),
    ("domestic phone", re.compile(r"(?<![\w])01\d(?:[ .-]?\d){7,8}(?!\d)")),
    ("phone digits", re.compile(r"(?<![\w])\d{8,15}(?![\w])")),
    ("formatted phone", re.compile(r"(?<!\d)\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)")),
    ("private key", re.compile(r"-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----")),
]
# Each of these files may hold one public credit line in exactly this shape. Denylist terms are
# allowed on that line only. The names live in README.md and LICENSE, never here.
CREDIT_SHAPES = {
    "README.md": re.compile(r"Created by [A-Za-z]+ \(\[([a-z0-9.-]+)\]\(https://\1\)\)\."),
    "LICENSE": re.compile(r"Copyright \(c\) \d{4} [A-Za-z]+"),
}


def is_credit(relative, number, lines):
    shape = CREDIT_SHAPES.get(relative)
    if shape is None or number == 0 or not shape.fullmatch(lines[number]):
        return False
    # Only the first line of that shape counts as the credit.
    return next(i for i, line in enumerate(lines) if i > 0 and shape.fullmatch(line)) == number


# Only these exact addresses may appear. Forks set PRIVACY_ALLOWED_EMAILS to their own noreply address(es).
DEFAULT_ALLOWED = "Rebelzxr@users.noreply.github.com"


def allowed_emails():
    raw = os.environ.get("PRIVACY_ALLOWED_EMAILS", DEFAULT_ALLOWED)
    return {item.strip().casefold() for item in raw.split(",") if item.strip()}


def has_private_email(text, pattern=EMAIL):
    allowed = allowed_emails()
    return any(match.group().casefold() not in allowed for match in pattern.finditer(text))


def scan(root):
    findings = []
    count = 0
    denylist = root / ".privacy-denylist"
    terms = []
    if denylist.is_file() and not denylist.is_symlink():
        terms = [line.strip().casefold() for line in denylist.read_text(encoding="utf-8").splitlines() if line.strip()]

    def walk(folder):
        nonlocal count
        for path in sorted(folder.iterdir()):
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                findings.append((relative, 0, "symbolic link"))
                continue
            if path.is_dir():
                if not (folder == root and path.name == ".git"):
                    walk(path)
                continue
            if path == denylist:
                continue  # Local-only input, never a public source file.
            count += 1
            if path.name.startswith(".env") or path.suffix.lower() in {".key", ".pem"}:
                findings.append((relative, 0, "credential file"))
            # Inspect filenames too, including ignored local configuration.
            lines = [relative] + path.read_bytes().decode("utf-8", errors="replace").splitlines()
            for number, line in enumerate(lines):
                if has_private_email(line):
                    findings.append((relative, number, "email"))
                for label, pattern in RULES:
                    if pattern.search(line):
                        findings.append((relative, number, label))
                if any(term in line.casefold() for term in terms) and not is_credit(relative, number, lines):
                    findings.append((relative, number, "denylist term"))

    walk(root)
    inside = subprocess.run(["git", "-C", str(root), "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True)
    if inside.returncode == 0 and inside.stdout.strip() == "true":
        history = subprocess.run(["git", "-C", str(root), "log", "--format=%an %ae %cn %ce"], capture_output=True, text=True)
        if history.returncode:
            findings.append((".git", 0, "git history unreadable"))
        else:
            for number, line in enumerate(history.stdout.splitlines(), 1):
                if has_private_email(line, GIT_EMAIL):
                    findings.append((".git", number, "git author/committer email"))
        tracked = subprocess.run(["git", "-C", str(root), "ls-files", "--", ".privacy-denylist"], capture_output=True, text=True)
        if tracked.returncode or tracked.stdout.strip():
            findings.append((".git", 0, "denylist must stay untracked"))
    return count, findings


def main():
    try:
        root = Path(sys.argv[1]).resolve()
        if not root.is_dir():
            raise OSError("missing root")
        count, findings = scan(root)
    except (OSError, UnicodeError, IndexError):
        print("privacy scan: FAILED (unreadable source)", file=sys.stderr)
        return 2
    for number, (_path, line, rule) in enumerate(findings, 1):
        # Never print paths or matching values: either may contain private data.
        print(f"privacy scan: finding #{number}, line {line}: {rule}", file=sys.stderr)
    print(f"privacy scan: {'FAILED' if findings else 'PASS'} ({count} files, {len(findings)} findings)")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
