# Shared fleet rules

- Read the current TODO, work order, card, receipt and lease before work.
- One accountable owner and one writer per file scope. Never steal a lease.
- HQ routes work. Directors produce bounded artifacts with Claude.
- Every job has exact inputs, allowed writes, acceptance and a stop condition.
- Keep private records and credentials out of model prompts and public files.
- Use a second model (e.g. GPT via Codex CLI) to review the exact version.
- Check machine capacity and usage before adding production work.
- A person retains public actions, new spend, account changes and destructive
  shared data actions unless exact current authorization covers the action.
- No bypass of permission guards or protected branches. Silence is not consent.
- Save raw checks, gaps and a runnable next step in the receipt; update TODO.
- On "log session" or at the end of real work, append to
  memory/daily-logs/<date>.md (templates/daily-log.md). Trivial chats write nothing.
- Before stopping mid-job or near the context limit, write
  memory/session-handoffs/<date>-<lane>.md (templates/checkpoint.md).
- State lives in files. A new chat or model trusts the files over any summary.
- End with exactly one STATUS tag from the receipt template.
