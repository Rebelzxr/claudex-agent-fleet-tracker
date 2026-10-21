# Claudex Agent Fleet Tracker

Run one light HQ chat and several focused Claude director chats. Files hold the
queue, scope, locks, checkpoints and proof. The optional desktop board shows job
progress and routing metadata. A second model (e.g. GPT via Codex CLI) reviews.

Created by Dainer ([dainer-ai.biz](https://dainer-ai.biz)).

This is the multi-chat layer I run every day: one HQ chat, nine director chats,
one board.

## Where this fits

[ai-work-os](https://github.com/Rebelzxr/ai-work-os) is the base: one rules file,
dispatch and receipts, evidence before "done", and hooks that stop one-way-door
commands. Start there if you run one agent chat.

This repo is the layer on top, for when one chat is not enough:

- an HQ chat that only routes, plus director chats that each own one lane
- JSON job cards and a live board pane that shows every job's progress
- a twice-daily sweep, a merge steward and a restart wake, as templates
- chat rotation, a machine gate and a human decision desk, as written method

The templates here are short fleet versions. Use the fuller rules file and
receipt format from ai-work-os if you already have it.

## Ten minute quickstart

Requires Python 3.9+ and Git. The JSON board needs no packages, account or network.
Start in your checkout:

```sh
export FLEET_ROOT=example
python3 scripts/fleet_board.py | python3 -m json.tool
bash scripts/privacy_scan.sh
python3 -B -m unittest discover -s tests -v
```

You should see four jobs across website, content, seo and ops. One is active,
one waits on a human, one needs review and one is done. Costs are unknown.
A missing dispatch/jobs directory is an error, rather than an empty success.

For your own fleet, keep private state outside this checkout:

```sh
mkdir -p ~/fleet
cp -R example/. ~/fleet/
export FLEET_ROOT="$HOME/fleet"
```

Paste [the HQ charter](templates/hq-charter.md) into a fresh Claude chat.
Follow [Opening directors](docs/OPENING-DIRECTORS.md) to start one director and
assign the first inbox work order. Read its receipt before assigning more work.

The [method](docs/METHOD.md) covers scope, review, decisions, rotation and the
machine gate. [Board setup](docs/BOARD.md) covers the optional Claude Code mod.
[Claude and Codex on one folder](docs/CLAUDE-CODEX-BRIDGE.md) covers the Codex
plugin, scripted reviews and how both agents share one folder safely.
The script works on its own when your Claude build has no mod support.

## How HQ dispatches

1. HQ reads TODO and the relevant job card, confirms the writer lease and writes
   one bounded handoff with acceptance checks.
2. HQ pushes the packet to the named director through a supported session tool,
   or the person pastes it. A file placed in an inbox is not proof of pickup.
3. The director does the work, records checks in a receipt, updates the card and
   sends one finished, blocked or decision-needed result back to HQ.
4. HQ routes review and human decisions. It keeps deep work in director chats.

Schedules here are **templates**, not installed tasks. No tool in this repo
sends messages, starts chats, changes accounts, merges code or spends money.
Activating a sweep or steward needs a person's explicit setup and authority.

The Decision Desk is a file workflow here (`example/memory/DECISIONS.md`),
not a bundled hosted app.

## Layout and checks

- `scripts/`: read-only JSON board and privacy grep.
- `mods/hq-board/`: desktop/terminal pane with offline host regression tests.
- `templates/`: shared rules, charters, handoff, receipt and checkpoint.
- `scheduled-tasks/`: inert sweep, steward and restart-wake instructions.
- `example/`: synthetic cards, receipts, work order, lock and TODO.

`claude plugin test mods/hq-board` uses the host's `claude-code/testing` runner.
No package install or network is needed for its mocked process and UI tests.
The privacy scan checks filenames and content, including ignored local config;
it skips the root `.git` metadata directory and the optional local denylist.
Every email in files and in Git author and committer fields must be on an
exact allow list (this repo's GitHub noreply address by default). In a fork,
set `PRIVACY_ALLOWED_EMAILS` to your own noreply address, comma-separated for
more than one. Put additional private terms in
`.privacy-denylist`, one plain term per line (case-insensitive). That file is
git-ignored and must never be committed. Exact README and LICENSE credit lines
are allowed for denylist terms. The scan blocks
sensitive identifiers and secret files, but cannot prove arbitrary prose is safe.
Read every changed file before public release. Keep live state outside the repo.

MIT licensed.
