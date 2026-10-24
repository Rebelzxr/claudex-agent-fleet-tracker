# Board setup

## Standalone data

From the checkout root:

```sh
FLEET_ROOT=example python3 scripts/fleet_board.py | python3 -m json.tool
```

The root must contain `dispatch/jobs/`. Card files beginning with `_` are ignored.
Malformed cards and duplicate ids appear in `errors`; other valid cards remain
visible. Dates use ISO timestamps with a UTC offset. By default the data script
never reads chat transcripts, secrets, inbox messages, decisions or cost history.
Token usage is opt-in; see [Why are tokens null?](#why-are-tokens-null).

## Why are tokens null?

Token usage is off by default, so a fresh checkout shows `cost: null` and a dash
in the cost column. Nothing private is read until you ask. Turn it on with:

```sh
FLEET_USAGE=1 python3 scripts/fleet_board.py --root "${FLEET_ROOT:-example}" | python3 -m json.tool
```

That uses your exported `FLEET_ROOT`, or the example fleet if it is unset. The
example cards hold placeholders, so they stay null until you put real session
ids on your own cards. `--usage` does the same as `FLEET_USAGE=1`. For the mod, add `export FLEET_USAGE=1` next to the
other exports below before you start the app. Transcripts are read from
`~/.claude/projects`; if yours live elsewhere, set `FLEET_CLAUDE_PROJECTS` (or
`--claude-dir`) to that folder.

Each card then needs its director's Claude Code session id in `session`. That id
is the file name of the chat's transcript under `~/.claude/projects/<project>/`,
without `.jsonl`. After a chat rotation, keep the older ids in a `sessions` list
so the job keeps its full total. Placeholders such as `<WEB_SESSION_ID>` are
skipped.

- It reads only the transcripts of sessions named on cards, plus their helper
  agent transcripts, and keeps only token counts, model names, timestamps and the
  chat title. Prompt, reply and tool text never reach the output. No network.
- Dollars are API-equivalent at the public list prices in
  `scripts/usage_prices.json` (see its `as_of` date), not a bill. Pro and Max
  plans are subscriptions. Codex usage is not counted yet.
- A session named on two cards is not split between them. It shows on its chat
  row as coordination and on neither job.
- When a job still shows null, `usage.status` and the prices note say why:
  `no_transcripts` (folder not found), `no_sessions_on_cards` (cards still hold
  placeholders), `no_matching_sessions` (no transcript has a card's id) or
  `error` (the price file or a transcript could not be read). Unknown stays null,
  never a zero. `partial` means some named sessions or usage records could not
  be read, so the amounts cover only what was read.

With usage on, the board output carries session ids and chat titles. Keep it as
private as the transcripts themselves.

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
- Optional cost detail: with usage off, the script supplies `cost: null` and no
  chat totals. The column dash means unknown, not free work. With usage on, each
  job gets Claude token buckets and an API-equivalent dollar figure. Phase data
  stays empty.
- Chats: per-session totals when usage is on; empty otherwise.
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
