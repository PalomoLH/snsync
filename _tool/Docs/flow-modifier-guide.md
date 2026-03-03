# ServiceNow Flow Designer Deep Modifier

A robust tool suite for programmatically modifying ServiceNow Flow Designer flows without UI interaction.

## Overview

ServiceNow Flow Designer stores flows as compressed binary snapshots in XML format. This tool suite provides deep modification capabilities by:
1. Extracting flow XML from `sys_update_xml` table
2. Decompressing and decoding action configurations
3. Modifying specific parameters (approval rules, conditions, etc.)
4. Re-encoding and pushing changes back to ServiceNow

## Tools

### 1. `flow-modifier.py` - Core Modification Engine

Decodes, modifies, and re-encodes flow actions.

**Usage:**
```bash
python3 flow-modifier.py \
  --instance "https://your-instance.service-now.com" \
  --flow-id "<flow_sys_id>" \
  --action-id "<action_sys_id>" \
  --operation <operation>
```

**Operations:**
- `skip-approval`: Removes approval group/user requirements (auto-approves)

**Example:**
```bash
# Preview DVS approval modification
python3 flow-modifier.py \
  --instance "https://levidev.service-now.com" \
  --flow-id "88a75b531b8952107fca32231b4bcb09" \
  --action-id "b397fbe08785f210f7a2a60d3fbb359a" \
  --operation skip-approval
```

### 2. `flow-pusher.py` - Push Changes to ServiceNow

Uploads modified flow XML back to ServiceNow.

**Usage:**
```bash
python3 flow-pusher.py \
  --instance "https://your-instance.service-now.com" \
  --xml-file /tmp/modified_flow_xml.json \
  --apply
```

**Options:**
- `--apply`: Actually push changes (default is preview mode)
- `--token`: OAuth token (or reads from `../.token_cache.json`)

### 3. `modify-flow.sh` - Complete Workflow Wrapper

End-to-end script combining both tools.

**Usage:**
```bash
./modify-flow.sh <flow_id> <action_id> <operation> [--apply]
```

## Architecture

### Flow Designer Storage Structure

```
sys_hub_flow (Flow Definition)
  └─ master_snapshot → sys_hub_flow_snapshot
       ├─ sys_hub_action_instance_v2 (Actions)
       │    └─ values (base64+gzip compressed JSON)
       ├─ sys_hub_flow_logic_instance_v2 (If/Else blocks)
       └─ sys_hub_trigger_instance_v2 (Triggers)
```

### Modification Process

```
1. Query sys_update_xml for latest flow version
2. Extract XML payload containing snapshot
3. Find target action by sys_id using regex
4. Extract <values>...</values> base64 string
5. Decode: base64 → gzip decompress → JSON
6. Modify JSON structure (e.g., approval_conditions)
7. Encode: JSON → gzip compress → base64
8. Replace <values> in XML
9. PUT modified XML back to sys_update_xml
```

## Use Cases

### Remove Approval Step

```bash
# 1. Find the approval action sys_id from flow snapshot
# 2. Modify to skip approval
python3 flow-modifier.py \
  --instance "https://instance.service-now.com" \
  --flow-id "<flow_sys_id>" \
  --action-id "<approval_action_sys_id>" \
  --operation skip-approval

# 3. Push changes
python3 flow-pusher.py \
  --instance "https://instance.service-now.com" \
  --apply
```

### Batch Modify Multiple Flows

```bash
# Create a batch script
for action_id in "${approval_actions[@]}"; do
  python3 flow-modifier.py \
    --flow-id "$flow_id" \
    --action-id "$action_id" \
    --operation skip-approval
done

python3 flow-pusher.py --apply
```

## Finding Action IDs

### Method 1: Via API

```bash
# Get flow snapshot
curl "https://instance.service-now.com/api/now/table/sys_hub_flow/<flow_id>?sysparm_fields=master_snapshot"

# Get actions in snapshot
curl "https://instance.service-now.com/api/now/table/sys_hub_action_instance_v2?sysparm_query=flow=<snapshot_id>"
```

### Method 2: Via XML Inspection

```bash
# Extract and decode flow XML
python3 -c "
import json, base64, zlib, sys

# Load modified_flow_xml.json
with open('/tmp/flow_xml.json', 'r') as f:
    data = json.load(f)

xml = data['result'][0]['payload']

# Find all action sys_ids
import re
actions = re.findall(r'<sys_hub_action_instance_v2.*?<sys_id>(.*?)</sys_id>.*?<order>(.*?)</order>.*?<ui_id>(.*?)</ui_id>', xml, re.DOTALL)

for sys_id, order, ui_id in actions:
    print(f'Order {order}: sys_id={sys_id}, ui_id={ui_id}')
"
```

## Extending the Framework

### Adding New Operations

1. Add operation to `FlowDesignerModifier` class:

```python
def modify_custom_field(self, values: List[Dict], field_name: str, new_value: str) -> List[Dict]:
    """
    Modify any field in action values
    """
    for item in values:
        if item.get('name') == field_name:
            item['value'] = new_value
            item['displayValue'] = new_value
            break
    return values
```

2. Add to operation choices in `main()`:

```python
parser.add_argument('--operation', 
    choices=['skip-approval', 'modify-field'],  # Add here
    required=True)
```

3. Handle in execution logic:

```python
elif args.operation == 'modify-field':
    modifier.modify_custom_field(flow_id, action_id, args.field_name, args.value)
```

## Security & Best Practices

1. **Always Preview First**: Run without `--apply` to validate changes
2. **Backup Flows**: Export flows before modification via Update Sets
3. **Token Security**: Store tokens in `.token_cache.json` with restricted permissions
4. **Test in Dev**: Modify dev instance flows first
5. **Version Control**: Commit modified flow XML to track changes

## Troubleshooting

### "Could not retrieve flow XML"
- Verify flow sys_id is correct
- Check OAuth token has `sys_update_xml` read access
- Flow may not have been modified (no update set record)

### "Could not find action in XML"
- Action sys_id might be from different snapshot
- Use `master_snapshot` ID, not `latest_snapshot`
- Check action exists: query `sys_hub_action_instance_v2`

### "Decode Error"
- XML might be malformed
- Ensure full XML payload retrieved
- Check base64 encoding is pure (no whitespace)

### Changes Not Visible
- Flow uses cached snapshot - restart flow
- Clear flow execution cache
- Deactivate and reactivate flow

## Example: DVS Approval Removal

```bash
# Full workflow for removing DVS group approval
cd /Users/fwiek/Documents/snsync/_tool

# 1. Modify DVS approval to auto-skip
python3 flow-modifier.py \
  --instance "https://levidev.service-now.com" \
  --flow-id "88a75b531b8952107fca32231b4bcb09" \
  --action-id "b397fbe08785f210f7a2a60d3fbb359a" \
  --operation skip-approval

# 2. Review the modification
cat /tmp/modified_flow_xml.json | jq '.payload' | head -50

# 3. Push to ServiceNow
python3 flow-pusher.py \
  --instance "https://levidev.service-now.com" \
  --apply

# 4. Verify by testing catalog request
# DVS approval should now auto-skip
```

## Technical Details

### Approval Conditions Format

ServiceNow uses a proprietary format for approval rules:

- `ApprovesRejectsAnyU[{{variable}}]` - Any user from variable
- `ApprovesRejectsAnyG[{{static.group_id}}]` - Any user from group
- `ApprovesRejectsAllU[{{variable}}]` - All users from variable
- Empty string `""` - Auto-approve (no approval needed)

### Compression Format

- Algorithm: gzip (zlib with gzip headers)
- Level: Maximum compression (9)
- Encoding: Base64
- Window bits: 16 + MAX_WBITS (for gzip format)

## License

Part of SNSync tool suite - MIT License

## Contributing

To add new modification capabilities:
1. Identify the target field in action values
2. Add decode/modify/encode logic
3. Test in dev environment
4. Document the operation
5. Add to this README

---

**Last Updated**: February 26, 2026
**Version**: 1.0.0
**Author**: SNSync Team
