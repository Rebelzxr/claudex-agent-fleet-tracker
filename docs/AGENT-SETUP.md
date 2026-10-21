# Agent setup guide

This page is written for the AI agent that sets the fleet up for you: a Claude
Code chat, or GPT through the Codex CLI. Hand it this file and let it work
through the phases in order. You stay in the loop for logins, accounts,
schedules, sends, spending and merges.

There are two finish lines. Phases 0 to 8 give you a **working manual fleet**:
HQ, one director, the board, a reviewed change, logs and a rehearsed handoff.
Phases 9 and 10 **activate automation**, and only for the schedules you approve.
Most people should run the manual fleet for a week before phase 9.

## Paste this to your agent

```text
Set up this fleet in a separate private workspace using docs/AGENT-SETUP.md.
Work through the phases in order. Inspect existing configuration before
changing it. Complete authorized reversible local steps, preserve existing
files, and record evidence after each phase in $FLEET_ROOT/setup/SETUP-RECEIPT.md.
Ask me only for missing material choices or actions outside recorded authority.
Never invent host commands, session references, permissions or successful
checks. If a capability is missing, mark that component and keep going with
the rest.
```

## How to run each phase

Every phase below lists:

- **Needs**: inputs that must exist before you start.
- **Writes**: the only paths the phase may create or change.
- **Do**: commands or host steps.
- **Check**: what must be true before the next phase.
- **Stop and ask**: points where the person decides.

After each phase, append a short entry to `$FLEET_ROOT/setup/SETUP-RECEIPT.md`
(form at the end of this page) with the commands you ran, their raw result and
one status word per component:

| Status | Meaning |
| --- | --- |
| verified | exercised for real, with the output saved |
| manual | works, but a person does this step by hand |
| unsupported | this host or build cannot do it |
| blocked | waiting on a named person or capability |
| disabled | deliberately left off |

**Resuming.** Read the setup receipt and current job, lease and evidence
first. Record the last completed phase and the next unfinished action.
Recheck that completed components still work in their current state; do not
recreate their original setup state. For example, after jobs exist, phase 2
checks the recorded root and required directories, not an empty board; after
the test decision is answered, phase 4 checks the recorded answer and pickup,
not a blank answer.

For a partially completed phase, reconcile existing files and perform only its
missing authorized steps. Never reset cards or decisions, replace history,
create duplicate chats or repeat dispatches merely to replay a phase. Confirm
current ownership before any write.

**Who can do what.** A GPT agent in the Codex CLI can do phases 0 to 4, 7 and
the file parts of 8 from the shell. Phases 5, 6 and the chat parts of 8 need
Claude Code chats. A person opens those, or a Claude chat with a session tool
does. Codex does not open Claude chats in this method.

## Phase 0. Inputs and capabilities

**Needs:** the person, for the choices below.
**Writes:** nothing yet (the receipt starts in phase 2).

Collect and note:

- the private fleet root, for example `$HOME/fleet`, outside this checkout
- the first lane and its real working folder
- who builds (Claude) and which model reviews (for example GPT through Codex)
- how many chats may do production work at once on this machine
- whether any automation is wanted later, and which
- existing rule files (`AGENTS.md`, `CLAUDE.md`) and hooks in the lane folder

Check the tools that exist, without installing anything:

```sh
python3 --version
git --version
claude --version
claude plugin --help
codex --version
```

A missing tool becomes `unsupported` or `blocked` for the components that need
it. Python 3.9+ and Git are required; everything else is optional per phase.

**Stop and ask:** account creation, logins, new plans or billing, and any lane
or limit choice the person has not given.

## Phase 1. Verify the source and look at the demo

**Needs:** a fresh clone of this repo.
**Writes:** nothing outside the clone.

```sh
export FLEET_ROOT=example
python3 scripts/fleet_board.py | python3 -m json.tool
bash scripts/privacy_scan.sh
python3 -B -m unittest discover -s tests -v
```

**Check:** four jobs (website, content, seo, ops), an empty `errors` list, the
privacy scan passes and the tests pass. Read `example/` to learn the card,
receipt, lock and TODO shapes. These files are synthetic. Never count their
receipts or locks as real evidence.

## Phase 2. Create the private fleet

**Needs:** the fleet root from phase 0.
**Writes:** the fleet root only.

Stop if the root already has files. Ask before touching an existing fleet.

```sh
export FLEET_ROOT="<absolute private fleet root chosen in phase 0>"
[ -e "$FLEET_ROOT" ] && ls -A "$FLEET_ROOT"
```

If that printed nothing, create an empty fleet:

```sh
mkdir -p "$FLEET_ROOT"/dispatch/jobs "$FLEET_ROOT"/dispatch/inbox \
  "$FLEET_ROOT"/dispatch/locks "$FLEET_ROOT"/dispatch/receipts \
  "$FLEET_ROOT"/memory/daily-logs "$FLEET_ROOT"/memory/session-handoffs \
  "$FLEET_ROOT"/setup
cp -n templates/AGENTS.md "$FLEET_ROOT"/AGENTS.md
```

Then write two starter files by hand, using the example files as the shape:

- `memory/TODO.md`: a `Context for next session` section of eight short lines
  ("New fleet. No jobs yet. No schedules active. Next: phase 3 of
  docs/AGENT-SETUP.md.") and an empty job table.
- `memory/DECISIONS.md`: the Decision Desk header and an empty table with the
  same columns as `example/memory/DECISIONS.md`.

Do not copy the example job cards, receipts or lock into a real fleet.

```sh
python3 scripts/fleet_board.py --root "$FLEET_ROOT"
```

**Check:** `"jobs": []` and `"errors": []`. Use this absolute `FLEET_ROOT` in
every later command, including new shells.

## Phase 3. Shared rules and guards

**Needs:** the lane folder and its existing rule files.
**Writes:** `AGENTS.md` and `CLAUDE.md` where each agent starts.

Codex reads `AGENTS.md`. Claude Code reads `CLAUDE.md`, which can import it
with a line that reads @AGENTS.md. Put the shared rules where each agent
starts its work: the fleet root and each lane folder. If a lane folder
already has rule files, merge the fleet rules in and keep every existing rule.
See
[Claude and Codex on one folder](CLAUDE-CODEX-BRIDGE.md), section 1.

Read [templates/AGENTS.md](../templates/AGENTS.md) with the person and fill in
who builds, who reviews and what always needs a person.

In every installed rules file, record the literal absolute fleet root and this
checkout's absolute path. Resolve shared TODO, decision, job, lease, receipt,
log and handoff paths against the fleet root. Replace template references with
literal absolute paths into this checkout, including `templates/daily-log.md`,
`templates/checkpoint.md` and `templates/receipt.md`. Do not assume a lane
folder contains fleet state or that Markdown expands environment variables.

**Check:** from each agent's starting folder, open the resolved shared state
files and all three templates. Fix missing or ambiguous paths before
dispatching work.

**Guards are separate from rules.** A rules file asks; a hook or permission
setting enforces. If the person uses the base kit
[ai-work-os](https://github.com/Rebelzxr/ai-work-os), follow its README for its
hooks. Record which guard is active, or `disabled` if none. Never test a guard
by running a destructive command. Inspect the hook or settings file instead.

**Check:** in a fresh Claude chat in the lane folder, ask it to quote the
one-writer rule. For Codex:

```sh
codex exec -s read-only -c approval_policy="never" -m <review-model> \
  --skip-git-repo-check -C "<lane folder>" "Quote the first line of the shared rules you loaded. Do not edit anything." \
  < /dev/null
```

Both should quote your rules. Record the output.

**Stop and ask:** any change that loosens permissions, trusts a folder, or
removes an existing rule.

## Phase 4. Ownership, limits, decisions and memory

**Needs:** phases 2 and 3.
**Writes:** the fleet root only.

1. **Limits.** Write the machine gate into `memory/TODO.md` or the HQ charter:
   the most chats doing production at once, a time box per job, and where usage
   is read from. If usage cannot be measured, write "unknown" and do not add
   chats on the strength of it. See [METHOD.md](METHOD.md).
2. **One pilot job.** Create `dispatch/jobs/<LANE>-PILOT.json` in the shape of
   `example/dispatch/jobs/WEB-PILOT.json`: real lane, owner, a `scope` with the
   exact folder it may write, three small steps, status `active`, an `updated`
   time with a UTC offset, and `session` left as a placeholder until phase 5.
   Write its work order from [handoff-packet.md](../templates/handoff-packet.md)
   in `dispatch/inbox/<lane>/`.
3. **Shared TODO.** Decide who may edit `memory/TODO.md`. A simple rule: each
   director edits only its own lane's row, HQ edits the top section.
4. **Decision Desk.** Add one harmless test row to `memory/DECISIONS.md` and
   leave the answer blank. A blank answer authorizes nothing.
5. **Memory routine.** Read [Memory, logs and handoffs](MEMORY-AND-HANDOFF.md).
   Confirm `AGENTS.md` has the "log session" and checkpoint lines from the
   template, so every agent logs and hands off the same way.

**Check:** the board shows the pilot job with no errors. No two cards claim the
same scope. The test decision is still pending.

## Phase 5. Open HQ and one director

**Needs:** Claude Code, the HQ and director charters, the pilot work order.
**Writes:** the pilot card's `session` field and the inbox.

Follow [Opening directors](OPENING-DIRECTORS.md):

1. Open an HQ chat and paste [hq-charter.md](../templates/hq-charter.md) with
   every field filled.
2. Open a director chat in the lane folder and paste
   [director-charter.md](../templates/director-charter.md) filled for that lane.
3. Record the director's real session reference in the card's `session` field.
   Never guess one. If the host has no way to show it, write `manual` and route
   by pasting.
4. If the pilot changes code, create its branch in the lane repo now and name
   it in the work order, so the director never starts on main.
5. Send the work order path to the director with a supported session tool, or
   paste it in yourself.

**Check:** the director replies with its scope and starts step 1. HQ records
that pickup. A message placed in an inbox, or a queued send, is not pickup.

## Phase 6. The board

**Needs:** phase 5 and the pilot card.
**Writes:** environment settings for the mod, if used.

Start with the JSON reader against the private fleet:

```sh
python3 scripts/fleet_board.py --root "$FLEET_ROOT" | python3 -m json.tool
```

If the Claude Code build supports local mods and panes, follow
[Board setup](BOARD.md) from this checkout. Keep `FLEET_ROOT` set to the
private root recorded in your setup receipt; do not copy BOARD.md's
example-root assignment. Set `FLEET_BOARD_SCRIPT` to this checkout's absolute
script path. Then run `/board-hq` in HQ and `/board`.
**Check:** the pane shows your private pilot card, refreshes, opens job
details and jumps to the lane.

If the build lacks mod support, mark the pane `unsupported` and keep the JSON
reader. Mocked tests passing does not mean the desktop pane works.

**Stop and ask:** adding a marketplace or installing a plugin account-wide.

## Phase 7. A reviewed change, Claude to GPT

**Needs:** Codex installed and logged in (the person logs in), a git repo for
the lane.
**Writes:** a branch in the lane repo and a private review log.

1. The director makes the pilot change on a new branch and commits it.
2. Run the read-only review from
   [the bridge guide](CLAUDE-CODEX-BRIDGE.md), section 3. The brief names the
   full commit SHA and asks for one closing line, `VERDICT: APPROVE <sha>` or
   `VERDICT: REQUEST_CHANGES <sha>`.
3. Save the log in a private place, one file per SHA, for example
   `$FLEET_ROOT/dispatch/receipts/<JOB_ID>-review-<short sha>.log`.

**Check:** the log header shows the model you asked for, the run exited 0, the
reviewed SHA is still the branch head, and the verdict names it. On
REQUEST_CHANGES, fix, commit and review the new SHA. Stop after three rounds
and ask the person.

Review logs can hold local paths and session details. Keep them out of public
repos and posts.

**Stop and ask:** pushing, posting a PR comment, merging or releasing.

## Phase 8. Decisions, logging and a chat handoff

**Needs:** phases 5 to 7.
**Writes:** the fleet root only.

1. **Decision.** The person answers the test row in `memory/DECISIONS.md`. HQ
   relays the answer word for word to the owning director and records pickup.
   Check that nothing acted before the answer existed.
2. **Log.** The director writes today's entry in `memory/daily-logs/<date>.md`
   from [templates/daily-log.md](../templates/daily-log.md) and updates its TODO
   row. Compare with `example/memory/daily-logs/2026-01-02.md`.
3. **Handoff.** The director writes
   `memory/session-handoffs/<date>-<lane>.md` from
   [templates/checkpoint.md](../templates/checkpoint.md). Open a new director
   chat with one line: "Read `<handoff file>` and `AGENTS.md`, then continue as
   `<LANE>` director." Update the card's `session` field to the new chat.
4. **GPT pickup.** Give Codex the same handoff in a read-only run and ask it to
   state the job, the owner, the allowed writes and the next command. This
   proves the files alone carry the state across models.

**Check:** the new chat and the Codex run both state the same job, scope and
next step as the files. The old chat is archived only after the new one has
picked up and no worker is still running under it.

This is the **working manual fleet**. Write the setup receipt now (phase 11)
even if you stop here.

## Phase 9. Prepare schedules, disabled

**Needs:** a week of manual running is a good idea, and the person's go.
**Writes:** copies of the task templates, left disabled.

Fill copies of [hq-sweep](../scheduled-tasks/hq-sweep/SKILL.md),
[wake-directors](../scheduled-tasks/wake-directors/SKILL.md) and
[merge-steward](../scheduled-tasks/merge-steward/SKILL.md) with the real root,
recipients, timezone, run times, limits and where each records its last run.

Know what this repo does not ship:

- **No due check script.** The sweep says to skip the model call when nothing
  changed. That needs a small deterministic check you write and test yourself.
  Without one, each run costs a model call. Record that as the person's choice.
- **No scheduler.** Use the host's documented scheduled tasks or the OS
  scheduler. Record which one, and how to disable it.
- **No merge automation.** The steward template needs the repo's required
  checks, an allow list of repos and the verdict format before it can run.

**Check:** with nothing changed, a dry run does nothing. A locked scope, an
unapproved action or a review of an older SHA is refused. If you cannot show
these, leave the task `disabled` and name what is missing.

## Phase 10. Turn on approved automation

**Needs:** the person's explicit yes for each named task.
**Writes:** the scheduler entry for that task only.

Show the person the exact task config and the command that disables it. Enable
only what they approve, sweep first. Merge authority is a separate yes.

**Check:** read back the registration, then wait for one real run and read its
receipt. Creating a task is not proof it ran. Never merge real code just to
test the steward.

## Phase 11. The setup receipt

Finish `$FLEET_ROOT/setup/SETUP-RECEIPT.md`:

```text
# Fleet setup receipt
Date and source: <date>, claudex-agent-fleet-tracker <commit sha>
Fleet root: <path>
Lanes and folders: <lane: folder>
Tools: python <v>, git <v>, claude <v>, codex <v or none>
Build and review models: <build>, <review>
Components:
- private fleet: <status>
- shared rules (Claude / Codex): <status> / <status>
- guards: <status, which>
- HQ and director chats: <status>
- board JSON / board pane: <status> / <status>
- review loop: <status, log path>
- decisions, logs, handoff: <status>
- sweep / wake / steward: <status> / <status> / <status>
Active schedules and how to disable each: <list or none>
Authority on record: <what the person approved, when, exact scope>
Gaps: <what is missing, who unblocks it>
Next command: <one runnable step>
```

Claim "set up" only for components marked verified or manual. List the rest.

## Never automate these

- logins, identity checks, or entering credentials for the person
- reading consent from silence or an unanswered decision
- guessing a session id or a message recipient
- getting around permission guards or branch protection
- taking a lease that another chat holds, or one that is unclear
- the same model writing and approving a change
- reusing an approval after the artifact changed
- publishing private logs, receipts or review output
- archiving a chat that still has running workers

Sends, spending, schedules and merges run only inside authority the person has
written down. Setup itself never creates that authority.
