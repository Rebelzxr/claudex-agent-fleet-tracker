# The operating method

## HQ and directors

HQ is a small dispatcher: read state, choose the next approved job, push its
packet, confirm pickup and route the result. It does not become the build,
research or repair chat. Each director owns a lane and runs bounded jobs with
Claude. Use a second model (e.g. GPT via Codex CLI) for independent review.
A producer cannot approve its own work. Review checks the actual artifact and
version, privacy, acceptance and failure paths, not the producer's story.

## Files are state

`memory/TODO.md` holds current outcomes and the next step. A card in
`dispatch/jobs/` holds id, title, lane, owner, session provenance, status, steps,
blocker, version, evidence and updated time. Receipts live in `dispatch/receipts/`.
A chat id is transport provenance, not a permanent owner. The reader only reads
cards and emits JSON; it does not enforce leases or mutate cards.

One writer owns each file scope. Before writing, read the current owner and lock,
accepted dependencies and work order. A lease names the scope, holder, start,
expiry and checkpoint. An expired lease needs an explicit handover after checking
for a running writer. Never steal a lock or overwrite another writer's work.
The example lock is documentation, not an automatic locking service.

## Packets, receipts and status

A [handoff](../templates/handoff-packet.md) names JOB_ID, target lane, target chat,
CWD, objective, allowed writes, acceptance, dependencies, evidence, owner,
lease, retry limit, next gate and stop condition. State whether a new chat may
be created. Keep private records out of model prompts and public repositories.
The named director must confirm pickup by beginning the scoped work or returning
a result. Inbox placement and a queued message are not proof of execution.

The [receipt](../templates/receipt.md) identifies the exact version, raw commands
and results, behavior checked, review verdict, unresolved gap and next action.
Use one final tag:

- `STATUS: VERIFIED (evidence: <raw output summary>)`
- `STATUS: UNVERIFIED (cannot test because <specific gap>)`
- `STATUS: BROKEN (failure: <gap>. Next step: <exact command>)`

Local checks, merged code, deployment and live behavior are distinct facts.
A green unit test is not evidence of an external outcome. Reuse evidence only
while the artifact and inputs are unchanged. Preserve receipts as history.

## Decision Desk

Use `memory/DECISIONS.md` as a small table: id, job, owner, why now, recommendation,
options, exact artifact/version, requested action, answer and answer time.
An entry moves from waiting to answered only after an explicit human answer.
HQ relays that answer word for word to the owner, records pickup and closes it.
A missing desk or unavailable tool means "desk not read", never implied consent.
A draft decision cannot approve itself. The board highlights blockers that begin
with `Human:`; writing that text is not authorization.

People retain public sends, publication, deploys, new spend, accounts, identity,
commercial decisions and destructive shared data changes unless exact existing
authority covers the named action. A schedule template grants no such authority.

## Sweep and merge steward

A twice-daily [sweep](../scheduled-tasks/hq-sweep/SKILL.md) checks due cards and
new receipts, stale active work, blockers, decisions and usage. Dedupe reminders
per card and day. Report only finished work, a real blocker or a needed decision.
Do not create an endless status relay. No changed input means no extra model run.

The [merge steward](../scheduled-tasks/merge-steward/SKILL.md) starts with a cheap
due check and exclusive lease. It needs explicit merge authority, current full
head review by a second model, green required checks and an unchanged clean head.
Hold sensitive policy, account, spend and release changes for the person.
Record merge, deploy and live checks separately. Never bypass branch protection.

## Rotation and machine gate

Around 300k context, finish the current atomic step and write a
[checkpoint](../templates/checkpoint.md). Start no new deep work. Save exact
scope, artifact version, evidence, lock holder and a runnable next step.
Depending on the person's policy, use `/compact` with that saved checkpoint,
or create a fresh chat with the same title, folder and group. Restore supported
remote control only if authorized. Update active routing only after the new
chat has read the checkpoint. Preserve old history and any running child work
before archiving; never archive a parent with an active nested worker.

Before pushing work, check system memory pressure, swap, running production
chats and budget. On macOS, `memory_pressure`, `sysctl vm.swapusage` and `uptime`
provide useful observations; on Linux use `free -h` and `swapon --show`.
Choose thresholds for your machine, such as at most two production chats and a
pause at sustained memory pressure or high swap. If these cannot be checked,
record that gap and avoid adding concurrency. Wait for capacity; do not build a
second scheduler to work around it. Keep a bounded session time box, checkpoint
when it expires, and avoid waking a cold large chat for a trivial status request.

Set a daily usage allowance in your private charter. Read the plan's measured
usage at the sweep, compare with the allowance and defer optional work when over.
Unknown usage stays unknown. API-equivalent dollar estimates are not invoices.
This starter omits the private transcript ledger and exports no cost history.
