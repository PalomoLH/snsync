# CLAUDE.md

Guidance for Claude Code when working in this repository.

## 🛑 Hard rule: `leviprod` is READ-ONLY

**Never write to `projects/leviprod` (https://levi.service-now.com — production).** This is absolute, even if the user asks for it in the moment or a command "only touches one file".

- ✅ Allowed: `--pull` (all variants), `--open`, reading local files.
- ❌ Forbidden: `--push`, `--push --all`, `--watch`, `--delete`, `--modify-flow` (any operation other than `list`/`get`), `--create-update-set`, or any other command that writes to the instance.
- Check both the `--project` argument **and** the target path. A path under `projects/leviprod/...` resolves to prod even without `--project`, because the tool walks up to the nearest `.env`.
- To promote a change to prod: pull it from prod for reference, make and push the change in `levidev`, and let the user move it through their normal Update Set process.
- `.claude/hooks/sn-guard.cjs` (a PreToolUse hook) blocks snsync writes on leviprod and asks before any `now-sdk` write on the `leviprod` alias. It can't see ad-hoc scripts (`node -e`, axios, curl), so the rule still holds only if Claude follows it.

### The only exception: agile and change records (added by the user 2026-11-16)

Claude may create or update records in these four leviprod tables, and only these: `rm_story`, `rm_scrum_task`, `change_request`, `change_task`.
- **Route:** the now-sdk alias `leviprod`, signed in with the user's own OAuth login. Never use snsync or the Basic-auth integration user for this.
- **Confirm every write:** before each write, show the exact records and field values, then wait for the user's yes in chat. A yes covers only the writes it was given for.
- **No scripts on other tables:** a `now-sdk exec` script on leviprod may only touch those four tables. No other GlideRecord writes, events, or emails.
- **Everything else stays forbidden:** snsync writes of any kind, Update Sets, scripts, flows, catalog or config records, and data fixes on business tables (sys_user, u_stores, etc.). Those still go through levidev and the Update Set process, or the user runs them.

## 🔐 Shared integration user (team kit)

Projects that use Basic auth (`leviprod`, `levistaging`) ship in the team bundle with the team's **shared integration user**. Their `.env` holds `SNSYNC_SHARED_USER_SHA`, a hash of that user name.

- **Read-only.** Never write with the shared user, on any instance. The guard hook blocks snsync writes while the hash still matches `SN_USER`.
- **Say it every time.** Before or with each command that reaches an instance through the shared user, tell the user in chat: "Using the shared integration user (read-only) on <env>." The hook also shows a notice.
- **When a teammate switches to their own credentials,** they replace `SN_USER`/`SN_PASSWORD` in that `.env`. The hash stops matching, so the notice and lock go away. `leviprod` stays pull-only through snsync no matter whose login it is.
- **Never read secrets.** Don't `cat`, Read, grep or echo `projects/*/.env`, `.token_cache.json`, `team-private/` or a team bundle file. To set things up, run `team/setup.sh`, which prints paths only.

## What this repo is

**SNSync** is a Node.js CLI plus VS Code tasks. It syncs ServiceNow records (scripts, widgets, catalog items, flows, workflows…) with local files, so you can edit them in an editor, use git, and get AI help.

- Entry point: `./snsync` (repo root) → `_tool/bin/snsync.js` → `_tool/sn-sync.js` (all the logic).
- `_tool/flow-modifier.js`: encodes and decodes Flow Designer XML payloads.
- `_tool/create-project.js`: scaffolds a new project (environment).
- `_tool/templates/`: files copied into each new project (`sn-config.json`, AI rule files).
- `_tool/inspect*.js`, `_tool/fix-*.js`: one-off debug and repair scripts. They are not part of the CLI.
- Other docs: `README.md` (user guide), `AI_GUIDE.md`, `_tool/Docs/flow-modifier-usage.md`, `_tool/Docs/platform-analytics.md` (PA dashboards: tables, fields, push order).

Setup: `cd _tool && npm install` (Node 18+). OAuth tokens are cached in `.token_cache.json` and encrypted with `SN_ENC_SECRET`, which comes from the shell environment (`~/.zshrc`). If it is unset, tokens are saved as plain JSON.

New teammate? See `team/ONBOARDING.md`: `bash team/setup.sh --bundle <file> --pass-file <file>` installs everything, writes every `projects/<env>/.env` + `sn-config.json` from the encrypted team bundle, and imports the shared Claude memories. The owner rebuilds the bundle with `node team/build-bundle.cjs` (output in git-ignored `team-private/`).

## Environments (projects)

Each folder under `projects/` is one ServiceNow instance. `projects/*` is git-ignored because it holds customer data and credentials.

| Project | Instance | Auth | Writable? |
|---|---|---|---|
| `projects/levidev` | levidev.service-now.com | OAuth (browser) | ✅ Yes (default dev target) |
| `projects/leviaskhr` | leviaskhr.service-now.com | OAuth (browser) | ✅ Yes, but confirm with the user first |
| `projects/levitest` | levitest | OAuth (browser) | ⚠️ Confirm with the user first (promotion target; its MDM endpoint is the prod host) |
| `projects/levisandbox` | levisandbox | OAuth (browser) | ⚠️ Confirm with the user first |
| `projects/levistaging` | levistaging | Basic (shared integration user) | 🔐 Read-only while on the shared user |
| `projects/leviprod` | levi.service-now.com | Basic (shared integration user) | ❌ **Never via snsync. Pull only.** (Agile/change records only via now-sdk, see the exception above) |

Each project contains:
- `.env`: `SN_INSTANCE`, plus either `SN_CLIENT_ID`/`SN_CLIENT_SECRET` (OAuth) or `SN_USER`/`SN_PASSWORD` (Basic). **Never print, commit, or copy these values.**
- `sn-config.json`: table mappings (`mapping.<table>.filter/fields/ext/jsonExport/saveContext/onlyContext`) and an optional `updateSetSysId`.
- `src/<table>/<record_name>/`: pulled records.

**How the tool picks the environment:** `--project <path>` makes it `chdir` into that folder. It then walks up the directory tree (at most 5 levels) until it finds a `.env`, and that `.env` sets the instance. Every command must therefore point to exactly one project, and the target path decides which instance you hit.

Create a new environment with the VS Code task "SN: Create New Project" or with:
```bash
node _tool/create-project.js --name <folder> --instance https://x.service-now.com --auth-mode oauth --clientId <id> --clientSecret <secret>
```

## Local record layout

```
projects/<env>/src/<table>/<Record_Name>/
├── script.js / server.js / client.js / template.html …   # one file per mapped field (named by `ext`)
├── _record.json        # jsonExport fields / full payload (editable for non-script fields)
├── _ai_context.md      # optional tags for AI search
├── .sys_id             # links the folder to the record (do not edit)
├── .sys_updated_on     # used for collision detection (do not edit)
└── .wf_meta.json       # wf_activity only: variable-value routing (do not edit)
```

- Folder = record. No `.sys_id` means the next push **creates** the record.
- If a table is missing from `sn-config.json` → `mapping`, add it before you pull or push it.

## Skills: common operations

Detailed step-by-step skills live in `.claude/skills/`: `sn-pull`, `sn-push` (includes the leviprod guard), `sn-flow`, `sn-pa-dashboard` (Platform Analytics dashboards: spec + `pa-build.cjs`) and `sn-sdk` (now-sdk queries, background scripts, agile/change records). The summary below is the quick reference.

Run everything from the repo root.

### Pull (ServiceNow → local). Safe in every environment.
```bash
# Everything in sn-config.json (default filters = updated today)
node snsync --pull --project projects/<env> --context-action skip

# Specific table + encoded query
node snsync --pull --table sys_script_include --query "nameSTARTSWITHLevi" --project projects/<env> --context-action skip

# Refresh one record (surgical, uses its .sys_id)
node snsync --pull --target projects/<env>/src/<table>/<Record>/script.js --project projects/<env>

# Whole catalog item (item + variables + client scripts + flow/workflow)
node snsync --pull --catalog-item <sc_cat_item_sys_id> --project projects/<env>
```
Use `--context-action skip` (or `auto`) in non-interactive runs. The default, `prompt`, waits for stdin.

### Push (local → ServiceNow). Never for `leviprod`.
```bash
# Update one file / record
node snsync --push projects/levidev/src/<table>/<Record>/script.js --project projects/levidev --update-set "My Update Set"

# Create a new record: make the folder + files, then push the folder
node snsync --push projects/levidev/src/<table>/<NewRecord> --project projects/levidev --update-set "My Update Set"

# Create every new (no .sys_id) folder in a table / in all tables
node snsync --push --table <table> --project projects/levidev --update-set "..."
node snsync --push --all --project projects/levidev --update-set "..."
```
- `--update-set` takes a name or a sys_id. If you omit it, the push uses `sn-config.json` `updateSetSysId` or, failing that, the user's current active Update Set. Ask the user which Update Set to use if it isn't clear.
- Collision check: if the server copy changed after your pull, the push is rejected. Pull again, re-apply the change, then push.
- Before any push, say which environment and Update Set it targets.

### Other commands
```bash
node snsync --open <file> --project projects/<env>                      # open the record in the browser
node snsync --create-update-set "Feature v1.0.0" --scope global --project projects/levidev
node snsync --delete <record_folder> --project projects/levidev [--force]  # destructive: confirm with the user first
node snsync --watch --project projects/levidev                          # auto-push on save: never on leviprod
```

## How flows work

There are two automation engines, and the tool handles them differently.

### Flow Designer (`sys_hub_flow`)
- **Pulling the table** (`--table sys_hub_flow --query ...`) saves the record plus **`flow_map.json`**: a read-only map of the flow's nodes in order. Nodes come from `sys_hub_trigger_instance_v2` (trigger), `sys_hub_action_instance_v2` (action), `sys_hub_sub_flow_instance_v2` (subflow) and `sys_hub_flow_logic_instance_v2` (logic: if/for each). Labels come from `label_cache`. Use it to understand a flow. It is not pushed back.
- **Pulling a catalog item** with a flow attached writes `src/<CatalogItem>/flow/flow.json`. `_meta.sys_id` is the `sys_update_xml` record that holds the flow XML, and `_meta.flow_id` is the flow. `actions.<action_sys_id>.config` holds the **decoded** action inputs, e.g.:
  ```json
  "approval_conditions": "ApprovesRejectsAnyG[{{static.<group_sys_id>}}]"   // group approval
  "approval_conditions": "ApprovesRejectsAnyU[{{triggerref.request_for.manager}}]" // manager
  "approval_conditions": ""                                                  // skip approval
  ```
- **Pushing `flow.json`**: the tool fetches the current XML from `sys_update_xml`, re-encodes each action's `config` with `FlowModifier`, replaces it in the XML, and PUTs it back into the chosen Update Set.
- **Targeted edits without a local file** (`--modify-flow`): `--operation list|get` are read-only. `skip-approval|approval|modify` write to the instance.
  ```bash
  node snsync --modify-flow --flow-id <id> --operation list --project projects/<env>
  node snsync --modify-flow --flow-id <id> --action-id <id> --operation modify --param <p> --value <v> --project projects/levidev
  ```
- See `_tool/Docs/flow-modifier-usage.md` for details.

### Legacy Workflow (`wf_workflow` / `wf_activity`)
- A catalog item that uses a legacy workflow gets `flow/workflow.json`. **Pushing `workflow.json` is not supported.** Edit the individual `wf_activity` records instead.
- For "Run Script" and similar activities, `wf_activity.script` only holds a reference (`vars.var__m_<def>.script`). With `variableFields` set in the config, the pull resolves the real code from `sys_variable_value` into `script.js` and writes `.wf_meta.json`. The push then updates `sys_variable_value`, not `wf_activity`.
- Published workflow versions are read-only. With `workflowCheckout: true`, the push detects a published version and checks it out: it clones the version with its activities, transitions and variable values, then refreshes the local activity folders. If a push is blocked, re-pull after the checkout.

## Working conventions for Claude

- Default to `projects/levidev` for any change. Confirm before writing to `leviaskhr`. **Never write to `leviprod`.**
- Pull before editing, so that `.sys_updated_on` is fresh and the collision check works.
- Don't edit dotfiles (`.sys_id`, `.sys_updated_on`, `.wf_meta.json`) by hand.
- Don't commit anything under `projects/`, and never commit `.env` or `.token_cache.json`.
- `_tool/sn-sync.js` is one large file. Search it with grep before adding helpers, and follow its existing style (CommonJS, `snClient` axios instance, emoji-prefixed console logs).
