# Open the first director

1. Pick one lane, such as website. Read `memory/TODO.md` under `$FLEET_ROOT` and
   confirm no other chat holds the same file scope. Check the machine gate in
   [METHOD.md](METHOD.md) before adding work.
2. In Claude Code, open a new chat in the lane's actual working folder. Use a
   clear title such as `WEBSITE DIRECTOR`. Leave unrelated chats alone.
3. Paste [director-charter.md](../templates/director-charter.md). Fill every angle
   bracket field with your own local values, scope and permissions. Select Claude
   for production and name a second model for review. Do not paste private records.
4. Record the new chat's actual session reference in a private card's `session`
   field, with lane, owner, scope and UTC-offset `updated` time. Example cards use
   `<WEBSITE_SESSION_ID>` rather than real ids. A card registers a director for
   this starter's board; there is no separate hidden session registry.
5. In HQ, use `/board-hq` then `/board` if the mod is available. The lane appears
   when its first job card exists. The JSON command can verify the same card
   without the mod. It does not open a chat or route messages for you.
6. Fill [handoff-packet.md](../templates/handoff-packet.md) and put it in the lane's
   inbox. Push its path and scope through the app's supported session tool, or
   paste it into the director yourself. Do not guess a recipient id. Confirm
   pickup from actual work or a returned result, not just a queued send.
7. The director records its lease, does the scoped work, runs acceptance checks,
   writes the receipt and updates its card and TODO. It returns only finished,
   blocked or decision-needed outcomes to HQ.
8. HQ routes independent review of the exact version, then the human decision
   if one is needed. Transfer the writer lease explicitly before another chat
   changes the same files. A receipt is not public release approval.

Try the sample website work order before adding a second director. If a path is
wrong, fix the local card/config once and rerun. If a chat or tool is unavailable,
keep the packet pending and record the exact missing capability.
