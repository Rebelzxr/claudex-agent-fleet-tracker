# Claude and Codex on one folder

Claude chats build. A second model, GPT through the Codex CLI, reviews. Both
work in the same local folder, so they see the same rules, job cards, receipts
and git state. This page shows how to wire that up and how the two hand work
to each other.

The direction matters. Claude can start Codex runs, through the plugin or the
shell. In this method, Codex reports back through files or PR comments that
Claude, HQ or the sweep read on their next pass.

## 1. One rules file for both

Codex reads `AGENTS.md` in the folder it starts in. Claude Code reads
`CLAUDE.md`. Keep the shared rules in `AGENTS.md` and make `CLAUDE.md` a thin
pointer that imports it:

```markdown
# CLAUDE.md
@AGENTS.md

Claude-only notes go here. Shared rules live in AGENTS.md.
```

Start from [templates/AGENTS.md](../templates/AGENTS.md). Put in it who builds,
who reviews, which actions always need a person, and the one-writer rule.

## 2. Install Codex and the Claude Code plugin

Install and log in to the Codex CLI:

```sh
npm install -g @openai/codex
codex login
```

In Claude Code, add OpenAI's Codex plugin:

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

`/codex:setup` checks that Codex is installed and logged in. After that you
have `/codex:review`, `/codex:adversarial-review`, `/codex:rescue`,
`/codex:status`, `/codex:result` and `/codex:cancel`, plus a
`codex:codex-rescue` subagent. The plugin's own README is the reference for
its flags. Its optional review gate runs a Codex review on every Claude stop.
It can loop and use up limits, so leave it off unless you are watching.

Codex usage counts against your own ChatGPT plan or API key. Check its terms
before you schedule anything.

## 3. Shell runs for scripted reviews

The plugin is the easy path inside a chat. For the sweep, the merge steward
or any scripted review, call `codex exec` from the shell so the command and
its log are on record:

```sh
codex exec -s read-only -c approval_policy="never" \
  -m <review-model> --skip-git-repo-check --ephemeral \
  -C "$FLEET_ROOT/<repo>" "<review brief>" < /dev/null > review.log 2>&1
```

- `< /dev/null` matters. Without it, a non-interactive run can sit on
  "Reading additional input from stdin" and never finish.
- Pass `-m` every time. Do not trust whatever default the config has today.
  Check the model line in the log header before you count the review.
- `-s read-only` with `approval_policy="never"` keeps a review from editing
  files. If a review log shows a write, treat the review as void.
- Run long reviews in the background and read the log when it exits. Do not
  poll the model in a loop.

Use your strongest model for reviews and a cheaper one for mechanical jobs
like extraction or reformatting. Never let the model that wrote the work be
the one that approves it.

## 4. The review contract

Give the reviewer the exact thing to judge: a commit SHA, a file and its
hash, or a work order with acceptance checks. Ask for one closing line:

```text
VERDICT: APPROVE <full sha>
VERDICT: REQUEST_CHANGES <full sha>
```

with exact fixes above a REQUEST_CHANGES. The
[merge steward](../scheduled-tasks/merge-steward/SKILL.md) only acts on an
APPROVE that names the current head SHA. Any new commit needs a new review.
Keep the review log next to the receipt, or post the verdict as a PR comment
with the full SHA.

For writing, ask for scores instead of a verdict, set a pass bar, and apply
the reviewer's exact replacement lines before you re-score.

## 5. Sharing one folder safely

Both agents can read everything. Only one may write each file scope.

- A job card names its owner. A Codex production job gets its own work order
  with `ALLOWED_WRITES`, and Claude reviews the result.
- When work crosses from one agent to the other, write the handover in the
  receipt: who held the scope, who holds it now, from when.
- Give Codex production work a branch made in advance, so its changes land
  in a reviewable diff, not on main.
- Codex reports back through files: a receipt in `dispatch/receipts/`, a
  review log, or a PR comment. HQ reads those; it never takes a chat's word
  for "done".

## 6. A first loop to try

1. Open HQ and one director, as in [Opening directors](OPENING-DIRECTORS.md).
2. Have the director make a small change on a branch and commit it.
3. Run the shell review from section 3. Its brief names the full current
   SHA and asks for exactly one closing line, `VERDICT: APPROVE <sha>` or
   `VERDICT: REQUEST_CHANGES <sha>`.
4. Fix what it asks for, commit, and review the new SHA again.

`/codex:review` is fine for quick feedback while you work. It does not take a
custom brief, so it cannot give the SHA-specific verdict this loop needs.
5. Merge only on an APPROVE for the exact head SHA, as a separate step.

Once that loop is boring, let the sweep and merge steward run it on a
schedule.
