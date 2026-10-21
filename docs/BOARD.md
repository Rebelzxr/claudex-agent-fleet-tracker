# Board setup

## Standalone data

From the checkout root:

```sh
FLEET_ROOT=example python3 scripts/fleet_board.py | python3 -m json.tool
```

The root must contain `dispatch/jobs/`. Card files beginning with `_` are ignored.
Malformed cards and duplicate ids appear in `errors`; other valid cards remain
visible. Dates use ISO timestamps with a UTC offset. The data script never reads
chat transcripts, secrets, inbox messages, decisions or cost history.

## Install the optional mod

You need a Claude Code build with local mod hooks, pane support and
`claude-code/testing`. Ordinary plugin support alone may not include those APIs.
Use `claude plugin --help` to check for `test` before proceeding.

Set paths before starting the app. Both are required in the mod's environment:

```sh
export FLEET_ROOT="$PWD/example"
export FLEET_BOARD_SCRIPT="$PWD/scripts/fleet_board.py"
# Optional IANA zone; omit it for the host's local zone.
export FLEET_TIMEZONE=UTC
claude --plugin-dir "$PWD/mods/hq-board"
```

Run that command from this checkout. Use your host's supported desktop launch
option to open the same session as a pane. A desktop app started from an icon
may not inherit shell variables: quit that app and launch it from the configured
shell, or set those variables through its documented environment controls.
Never paste secrets into these values. Use absolute paths for the two path values.
For a persistent install, add this checkout as a local marketplace using
`claude plugin marketplace add "$PWD"`, then install
`claude plugin install hq-board@fleet-mods`. These are optional account-local
setup steps for the person; the build itself does not run them.

Restart the session after plugin setup. In HQ run `/board-hq`, then `/board`.
A missing config gives a toast. Python errors retain the last known view rather
than pretending to refresh. The board refreshes every five minutes; `/board`
refreshes immediately. Session usage in the status line refreshes each minute.
A fresh install selects the first session as HQ; `/board-hq` changes that choice.

## What the pane shows

- Jobs: lane, current status, completed steps and next action. Lane buttons jump
  into the paged list. Blockers beginning with `Human:` show `on YOU`.
- Optional cost detail: the inherited pane accepts cost buckets and phase data,
  but this script supplies `cost: null` and no chat totals. The column dash means
  unknown; summed zeroes mean no supplied cost, not free work or a bill.
- Chats: optional cost totals; empty in the zero setup version.
- Messages: direction, peer label, delivery state and configured time zone.
  Message bodies are neither stored nor drawn by this port. Routing metadata
  stays in the host's local plugin store. Do not share that store publicly.

A delivered message is not a finished job. The pane is a read-only view of state,
not a dispatcher or approval system. The Decision Desk remains a separate file.
The `errors` counter uses the inherited "chats skipped" label for data errors;
inspect the JSON output for card errors.

## Limits and checks

The pane caps each render at 24,600 serialized characters and 330 nodes, tries
smaller sections when needed, pages jobs in groups of 12, and keeps button handles
stable across redraws. A maximum of one job's details is expanded at a time.
It retains at most 300 message metadata rows and eight per-session diagnostic
rings of 60 events. Those diagnostics measure draws, not task completion.
The pane keeps its last 8 diagnostic rings in its own store and trims older ones.

```sh
claude plugin test mods/hq-board
```

The host supplies the special testing module and generated type support. The
`tsconfig.json` extends that generated support, so a bare TypeScript install is
not a substitute for the host runner. Tests mock processes, clocks and UI; they
need no network. A successful mocked pane test does not prove a real desktop
install. Check `/board` and a lane button in your own supported host before use.
