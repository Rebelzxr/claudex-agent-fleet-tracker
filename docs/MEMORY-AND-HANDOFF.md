# Memory, logs and handoffs

Chats forget. Tabs close, context fills up, a session gets compacted, and the
next chat starts blank. This method keeps everything that matters in plain
files, so any new chat, Claude or GPT, can read them and carry on.

The rule under all of it: **if it is not in a file, it did not happen.**

## The state files

| File | Holds | Who writes | When |
| --- | --- | --- | --- |
| `AGENTS.md` | Shared rules for every agent | The person, or HQ with approval | When a rule changes |
| `memory/TODO.md` | Current state of every lane and the exact next step | The lane owner | Only when state changes |
| `memory/DECISIONS.md` | Questions waiting on the person | HQ and directors | When a decision is needed |
| `dispatch/jobs/<id>.json` | One job: owner, status, steps, blocker | The job owner | Each step |
| `dispatch/receipts/<id>.md` | What was checked and the raw result | Whoever did the work | When a job or step finishes |
| `memory/daily-logs/<date>.md` | Terse technical log of the day | Each chat with real work | End of session |
| `memory/session-handoffs/<date>-<lane>.md` | Checkpoint for the next chat | The chat that stops | Before rotating or stopping |
| `memory/TODO_ARCHIVE.md` | Closed and superseded TODO entries | The lane owner | When an entry is done |

`memory/TODO.md` is the front door. Its top section, `Context for next
session`, is eight short lines a fresh chat can read in ten seconds. Keep it
current. Everything else is linked from there.

Three kinds of memory, kept apart:

- **State** is what is true now: TODO, job cards, locks. Overwrite it.
- **History** is what happened: daily logs, receipts, handoffs. Append only.
- **Lessons** are what to do differently: short notes in your agent's own
  memory store (below) or a learning file. Only for real, reusable lessons.

Never put secrets, passwords, tokens or private client records in any of
these files. Point to where a secret lives; never copy it.

## Logging: the end-of-session routine

When a chat finishes real work, it writes before it stops. Trivial sessions
(a lookup, a quick answer) write nothing.

1. Append to `memory/daily-logs/<date>.md` using
   [templates/daily-log.md](../templates/daily-log.md): what changed (file
   paths), decisions and why, problems and fixes, blockers, and the exact next
   command.
2. Update the lane's line in `memory/TODO.md` only if its state, blocker or
   next step changed. Move finished entries to `memory/TODO_ARCHIVE.md`.
3. Make sure every finished job has its receipt and its card says `done`.

Give your agents a short trigger for this, like "log session" or "eod", and
put the steps in `AGENTS.md` so every agent does it the same way.

Do not wait for the end of the day to save state. Save it the moment it
changes, and always before a long run, a risky step, or a context limit.

## Handoffs: passing work to a new chat

A chat should hand off well before its context limit, leaving room to write
the checkpoint, or whenever it must stop mid-job. Use your host and model's
real limit; with a large context window we rotate at about 300k tokens.

1. Finish the current step. Start no new deep work.
2. Write `memory/session-handoffs/<date>-<lane>.md` from
   [templates/checkpoint.md](../templates/checkpoint.md): job, owner, scope,
   artifact and version, lease, finished proof, open gap, human decisions with
   their exact wording, and one next command that someone can run.
3. Point the lane's TODO entry and job card at the handoff file.
4. Open the new chat with one line: "Read `<handoff file>` and `AGENTS.md`,
   then continue as `<LANE>` director."
5. Close or archive the old chat only after the new one confirms it has
   picked up.

The new chat trusts the files, not the handoff's summary of them. If the
handoff and the files disagree, the files win, and the new chat says what it
corrected.

## Passing state between Claude and GPT

Claude and GPT (through the Codex CLI) do not share a chat or a memory. They
share a folder. Everything they hand each other goes through it.

**Both read the same rules.** Codex reads `AGENTS.md`. Claude Code reads
`CLAUDE.md`, which imports it with an @AGENTS.md line. Put shared rules in one
place. See [Claude and Codex on one folder](CLAUDE-CODEX-BRIDGE.md).

**Claude to GPT: a work order file.** Before starting a Codex run, write
`dispatch/inbox/<lane>/<JOB_ID>.md` from
[templates/handoff-packet.md](../templates/handoff-packet.md). It names the job,
the folder, the objective, `ALLOWED_WRITES`, the acceptance checks and where
to write the receipt. Start the run with a one-line brief that points at the
file:

```sh
(
  set -C
  codex exec -s workspace-write -m "<build-model>" -C "<lane repo>" \
    --add-dir "$FLEET_ROOT/dispatch/receipts" \
    "Read AGENTS.md and $FLEET_ROOT/dispatch/inbox/<lane>/<JOB_ID>.md. Do only that job. Write the receipt it names." \
    < /dev/null > "$FLEET_ROOT/dispatch/receipts/<JOB_ID>-<attempt-id>.log" 2>&1
)
```

Replace every placeholder before running. Use a new attempt id and a new
receipt path in the work order for each attempt. The subshell refuses to
overwrite an existing log. Record the exit code and preserve failed logs.

`workspace-write` lets Codex write anywhere inside the `-C` folder, and
`--add-dir` adds the receipts folder. Leave `--add-dir` out when the lane repo
is the fleet root. `ALLOWED_WRITES` is a rule Codex follows, not a sandbox, so
check the diff against it before you accept the work. For a review, use the
read-only command in the bridge guide instead.

**GPT to Claude: a receipt or verdict file.** Codex finishes by writing the
receipt the work order named, or a review log ending in its `VERDICT` line.
Claude, HQ or the sweep read that file next. Claude checks the real artifact
(diff, test output, hash) before it accepts the work, never just the
receipt's word.

**Ownership moves in writing.** If Codex takes over a scope Claude held, or
gives it back, the receipt says who held it, who holds it now and from when.
One writer per scope, always.

**Each agent's private memory stays small.** Claude Code has its own memory
for the project and Codex keeps its own notes. Use those for stable facts and
lessons about how the person works, plus pointers to the state files. Keep the
live state in the shared folder, where both can see it.

To rehearse all of this once during setup, see phase 8 of the
[agent setup guide](AGENT-SETUP.md).

## What a new agent should read, in order

1. `AGENTS.md`
2. `memory/TODO.md`, top section first
3. The job card and work order for its job
4. The newest handoff or receipt for that job

Then stop reading and work. Do not reload every log and old handoff. They
are there to search when a question comes up.
