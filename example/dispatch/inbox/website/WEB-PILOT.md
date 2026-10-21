# Synthetic website pilot

JOB_ID: WEB-PILOT
TARGET_DEPARTMENT: website
TARGET_TASK: <WEBSITE_SESSION_ID>
CWD: <FLEET_ROOT>
OBJECTIVE: prepare one local static page plan using synthetic copy.
ALLOWED_WRITES:
- <FLEET_ROOT>/website-pilot/
INPUTS: memory/TODO.md and dispatch/jobs/WEB-PILOT.json
ACCEPTANCE: one page plan, local content check and receipt with exact version.
DEPENDENCIES: none
EVIDENCE: dispatch/receipts/WEB-PILOT.md
CURRENT_OWNER: Website director
LEASE: dispatch/locks/WEB-PILOT.lock.json (example only; acquire a real lease first)
PROVENANCE: <HQ_SESSION_ID>
RETRY_LIMIT: 2
CREATE_NEW_TASK: NO
NEXT_GATE: second model review
STOP_CONDITIONS: out-of-scope write, private input, missing authority or check failure.

This is sample data, not an instruction to start a production job. No public
action, deployment, message or spend is authorized.
