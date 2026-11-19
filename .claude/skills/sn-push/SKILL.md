---
name: sn-push
description: Upload local snsync changes to a ServiceNow instance: update existing records, create new records from folders, bulk-create, create Update Sets, delete records, or run watch mode. Use whenever the user wants to push, deploy, upload, send, apply, save to ServiceNow, "put this in dev", create a record, or create an Update Set. Enforces the rule that leviprod (production) is never written to, and that rule wins even if the user insists.
---

# Pushing to ServiceNow

A push writes to a live instance. That is why this skill starts with a guard and ends with a report.

## 0. Production guard (check this first, every time)

**`projects/leviprod` (levi.service-now.com) must never receive a push, watch, delete, flow modification, or Update Set creation.** Production changes in this setup go through the Update Set promotion process, never through direct REST writes. The CLI has no built-in protection, so this check is the only thing that prevents a production write.

Before running any write command, look at **both**:
- the `--project` value, and
- the target path (`--push <path>`, `--delete <path>`).

The tool walks up from the path to the nearest `.env`. A path under `projects/leviprod/` therefore reaches prod even when `--project` says levidev.

If either points at leviprod, **stop**. Tell the user that you can't push to prod, and offer the alternative: apply the same change in `projects/levidev` (copy the edited files over, pulling the dev record first if needed), push there, and let them promote it via Update Set.

The only exception is the one in CLAUDE.md: prod `rm_story`, `rm_scrum_task`, `change_request` and `change_task` records may be created or updated through the now-sdk alias `leviprod`, never through snsync. Every write needs the user's yes on the exact records and values.

## 1. Pick the target

- Default target: `projects/levidev`.
- `projects/leviaskhr` is writable, but confirm with the user before the first push to it in a session.
- Before running the command, say which environment and which Update Set the push will use.

## 2. Update Set

`--update-set` takes a name or a 32-character sys_id. If you leave it out, the tool falls back to `sn-config.json` → `updateSetSysId`, and failing that to the user's currently active Update Set on the instance. Pushing into the wrong Update Set is easy to do and annoying to untangle. If the user hasn't named one and the config has none, ask.

To create a new Update Set:
```bash
node snsync --create-update-set "Feature Name v1.0.0" --scope global --project projects/levidev
```

## 3. Push commands

Run from the repo root.

```bash
# Update one field file of an existing record
node snsync --push projects/levidev/src/<table>/<Record>/script.js --project projects/levidev --update-set "<US>"

# Push a whole record folder (all mapped field files)
node snsync --push projects/levidev/src/<table>/<Record> --project projects/levidev --update-set "<US>"

# Catalog item folder (item + variables + client scripts + flow.json)
node snsync --push projects/levidev/src/<Catalog_Item> --project projects/levidev --update-set "<US>"

# Create every new folder (no .sys_id) in one table / in all tables
node snsync --push --table <table> --project projects/levidev --update-set "<US>"
node snsync --push --all --project projects/levidev --update-set "<US>"
```

### Creating a new record
1. Make sure `<table>` is in `projects/levidev/sn-config.json` → `mapping`. See the `sn-pull` skill.
2. Create `projects/levidev/src/<table>/<Descriptive_Name>/`.
3. Add the field files named by the table's `ext` mapping (e.g. `script.js`). Add `_record.json` for other fields such as `name`, `active`, `api_name`, `client_callable`.
4. Push the folder. The tool POSTs the record and writes `.sys_id` locally, so later pushes update the record in place.

Create dependencies first. A table (`sys_db_object`) must exist before its columns (`sys_dictionary`).

## 4. Handling failures

- **Version conflict / collision:** someone changed the record on the server after your last pull. Don't force it. Pull the record (`--pull --target <file>`), re-apply the user's edit on top of the fresh copy, show the user if the server change overlaps theirs, and then push.
- **Published workflow blocked:** see the `sn-flow` skill (legacy workflow checkout).
- **`Table not found`:** add the mapping.
- **403/ACL errors:** the user lacks rights on that table or scope. Report it; don't retry.

## 5. Destructive and continuous commands

- `--delete <folder> --project projects/levidev [--force]` removes the record from the instance **and** deletes the local folder. Always confirm with the user first, and never run it on leviprod.
- `--watch --project projects/levidev` pushes on every save and runs until stopped. Start it only when the user asks, run it in the background, and never on leviprod.

## 6. Report

Afterwards, tell the user: the environment, the Update Set, each record created or updated (table + name), and any errors. Quote the error output; don't summarize it away.
