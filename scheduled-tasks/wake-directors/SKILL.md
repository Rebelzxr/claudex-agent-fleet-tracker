---
name: wake-directors
description: Template for a deduplicated director wake after a machine restart.
---

Inert template. Configure <FLEET_ROOT>, <HQ_SESSION_ID>, the approved director
registry, run times and internal message/remote control authority before use.

1. Compare the current boot marker with dispatch/locks/last-boot-woken.txt. An
   unchanged boot is a deterministic no-op: no model call or message.
2. If uptime is under five minutes, stop and leave the marker unchanged. Check
   machine capacity and usage. Never force a busy machine to start more work.
3. Resolve only the configured active directors through supported session tools.
   Do not wake archived chats or guess ids from titles. Ambiguous matches need
   resolution before any push. A running director gets no duplicate work prompt.
4. With exact internal message authority, send each idle approved director once:
   "Machine restarted. Read your current card and receipt; continue only work
   that is due and authorized. No reply needed."
5. Restore remote control only when separately authorized and supported. If a
   tool fails, make one bounded correction, save the missing capability and stop
   that target. Record successful targets for this boot before another attempt on failures.
6. Write the boot marker only after all required targets succeed; preserve a
   partial per-target record so a retry cannot repeat a successful wake. Report
   only a real blocker or needed decision to the configured HQ route.

Do not create chats, change accounts, restart apps, alter schedules or send
public messages from this template. End with the receipt's STATUS tag.
