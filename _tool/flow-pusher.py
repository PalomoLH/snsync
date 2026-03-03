#!/usr/bin/env python3
"""
ServiceNow Flow Designer Pusher
Pushes modified flow XML back to ServiceNow via REST API
"""

import json
import sys
import os
import subprocess
import argparse


def push_modified_flow(instance_url: str, token: str, modified_xml_file: str, apply: bool = False):
    """
    Push the modified flow XML back to ServiceNow
    """
    # Read the modified XML
    with open(modified_xml_file, 'r') as f:
        data = json.load(f)
    
    sys_id = data['sys_id']
    name = data['name']
    payload = data['payload']
    
    print(f"\n{'='*80}")
    print(f"Pushing Modified Flow XML to ServiceNow")
    print(f"{'='*80}")
    print(f"Instance: {instance_url}")
    print(f"Update Set Record: {sys_id}")
    print(f"Name: {name}")
    print(f"Payload Size: {len(payload)} bytes")
    print(f"{'='*80}\n")
    
    if not apply:
        print("⚠️  PREVIEW MODE - Use --apply to push changes")
        return False
    
    # Update the sys_update_xml record
    url = f"{instance_url}/api/now/table/sys_update_xml/{sys_id}"
    
    # Prepare the payload
    update_data = {
        "payload": payload
    }
    
    # Write to temp file for curl
    temp_file = '/tmp/update_payload.json'
    with open(temp_file, 'w') as f:
        json.dump(update_data, f)
    
    # Execute the update
    cmd = f'''curl -s -X PUT "{url}" \
        -H "Authorization: Bearer {token}" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d @{temp_file}'''
    
    print("Executing API call...")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    
    if result.returncode == 0:
        response = json.loads(result.stdout)
        if 'result' in response:
            print("\n✅ SUCCESS: Flow XML updated in ServiceNow")
            print(f"Updated: {response['result'].get('sys_updated_on')}")
            print(f"Updated by: {response['result'].get('sys_updated_by')}")
            print("\nNext steps:")
            print("1. The flow will automatically use the modified approval logic")
            print("2. Test by creating a catalog request for GitHub access")
            print("3. Only Manager approval should be required (DVS auto-skipped)")
            return True
        else:
            print(f"\n❌ ERROR: {response}")
            return False
    else:
        print(f"\n❌ ERROR: {result.stderr}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Push modified flow XML to ServiceNow')
    parser.add_argument('--instance', required=True, help='ServiceNow instance URL')
    parser.add_argument('--token', help='OAuth token (or will read from .token_cache.json)')
    parser.add_argument('--xml-file', default='/tmp/modified_flow_xml.json', help='Modified XML file path')
    parser.add_argument('--apply', action='store_true', help='Apply changes (default: preview only)')
    
    args = parser.parse_args()
    
    # Get token
    token = args.token
    if not token:
        # Try to read from token cache
        token_cache_file = os.path.join(os.path.dirname(__file__), '../projects/levidev/.token_cache.json')
        if os.path.exists(token_cache_file):
            with open(token_cache_file, 'r') as f:
                token_data = json.load(f)
                token = token_data.get('access_token')
    
    if not token:
        print("ERROR: No token provided and could not read from .token_cache.json")
        sys.exit(1)
    
    success = push_modified_flow(args.instance, token, args.xml_file, args.apply)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
