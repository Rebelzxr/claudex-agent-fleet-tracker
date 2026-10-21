# <JOB_ID> receipt

Owner and lease: <SCOPE_HOLDER_HANDOVER>
Checked artifact/version: <PATH_AND_COMMIT_OR_HASH>
Outcome: <OBSERVED_RESULT>

```text
<EXACT_COMMAND>
<RAW_RESULT_AND_EXIT_CODE>
```

Behavior and failure paths checked: <CHECKS>
Independent reviewer/version/verdict: <REVIEW_EVIDENCE_OR_PENDING>
Remaining gap: <SPECIFIC_GAP_OR_NONE>
Remaining gate: <EXACT_ACTION_AND_OWNER>
Next action: <RUNNABLE_STEP>

Choose exactly one final line and remove the other two:
STATUS: VERIFIED (evidence: <raw output summary>)
STATUS: UNVERIFIED (cannot test because <specific gap>)
STATUS: BROKEN (failure: <gap>. Next step: <exact command>)
