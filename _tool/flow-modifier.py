#!/usr/bin/env python3
"""
ServiceNow Flow Designer Modifier Tool
Provides deep modification capabilities for Flow Designer flows via API
"""

import json
import base64
import zlib
import re
import sys
import os
import argparse
import glob
from typing import Dict, List, Any, Optional

class FlowDesignerModifier:
    """
    Tool to modify ServiceNow Flow Designer flows programmatically
    """
    
    def __init__(self, instance_url: str, token: str):
        self.instance_url = instance_url.rstrip('/')
        self.token = token
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    
    def get_flow_xml(self, flow_sys_id: str) -> Optional[Dict]:
        """
        Retrieve the flow XML payload from sys_update_xml table
        """
        import subprocess
        
        url = f"{self.instance_url}/api/now/table/sys_update_xml"
        params = f"sysparm_query=name=sys_hub_flow_{flow_sys_id}^ORDERBYDESCsys_updated_on&sysparm_limit=1"
        
        cmd = [
            'curl', '-s',
            f'{url}?{params}',
            '-H', f'Authorization: Bearer {self.token}',
            '-H', 'Accept: application/json'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            try:
                data = json.loads(result.stdout)
                if data.get('result') and len(data['result']) > 0:
                    return data['result'][0]
            except json.JSONDecodeError as e:
                print(f"ERROR: Invalid JSON response: {e}")
                print(f"Response: {result.stdout[:500]}")
        else:
            print(f"ERROR: curl failed: {result.stderr}")
        return None
    
    def decode_action_values(self, encoded_values: str) -> Dict:
        """
        Decode base64+gzip compressed action values
        """
        compressed = base64.b64decode(encoded_values.strip())
        decompressed = zlib.decompress(compressed, 16 + zlib.MAX_WBITS)
        return json.loads(decompressed.decode('utf-8'))
    
    def encode_action_values(self, values: Dict) -> str:
        """
        Encode action values back to base64+gzip format
        """
        json_str = json.dumps(values, separators=(',', ':'))
        compressed = zlib.compress(json_str.encode('utf-8'), 9)
        # Add gzip header (16) to compression
        encoded = base64.b64encode(compressed).decode('utf-8')
        return encoded
    
    def find_action_in_xml(self, xml: str, action_sys_id: str) -> Optional[str]:
        """
        Find an action instance in the XML by sys_id
        """
        pattern = rf'<sys_hub_action_instance_v2[^>]*>.*?<sys_id>{action_sys_id}</sys_id>.*?<values>(.*?)</values>.*?</sys_hub_action_instance_v2>'
        match = re.search(pattern, xml, re.DOTALL)
        return match.group(1).strip() if match else None
    
    def replace_action_in_xml(self, xml: str, action_sys_id: str, new_encoded_values: str) -> str:
        """
        Replace an action's values in the XML
        """
        pattern = rf'(<sys_hub_action_instance_v2[^>]*>.*?<sys_id>{action_sys_id}</sys_id>.*?<values>)(.*?)(</values>.*?</sys_hub_action_instance_v2>)'
        return re.sub(pattern, rf'\1{new_encoded_values}\3', xml, flags=re.DOTALL)
    
    def modify_approval_conditions(self, values: List[Dict], new_condition: str) -> List[Dict]:
        """
        Modify the approval_conditions field in action values
        """
        for item in values:
            if item.get('name') == 'approval_conditions':
                old_value = item['value']
                item['value'] = new_condition
                item['displayValue'] = new_condition
                print(f"Modified approval_conditions:")
                print(f"  Old: {old_value}")
                print(f"  New: {new_condition}")
                break
        return values
    
    def skip_dvs_approval(self, flow_sys_id: str, dvs_action_sys_id: str) -> bool:
        """
        Modify DVS approval to auto-skip by removing the group requirement
        
        Args:
            flow_sys_id: The flow's sys_id
            dvs_action_sys_id: The DVS approval action's sys_id in the snapshot
        """
        print(f"\n{'='*80}")
        print(f"Modifying Flow: {flow_sys_id}")
        print(f"DVS Approval Action: {dvs_action_sys_id}")
        print(f"{'='*80}\n")
        
        # 1. Get the flow XML
        xml_record = self.get_flow_xml(flow_sys_id)
        if not xml_record:
            print("ERROR: Could not retrieve flow XML")
            return False
        
        xml_payload = xml_record['payload']
        print(f"Retrieved flow XML (update set: {xml_record['name']})")
        
        # 2. Find the DVS approval action
        encoded_values = self.find_action_in_xml(xml_payload, dvs_action_sys_id)
        if not encoded_values:
            print(f"ERROR: Could not find action {dvs_action_sys_id} in XML")
            return False
        
        print(f"Found DVS approval action in XML")
        
        # 3. Decode the values
        values = self.decode_action_values(encoded_values)
        print(f"Decoded action configuration ({len(values)} parameters)")
        
        # 4. Modify approval conditions to auto-approve (no approvers = auto-approved)
        # Change from: ApprovesRejectsAnyG[{{static.d3a933afc383ee1048abf00c0501311b}}]
        # To: (empty or AlwaysApproved)
        new_condition = ""  # Empty approval rules = auto-approved
        modified_values = self.modify_approval_conditions(values, new_condition)
        
        # 5. Re-encode the values
        new_encoded = self.encode_action_values(modified_values)
        print(f"\nRe-encoded modified configuration")
        
        # 6. Replace in XML
        modified_xml = self.replace_action_in_xml(xml_payload, dvs_action_sys_id, new_encoded)
        print(f"Updated XML payload")
        
        # 7. Save modified XML back
        print(f"\n{'='*80}")
        print(f"PREVIEW: Modified XML ready to push")
        print(f"{'='*80}")
        print(f"\nTo apply this change, you need to:")
        print(f"1. Update the sys_update_xml record {xml_record['sys_id']}")
        print(f"2. Commit the update set")
        print(f"3. The flow will use the modified DVS approval (auto-skip)")
        
        # Save to file for manual review
        output_file = '/tmp/modified_flow_xml.json'
        with open(output_file, 'w') as f:
            json.dump({
                'sys_id': xml_record['sys_id'],
                'name': xml_record['name'],
                'payload': modified_xml
            }, f, indent=2)
        
        print(f"\nModified XML saved to: {output_file}")
        return True


def main():
    parser = argparse.ArgumentParser(description='ServiceNow Flow Designer Modifier')
    parser.add_argument('--instance', required=True, help='ServiceNow instance URL')
    parser.add_argument('--token', help='OAuth token (or will read from .token_cache.json)')
    parser.add_argument('--project', help='Relative project folder (e.g., projects/my-project)')
    parser.add_argument('--flow-id', required=True, help='Flow sys_id')
    parser.add_argument('--action-id', required=True, help='Action sys_id to modify')
    parser.add_argument('--operation', choices=['skip-approval'], required=True, help='Operation to perform')
    parser.add_argument('--apply', action='store_true', help='Apply changes (default: preview only)')
    
    args = parser.parse_args()
    
    # Get token
    token = args.token
    if not token:
        token_cache_file = None
        script_dir = os.path.dirname(__file__)
        project_arg = args.project or os.getenv('SN_PROJECT_PATH')

        if project_arg:
            candidate = os.path.join(script_dir, '..', project_arg, '.token_cache.json')
            if os.path.exists(candidate):
                token_cache_file = candidate

        if not token_cache_file:
            candidates = sorted(glob.glob(os.path.join(script_dir, '..', 'projects', '*', '.token_cache.json')))
            if candidates:
                token_cache_file = candidates[0]

        if token_cache_file:
            with open(token_cache_file, 'r') as f:
                token_data = json.load(f)
                token = token_data.get('access_token')
    
    if not token:
        print("ERROR: No token provided and could not resolve .token_cache.json")
        print("Provide --token or --project (e.g., projects/my-project), or set SN_PROJECT_PATH.")
        sys.exit(1)
    
    # Create modifier
    modifier = FlowDesignerModifier(args.instance, token)
    
    # Execute operation
    if args.operation == 'skip-approval':
        success = modifier.skip_dvs_approval(args.flow_id, args.action_id)
        sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
