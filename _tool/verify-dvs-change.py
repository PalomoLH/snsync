#!/usr/bin/env python3
"""
Verify DVS Approval Modification
Checks if the DVS approval in the flow has been modified to auto-skip
"""

import sys
import json
import base64
import re
import zlib
import subprocess
import argparse
import os
import glob

def get_token(project=None):
    """Read OAuth token from cache"""
    script_dir = os.path.dirname(__file__)
    project_arg = project or os.getenv('SN_PROJECT_PATH')

    token_file = None
    if project_arg:
        candidate = os.path.join(script_dir, '..', project_arg, '.token_cache.json')
        if os.path.exists(candidate):
            token_file = candidate

    if not token_file:
        candidates = sorted(glob.glob(os.path.join(script_dir, '..', 'projects', '*', '.token_cache.json')))
        if candidates:
            token_file = candidates[0]

    if not token_file:
        raise FileNotFoundError("Could not resolve .token_cache.json. Use --project or set SN_PROJECT_PATH.")

    with open(token_file, 'r') as f:
        data = json.load(f)
    return data['access_token']

def verify_dvs_approval(instance_url, update_xml_id, project=None):
    """Retrieve flow and check DVS approval condition"""
    print("Verifying DVS Approval Status...")
    print("=" * 60)
    
    # Get token
    token = get_token(project)
    
    # Retrieve flow XML
    url = f"{instance_url.rstrip('/')}/api/now/table/sys_update_xml/{update_xml_id}"
    params = "?sysparm_fields=payload,sys_updated_on,sys_updated_by"
    
    result = subprocess.run([
        'curl', '-s',
        url + params,
        '-H', f'Authorization: Bearer {token}',
        '-H', 'Accept: application/json'
    ], capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"❌ ERROR: Failed to retrieve flow: {result.stderr}")
        return False
    
    data = json.loads(result.stdout)
    
    if 'result' not in data:
        print("❌ ERROR: Could not retrieve flow XML")
        print(f"Response: {data}")
        return False
    
    xml = data['result']['payload']
    last_updated = data['result'].get('sys_updated_on', 'unknown')
    updated_by = data['result'].get('sys_updated_by', 'unknown')
    
    print(f"Flow last updated: {last_updated}")
    print(f"Updated by: {updated_by}")
    print()
    
    # Find DVS approval action
    pattern = r'<sys_hub_action_instance_v2[^>]*>\s*<sys_id>b397fbe08785f210f7a2a60d3fbb359a</sys_id>.*?<values>(.*?)</values>.*?</sys_hub_action_instance_v2>'
    match = re.search(pattern, xml, re.DOTALL)
    
    if not match:
        print('❌ ERROR: DVS approval action not found in XML')
        return False
    
    # Decode the action configuration
    encoded = match.group(1).strip()
    decoded = zlib.decompress(base64.b64decode(encoded), 16 + zlib.MAX_WBITS)
    config = json.loads(decoded)
    
    # Check approval_conditions
    approval_conditions = config.get('approval_conditions', '')
    
    print(f"DVS Approval Action (sys_id: b397fbe08785f210f7a2a60d3fbb359a)")
    print(f"approval_conditions value: \"{approval_conditions}\"")
    print()
    
    if approval_conditions == '':
        print("✅ CONFIRMED: DVS approval is set to AUTO-SKIP")
        print("   The approval will automatically pass without requiring DVS group")
        print()
        print("Next steps:")
        print("  1. Test by creating a GitHub access request")
        print("  2. Only Manager approval should be required")
        return True
    else:
        print(f"⚠️  DVS approval still has condition: {approval_conditions}")
        print("   The modification may not have been applied")
        return False

if __name__ == '__main__':
    try:
        parser = argparse.ArgumentParser(description='Verify DVS approval modification in flow XML')
        parser.add_argument('--instance', required=True, help='ServiceNow instance URL')
        parser.add_argument('--update-xml-id', required=True, help='sys_update_xml record sys_id')
        parser.add_argument('--project', help='Relative project folder (e.g., projects/my-project)')
        args = parser.parse_args()

        success = verify_dvs_approval(args.instance, args.update_xml_id, args.project)
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
