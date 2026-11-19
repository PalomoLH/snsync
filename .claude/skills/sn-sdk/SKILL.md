---
name: sn-sdk
description: Use the ServiceNow SDK CLI (now-sdk) next to snsync for Table API reads, background scripts with rollback, and agile/change records. Use whenever the user wants to query records, count or look up data on an instance, run a server-side script (fix script, data check, "run this in background scripts"), or create/update a story, scrum task, change request or change task, even if they don't name now-sdk.
---

# now-sdk alongside snsync

snsync owns **files** (scripts, widgets, catalog items, flows) and Update Set targeting. `now-sdk` owns **data and execution**: queries, background scripts, agile/change records. Edits to global config records stay in snsync.

## Aliases

| Alias | Instance | Use |
|---|---|---|
| `levidev` (default) | levidev | queries, `exec` scripts, anything dev |
| `leviprod` | levi (prod) | `query` freely; writes **only** to `rm_story`, `rm_scrum_task`, `change_request`, `change_task`, with the user's yes before each write |

Check what is configured: `now-sdk auth --list`. Missing alias → ask the user to run (it opens the browser, their own login):
```bash
now-sdk auth --add https://levidev.service-now.com --type oauth --alias levidev
now-sdk auth --use levidev
```

## Reads

```bash
now-sdk query <table> -q "<encoded query>" -f sys_id,number,short_description -a levidev
```
Prefer this over ad-hoc axios scripts. Reads are fine on every alias.

## Background scripts (`exec`)

```bash
now-sdk exec --file /path/to/script.js --scope global --reason "why" -a levidev
```
- Writes to the instance. Script Execution History keeps a rollback.
- On `leviprod` the guard hook (`.claude/hooks/sn-guard.cjs`) turns any non-query command into a confirmation prompt. Even so, show the exact records and field values in chat and wait for the user's yes first. Only the four agile/change tables are allowed.
- Keep scripts in the scratchpad, not in `projects/`.

## Gotchas

- `unable to get local issuer certificate` → Zscaler. `NODE_EXTRA_CA_CERTS=~/.certs/zscaler.pem` (set by `team/setup.sh`). See `sn-pull`.
- The SDK has no per-file push or Update Set targeting. Don't use it to deploy global records.
- `now-sdk` credentials live in the macOS keychain (`~/.now-sdk`). They can't be copied between machines; each person logs in.
