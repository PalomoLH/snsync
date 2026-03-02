#!/usr/bin/env python3
"""
Quick Flow Modifier - Uses cached XML from /tmp/flow_xml.json
"""

import json
import base64
import zlib
import re
import sys

def decode_action_values(encoded_values):
    compressed = base64.b64decode(encoded_values.strip())
    decompressed = zlib.decompress(compressed, 16 + zlib.MAX_WBITS)
    return json.loads(decompressed.decode('utf-8'))

def encode_action_values(values):
    json_str = json.dumps(values, separators=(',', ':'))
    compressed = zlib.compress(json_str.encode('utf-8'), 9)
    encoded = base64.b64encode(compressed).decode('utf-8')
    return encoded

def find_action_in_xml(xml, action_sys_id):
    pattern = rf'<sys_hub_action_instance_v2[^>]*>.*?<sys_id>{action_sys_id}</sys_id>.*?<values>(.*?)</values>.*?</sys_hub_action_instance_v2>'
    match = re.search(pattern, xml, re.DOTALL)
    return match.group(1).strip() if match else None

def replace_action_in_xml(xml, action_sys_id, new_encoded_values):
    pattern = rf'(<sys_hub_action_instance_v2[^>]*>.*?<sys_id>{action_sys_id}</sys_id>.*?<values>)(.*?)(</values>.*?</sys_hub_action_instance_v2>)'
    return re.sub(pattern, rf'\1{new_encoded_values}\3', xml, flags=re.DOTALL)

def modify_approval_conditions(values, new_condition):
    for item in values:
        if item.get('name') == 'approval_conditions':
            old_value = item['value']
            item['value'] = new_condition
            item['displayValue'] = new_condition
            print(f"✓ Modified approval_conditions:")
            print(f"  Old: {old_value}")
            print(f"  New: {new_condition}")
            break
    return values

# Main execution
print("\n" + "="*80)
print("Quick Flow Modifier - DVS Approval Removal")
print("="*80 + "\n")

# Load the cached XML
with open('/tmp/flow_xml.json', 'r') as f:
    data = json.load(f)

xml_record = data['result'][0]
xml_payload = xml_record['payload']

print(f"Loaded flow XML: {xml_record['name']}")
print(f"Update set record: {xml_record['sys_id']}\n")

# DVS approval action sys_id
dvs_action_sys_id = 'b397fbe08785f210f7a2a60d3fbb359a'

# Find and decode
encoded_values = find_action_in_xml(xml_payload, dvs_action_sys_id)
if not encoded_values:
    print(f"❌ ERROR: Could not find DVS approval action")
    sys.exit(1)

print(f"✓ Found DVS approval action")

values = decode_action_values(encoded_values)
print(f"✓ Decoded configuration ({len(values)} parameters)\n")

# Modify to auto-skip (empty approval rules)
modified_values = modify_approval_conditions(values, "")

# Re-encode
new_encoded = encode_action_values(modified_values)
print(f"\n✓ Re-encoded modified configuration")

# Replace in XML
modified_xml = replace_action_in_xml(xml_payload, dvs_action_sys_id, new_encoded)
print(f"✓ Updated XML payload")

# Save
output = {
    'sys_id': xml_record['sys_id'],
    'name': xml_record['name'],
    'payload': modified_xml
}

with open('/tmp/modified_flow_xml.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f"\n" + "="*80)
print("✅ SUCCESS: Modified XML ready")
print("="*80)
print(f"\nSaved to: /tmp/modified_flow_xml.json")
print(f"\nTo push to ServiceNow, run:")
print(f"  python3 flow-pusher.py --instance https://your-instance.service-now.com --apply")
print()
