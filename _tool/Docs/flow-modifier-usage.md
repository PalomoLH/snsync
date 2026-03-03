# Flow Modifier - Usage Examples

## Integrated into snsync CLI

The Flow Designer modifier is now integrated into snsync as a single command.

### Setup

Navigate to your project folder:
```bash
cd /Users/fwiek/Documents/snsync
```

All commands require the `--project` flag to specify which project configuration to use.

### Examples

#### 1. List all actions in a flow
```bash
node snsync --modify-flow \
  --flow-id "88a75b531b8952107fca32231b4bcb09" \
  --operation list \
  --project "projects/levidev"
```

#### 2. Get action configuration
```bash
node snsync --modify-flow \
  --flow-id "88a75b531b8952107fca32231b4bcb09" \
  --action-id "b397fbe08785f210f7a2a60d3fbb359a" \
  --operation get \
  --project "projects/levidev"
```

#### 3. Skip approval (auto-approve)
```bash
node snsync --modify-flow \
  --flow-id "88a75b531b8952107fca32231b4bcb09" \
  --action-id "b397fbe08785f210f7a2a60d3fbb359a" \
  --operation skip-approval \
  --project "projects/levidev"
```

#### 4. Set approval conditions
```bash
node snsync --modify-flow \
  --flow-id "88a75b531b8952107fca32231b4bcb09" \
  --action-id "b397fbe08785f210f7a2a60d3fbb359a" \
  --operation approval \
  --value "ApprovesRejectsAnyG[{{static.GROUP_SYS_ID}}]" \
  --project "projects/levidev"
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
  --project "projects/levidev"

# Modify a boolean
node snsync --modify-flow \
  --flow-id "FLOW_ID" \
  --action-id "ACTION_ID" \
  --operation modify \
  --param "enabled" \
  --value "true" \
  --project "projects/levidev"

# Modify a number
node snsync --modify-flow \
  --flow-id "FLOW_ID" \
  --action-id "ACTION_ID" \
  --operation modify \
  --param "timeout" \
  --value "30" \
  --project "projects/levidev"
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
snsync CLI
    ↓
handleFlowModification() [sn-sync.js]
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
node snsync --modify-flow --flow-id "FLOW_ID" --operation list --project "projects/levidev"
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

- Action values are stored as base64-encoded gzipped JSON
- Compression level: 9 (maximum)
- Empty approval_conditions = auto-approve/skip
- All modifications update sys_update_xml records
- Changes take effect immediately (no flow republish needed)

## DVS Approval Removal Example

The original use case that drove this implementation:

```bash
# Skip DVS approval (set to auto-approve)
node snsync --modify-flow \
  --flow-id "88a75b531b8952107fca32231b4bcb09" \
  --action-id "b397fbe08785f210f7a2a60d3fbb359a" \
  --operation skip-approval \
  --project "projects/levidev"
```

This changes:
- **Old**: `ApprovesRejectsAnyG[{{static.d3a933afc383ee1048abf00c0501311b}}]`
- **New**: `` (empty = auto-approved)

Manager approval remains intact, only DVS approval is skipped.
