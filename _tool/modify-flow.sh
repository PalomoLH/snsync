#!/bin/bash
# ServiceNow Flow Modifier - Complete Workflow
# Modifies ServiceNow Flow Designer flows programmatically

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCE="${SN_INSTANCE:-https://your-instance.service-now.com}"
if [ -n "$SN_PROJECT_PATH" ]; then
    TOKEN_FILE="$SCRIPT_DIR/../$SN_PROJECT_PATH/.token_cache.json"
else
    TOKEN_FILE="$(find "$SCRIPT_DIR/../projects" -maxdepth 2 -name '.token_cache.json' 2>/dev/null | head -n 1)"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
    echo -e "${BLUE}ServiceNow Flow Modifier${NC}"
    echo ""
    echo "Usage: $0 <flow_id> <action_id> <operation> [--apply]"
    echo ""
    echo "Arguments:"
    echo "  flow_id      Flow sys_id (e.g., 88a75b531b8952107fca32231b4bcb09)"
    echo "  action_id    Action sys_id in snapshot (e.g., b397fbe08785f210f7a2a60d3fbb359a)"
    echo "  operation    Operation to perform (skip-approval, etc.)"
    echo "  --apply      Actually apply changes (default: preview only)"
    echo ""
    echo "Environment (optional):"
    echo "  SN_INSTANCE      ServiceNow instance URL"
    echo "  SN_PROJECT_PATH  Relative project path (e.g., projects/my-project)"
    echo ""
    echo "Examples:"
    echo "  # Preview DVS approval skip"
    echo "  $0 88a75b531b8952107fca32231b4bcb09 b397fbe08785f210f7a2a60d3fbb359a skip-approval"
    echo ""
    echo "  # Apply DVS approval skip"
    echo "  $0 88a75b531b8952107fca32231b4bcb09 b397fbe08785f210f7a2a60d3fbb359a skip-approval --apply"
    echo ""
    exit 1
}

if [ $# -lt 3 ]; then
    usage
fi

FLOW_ID="$1"
ACTION_ID="$2"
OPERATION="$3"
APPLY_FLAG=""

if [ "$4" == "--apply" ]; then
    APPLY_FLAG="--apply"
fi

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}ServiceNow Flow Designer - Deep Modifier${NC}"
echo -e "${BLUE}======================================================================${NC}"
echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  Instance:   $INSTANCE"
echo "  Flow ID:    $FLOW_ID"
echo "  Action ID:  $ACTION_ID"
echo "  Operation:  $OPERATION"
echo "  Mode:       $([ -z "$APPLY_FLAG" ] && echo 'PREVIEW' || echo 'APPLY')"
echo ""

# Check if token file exists
if [ ! -f "$TOKEN_FILE" ]; then
    echo -e "${RED}ERROR: Token file not found: $TOKEN_FILE${NC}"
    echo "Set SN_PROJECT_PATH or ensure at least one project token cache exists under projects/*/.token_cache.json"
    exit 1
fi

echo -e "${BLUE}Step 1: Modifying Flow Action${NC}"
echo "----------------------------------------"
python3 "$SCRIPT_DIR/flow-modifier.py" \
    --instance "$INSTANCE" \
    --flow-id "$FLOW_ID" \
    --action-id "$ACTION_ID" \
    --operation "$OPERATION"

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Flow modification failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Flow modification prepared${NC}"
echo ""

if [ -z "$APPLY_FLAG" ]; then
    echo -e "${YELLOW}======================================================================${NC}"
    echo -e "${YELLOW}PREVIEW MODE - No changes applied${NC}"
    echo -e "${YELLOW}======================================================================${NC}"
    echo ""
    echo "Modified flow saved to: /tmp/modified_flow_xml.json"
    echo ""
    echo "To apply these changes, run:"
    echo -e "  ${GREEN}$0 $FLOW_ID $ACTION_ID $OPERATION --apply${NC}"
    echo ""
    exit 0
fi

echo -e "${BLUE}Step 2: Pushing Changes to ServiceNow${NC}"
echo "----------------------------------------"
echo -e "${YELLOW}⚠️  This will modify the flow in ServiceNow!${NC}"
echo -n "Continue? (y/N): "
read -r response

if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Cancelled by user${NC}"
    exit 0
fi

echo ""
python3 "$SCRIPT_DIR/flow-pusher.py" \
    --instance "$INSTANCE" \
    --xml-file "/tmp/modified_flow_xml.json" \
    --apply

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to push changes to ServiceNow${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}======================================================================${NC}"
echo -e "${GREEN}✓ SUCCESS - Flow modified in ServiceNow${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Test the modified flow by creating a catalog request"
echo "  2. Verify the approval behavior matches expectations"
echo "  3. Monitor flow execution logs in ServiceNow"
echo ""
echo "Flow Details:"
echo "  URL: $INSTANCE/\$flow-designer.do?sysparm_nostack=true&id=$FLOW_ID"
echo ""
