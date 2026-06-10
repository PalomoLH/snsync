# Workflow Activity Sync Guide

SNSync supports the **Legacy Workflow Engine** (`wf_activity`) with scripts stored in `sys_variable_value`, auto-checkout of published workflows, and transition map snapshots.

---

## Prerequisites

### 1. Install the SNSync Scripted REST API (one-time per instance)

ServiceNow has two hard limitations that make pure REST API workflow support impossible:

| Problem | Root cause | Solution |
|---|---|---|
| `wf_transition` inserts get `from`/`to` reverted | Business rule "Update workflow version" normalises refs back to published version | `gr.setWorkflow(false)` — server-side only |
| `sys_variable_value` POST returns 403 | ACL blocks INSERT via REST | Server-side GlideRecord bypasses ACL |

SNSync ships a **Scripted REST API** that runs these operations server-side. Install it once:

```bash
node _tool/sn-sync.js --install-endpoint --project projects/your-project
```

This creates `SNSync Workflow Utilities` at `/api/snsync/v1` on your instance with two resources:

| Resource | Method | Path | Purpose |
|---|---|---|---|
| `finalize_clone` | POST | `/api/snsync/v1/workflow/finalize_clone` | Clone transitions + variable values after checkout |
| `variable_value` | POST | `/api/snsync/v1/workflow/variable_value` | Create/update a `sys_variable_value` record |

> **Required role for the endpoint caller:** `admin`, `web_service_admin`, or `snc_internal`.

---

### 2. Configure `wf_activity` in `sn-config.json`

```json
"wf_activity": {
  "filter": "sys_idISNOTEMPTY",
  "fields": ["name", "description"],
  "ext": { "description": "txt" },
  "variableScript": "script",
  "workflowCheckout": true,
  "saveContext": true
}
```

| Option | Effect |
|---|---|
| `variableScript: "script"` | Reads/writes the script field from `sys_variable_value` instead of directly on the activity record |
| `workflowCheckout: true` | Triggers auto-checkout when pushing to a published (read-only) workflow version |

---

## Local Folder Structure

```
src/
└── wf_activity/
    ├── _wf_transitions.json        ← transition map (auto-saved on pull, read-only)
    ├── My_Run_Script_Activity/
    │   ├── .sys_id                 ← activity sys_id (auto-updated after checkout)
    │   ├── .sys_updated_on         ← collision protection timestamp
    │   ├── .wf_meta.json           ← workflow version + variable_values routing
    │   └── script.js               ← the Run Script code (from sys_variable_value)
    └── Another_Activity/
        └── ...
```

### `.wf_meta.json` explained

```json
{
  "workflow_version": "00d7699987c1b6905668c88d0ebb3522",
  "variable_values": {
    "script": { "sys_id": "94d72d9987c1b6905668c88d0ebb35e4" }
  }
}
```

- `workflow_version` — the version this activity belongs to. If it's **published** (read-only), SNSync auto-checkouts a fresh draft.
- `variable_values.script.sys_id` — the `sys_variable_value` record to PUT the script content into.

---

## Pulling Activities

Pull all activities + scripts from a specific workflow version:

```bash
node _tool/sn-sync.js --pull \
  --table wf_activity \
  --query "workflow_version=<version_sys_id>" \
  --project projects/levidev
```

This will:
1. Download each activity and resolve its `script.js` from `sys_variable_value`
2. Write `.wf_meta.json` per activity with routing info for push
3. Save `_wf_transitions.json` at the table level with the full transition map

---

## Pushing Activity Scripts

```bash
# Push a single script
node _tool/sn-sync.js --push src/wf_activity/My_Activity/script.js \
  --project projects/levidev

# Push all scripts in the table folder
node _tool/sn-sync.js --push src/wf_activity --project projects/levidev
```

### Auto-checkout flow

When pushing to a **published** workflow (`.wf_meta.json → workflow_version` is published):

```
Push script.js
  └─ Detect published = true
      └─ POST wf_workflow_version  (new draft, REST API)
          └─ Clone wf_activity records  (REST API)
              └─ POST /api/snsync/v1/workflow/finalize_clone
                  ├─ Clone wf_transition  (server-side, setWorkflow=false)
                  └─ Clone sys_variable_value  (server-side, ACL bypass)
                      └─ Refresh local .wf_meta.json + .sys_id files
                          └─ PUT script.js → new activity's sys_variable_value
```

---

## Transition Map (`_wf_transitions.json`)

Automatically saved when you pull `wf_activity` with a `workflow_version` filter. **Read-only** — not pushed to ServiceNow.

```json
{
  "_meta": {
    "workflow_version": "6bdce94f87594710315e86a5dabb35e3",
    "generated_at": "2026-06-10T14:00:00.000Z",
    "total": 17
  },
  "transitions": [
    {
      "sys_id": "b7bd3a0f87158710315e86a5dabb354a",
      "from": "Begin",
      "from_sys_id": "c0d7699987c1b6905668c88d0ebb3528",
      "to": "If Unique Portal Request",
      "to_sys_id": "d8eca5cbc3950710759738ec0501317b",
      "condition": "Always"
    }
  ]
}
```

Use this file to:
- Audit which activities are connected after a checkout
- Diagnose broken connections in the Workflow Editor
- Document your workflow's routing logic in git

---

## REST Endpoint Reference

### `POST /api/snsync/v1/workflow/finalize_clone`

Called automatically by `checkoutWorkflow` after cloning activities.

**Request body:**
```json
{
  "old_version_id": "published_version_sys_id",
  "new_version_id": "checkout_version_sys_id",
  "act_id_map": { "old_act_sys_id": "new_act_sys_id" }
}
```
`act_id_map` is optional — if omitted, the server rebuilds it by matching activity names.

**Response:**
```json
{
  "act_id_map": { "...": "..." },
  "transitions_created": 17,
  "transitions_skipped": 0,
  "variable_values_created": 4
}
```

### `POST /api/snsync/v1/workflow/variable_value`

Used when pushing a script for a new activity that has no existing `sys_variable_value`.

**Request body:**
```json
{
  "document": "wf_activity",
  "document_key": "activity_sys_id",
  "variable": "variable_def_sys_id",
  "value": "your script content here"
}
```

**Response:**
```json
{ "sys_id": "...", "created": true }
```

---

## Troubleshooting

### "SNSync endpoint not installed" warning during checkout

Run `--install-endpoint` once, then re-push. The checkout will retry automatically on the next push.

### Transitions broken in Workflow Editor after checkout

If the endpoint was not installed during a previous checkout, transitions were not cloned. To fix existing broken transitions, run the following Background Script in ServiceNow (System Definition → Scripts - Background):

```javascript
// Fix transitions for a checkout version
// Replace OLD_VERSION and NEW_VERSION with actual sys_ids
var OLD_VERSION = '<published_version_sys_id>';
var NEW_VERSION = '<checkout_version_sys_id>';

// Build activity id map (old → new) by name
var oldNameToId = {}, newNameToId = {}, actIdMap = {};
var gr = new GlideRecord('wf_activity');
gr.addQuery('workflow_version', OLD_VERSION);
gr.query();
while (gr.next()) oldNameToId[gr.name.toString()] = gr.sys_id.toString();

gr = new GlideRecord('wf_activity');
gr.addQuery('workflow_version', NEW_VERSION);
gr.query();
while (gr.next()) {
    var n = gr.name.toString();
    if (oldNameToId[n]) actIdMap[oldNameToId[n]] = gr.sys_id.toString();
}
gs.info('Activity map: ' + Object.keys(actIdMap).length + ' entries');

// Fix transitions: update from/to with setWorkflow(false)
var updated = 0, skipped = 0;
gr = new GlideRecord('wf_transition');
gr.addQuery('from.workflow_version', OLD_VERSION);
gr.query();
while (gr.next()) {
    var newFrom = actIdMap[gr.from.toString()];
    var newTo = actIdMap[gr.to.toString()];
    if (!newFrom) { skipped++; continue; }
    gr.from = newFrom;
    if (newTo) gr.to = newTo;
    gr.setWorkflow(false);
    gr.update();
    updated++;
}
gs.info('Fixed transitions: ' + updated + ' updated, ' + skipped + ' skipped');
```

### Push returns 403 on `sys_variable_value`

SNSync will automatically retry via the SNSync endpoint when it gets a 403. If the retry also fails, ensure `--install-endpoint` has been run and the Scripted REST API is **Active** in ServiceNow.

### `.wf_meta.json` version mismatch after pull

If the local `.wf_meta.json` still points to the published version after a checkout, the activity map failed to refresh. This happens when activity coordinates (x/y) differ between versions. SNSync falls back to name-only matching — check the console output for "Refreshed N local activity files".

---

## Known Limitations

1. **Transitions always require the SNSync endpoint.** The "Update workflow version" business rule on `wf_transition` cannot be bypassed via REST API. Without the endpoint, transition connections in the Workflow Editor will be broken after checkout.

2. **`wf_condition` records are reused from the published version.** When transitions are cloned, the `condition` field still references the published version's `wf_condition` records. This works correctly in practice (the workflow engine uses condition names/values, not the activity reference) but may cause minor inconsistencies in some ServiceNow versions.

3. **ACL on `sys_variable_value` INSERT.** REST API users without elevated permissions cannot INSERT into `sys_variable_value`. SNSync catches 403 errors and retries via the scripted endpoint automatically.
