---
name: hq-sweep
description: Template for a quiet twice-daily file queue and decision sweep.
---

This is an inert template. A person must configure two local run times, the root,
allowed session tools, recipients and notification authority before activation.
Root: <FLEET_ROOT>. HQ: <HQ_SESSION_ID>. Usage allowance: <DAILY_ALLOWANCE>.

1. Run a deterministic due/changed-input check using the saved last-run marker.
   If nothing is due or changed, stop without a model call or status message.
   Check the machine gate and writer leases before pushing any work.
2. Read current TODO, job cards and only new named receipts. Flag an active card
   older than 48 hours, a blocked card with no reason or a depleted approved
   queue. A stale timestamp is a prompt to inspect, not proof of failed work.
3. With existing internal-message authority, push the card's owning director
   once with its id, stated issue and next step. Record the push time; never
   repeat the same card's reminder within 24 hours. If the target cannot be
   resolved, save a pending handoff and report that capability gap once.
4. Read measured plan usage and compare with the daily allowance. Unknown usage
   stays unknown. Over allowance, defer optional jobs; never buy more usage.
5. Read memory/DECISIONS.md. Relay only newly answered decisions word for word
   to their owning director, with the exact artifact and action scope. Record
   pickup before closing the entry. No answer means no authorization. If the
   desk or its supported tool is unavailable, state "Decision Desk not read".
6. Check whether feedback was recorded in the owning job's checklist or runbook.
   Propose a missing rule change for human review; never rewrite core authority.
7. Update the sweep marker, relevant cards and TODO only when state changes.
   Return one compact finished, blocked or decision-needed result to
   <HQ_SESSION_ID> through the configured internal route. Never send publicly.

End with a STATUS tag backed by the receipt. Installing this file grants no
message, spend, release, merge or account authority.
