# Flow Modifier - Usage Examples

## Automatic Flow Pulling via `--catalog-item`

When pulling a catalog item, `snsync` automatically detects and pulls the linked automation into `flow/`:

```bash
node snsync --pull --catalog-item <catalog_item_sys_id> --project projects/<project-folder>
```

**What gets pulled into `src/<CatalogItemName>/flow/`:**

| Engine | File | Condition |
|---|---|---|
| Flow Designer (`sys_hub_flow`) | `flow.json` | `flow_designer_flow` field set on the catalog item |
| Legacy Workflow (`wf_workflow`) | `workflow.json` | `workflow` field set (and no Flow Designer flow) |

**`flow.json` structure** (Flow Designer):
```json
{
  "_meta": { "type": "sys_hub_flow", "flow_id": "...", "name": "...", "last_updated": "...", "updated_by": "..." },
  "actions": {
    "<action_sys_id>": { "order": 1, "ui_id": "...", "config": { ... } }
  }
}
```

**`workflow.json` structure** (Legacy Workflow Engine):
```json
{
  "_meta": { "type": "wf_workflow", "sys_id": "...", "name": "...", "active": "true", "last_updated": "...", "updated_by": "..." },
  "activities": [
    { "sys_id": "...", "name": "...", "order": "100", "description": "...", "script": "..." }
  ]
}
```

---

## Flow Designer Modifier (`--modify-flow`)

The Flow Designer modifier is integrated into snsync as a single command.

### Setup

Navigate to your repo root:
```bash
cd /path/to/your-repo
```

All commands require the `--project` flag to specify which project configuration to use.

### Examples (`--modify-flow`)

#### 1. List all actions in a flow
```bash
node snsync --modify-flow \
  --flow-id "<flow-sys-id>" \
  --operation list \
  --project "projects/<project-folder>"
```

#### 2. Get action configuration
```bash
node snsync --modify-flow \
  --flow-id "<flow-sys-id>" \
  --action-id "<action-sys-id>" \
  --operation get \
  --project "projects/<project-folder>"
```

#### 3. Skip approval (auto-approve)
```bash
node snsync --modify-flow \
  --flow-id "<flow-sys-id>" \
  --action-id "<action-sys-id>" \
  --operation skip-approval \
  --project "projects/<project-folder>"
```

#### 4. Set approval conditions
```bash
node snsync --modify-flow \
  --flow-id "<flow-sys-id>" \
  --action-id "<action-sys-id>" \
  --operation approval \
  --value "ApprovesRejectsAnyG[{{static.GROUP_SYS_ID}}]" \
  --project "projects/<project-folder>"
```

#### 5. Modify any action parameter
```bash
# Modify a text field
node snsync --modify-flow \
  --flow-id "FLOW_ID" \
  --action-id "ACTION_ID" \
  --operation modify \
  --param "field_name" \
  --value "new value" \
  --project "projects/<project-folder>"

# Modify a boolean
node snsync --modify-flow \
  --flow-id "FLOW_ID" \
  --action-id "ACTION_ID" \
  --operation modify \
  --param "enabled" \
  --value "true" \
  --project "projects/<project-folder>"

# Modify a number
node snsync --modify-flow \
  --flow-id "FLOW_ID" \
  --action-id "ACTION_ID" \
  --operation modify \
  --param "timeout" \
  --value "30" \
  --project "projects/<project-folder>"
```

## How It Works

1. **Authentication**: Uses existing snsync OAuth token (automatic)
2. **Retrieval**: Fetches flow XML from `sys_update_xml` table
3. **Decode**: Decompresses base64+gzip action configurations
4. **Modify**: Changes specified parameters
5. **Encode**: Recompresses with gzip+base64
6. **Push**: Updates the flow XML back to ServiceNow

## Architecture

```
# Automatic pull (via --catalog-item)
pullCatalogItem() [_tool/sn-sync.js]
    ├─ snClient → sys_update_xml (sys_hub_flow_<id>)  → flow/flow.json
    └─ snClient → wf_workflow + wf_activity            → flow/workflow.json

# Manual flow modification (via --modify-flow)
snsync CLI
    ↓
handleFlowModification() [_tool/sn-sync.js]
    ↓
FlowModifier class [flow-modifier.js]
    ├─ getFlowXML()
    ├─ decodeActionValues()
    ├─ modifyApprovalConditions()
    ├─ encodeActionValues()
    └─ pushFlowXML()
```

## Finding Action IDs

### Method 1: Use list operation
```bash
node snsync --modify-flow --flow-id "FLOW_ID" --operation list --project "projects/<project-folder>"
```

### Method 2: Flow Designer UI
1. Open flow in ServiceNow Flow Designer
2. Click on the action you want to modify
3. Check browser URL for the action's `ui_id`
4. Use that ID with `--action-id`

### Method 3: Direct query
```javascript
// Run in ServiceNow > System Definition > Scripts - Background
var gr = new GlideRecord('sys_hub_action_instance_v2');
gr.addQuery('flow', 'FLOW_SYS_ID');
gr.orderBy('order');
gr.query();
while (gr.next()) {
    gs.info(gr.order + '. ' + gr.sys_id + ' - ' + gr.ui_id);
}
```

## Advantages Over Python Scripts

✅ **Single command** - no multiple scripts
✅ **Integrated** - uses existing snsync auth
✅ **Native** - Node.js matches snsync codebase
✅ **Consistent** - same CLI structure as other commands
✅ **Reusable** - FlowModifier class can be imported elsewhere

## Technical Notes

- **Flow Designer** (`sys_hub_flow`): action values stored as base64-encoded gzipped JSON in `sys_update_xml`
- **Legacy Workflow** (`wf_workflow`): activities fetched from `wf_activity`, queried by published workflow version
- `--catalog-item` checks `flow_designer_flow` first; falls back to `workflow` field automatically
- Compression level for Flow Designer encoding: 9 (maximum)
- Empty `approval_conditions` = auto-approve/skip
- All Flow Designer modifications update `sys_update_xml` records; changes take effect immediately (no republish needed)

## Approval Removal Example

Skip a specific approval step (set to auto-approve):

```bash
node snsync --modify-flow \
  --flow-id "<flow-sys-id>" \
  --action-id "<action-sys-id>" \
  --operation skip-approval \
  --project "projects/<your-project>"
```

This changes:
- **Old**: `ApprovesRejectsAnyG[{{static.<group-sys-id>}}]`
- **New**: `` (empty = auto-approved)

Other approval steps remain intact; only the targeted approval is skipped.
