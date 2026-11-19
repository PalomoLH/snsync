---
name: sn-flow
description: Understand and modify ServiceNow automation with snsync, covering Flow Designer flows/subflows (sys_hub_flow, flow_map.json, flow.json, --modify-flow) and legacy Workflows (wf_workflow, wf_activity Run Script activities, sys_variable_value, workflow checkout). Use whenever the user asks what a flow or workflow does, wants to change approvals or approvers, skip an approval, edit an action input, edit a workflow script activity, or hits a "workflow version is published" block, even if they only say "the flow for catalog item X".
---

# Flows and Workflows

ServiceNow has two automation engines. Work out which one you're dealing with first, because they are stored and edited differently.

| Engine | Tables | Local file | Editable via snsync? |
|---|---|---|---|
| Flow Designer | `sys_hub_flow`, `sys_hub_*_instance_v2` | `flow_map.json`, `flow/flow.json` | Yes: action inputs |
| Legacy Workflow | `wf_workflow`, `wf_workflow_version`, `wf_activity` | `flow/workflow.json`, `src/wf_activity/*` | Yes: per activity (not `workflow.json`) |

A catalog item pull puts `flow/flow.json` in the folder for Flow Designer, or `flow/workflow.json` for Legacy Workflow.

All write steps below follow the `sn-push` rules: **never write to leviprod**, confirm the Update Set, and default to levidev.

## Flow Designer

### Understand a flow (read-only)
```bash
node snsync --pull --table sys_hub_flow --query "name=<Flow Name>" --project projects/<env> --context-action skip
```
This writes `src/sys_hub_flow/<Flow>/flow_map.json`: `_meta` (sys_id, name, internal_name, type, active, scope) plus `nodes` sorted by `order`. Each node has a `type`:
- `trigger`: what starts the flow (`trigger_type`)
- `action`: a step (`action_name`, `action_type`)
- `subflow`: a call to another flow (`subflow_name`). Pull that one too if the user needs its internals.
- `logic`: If, Else, For Each, and so on

To explain a flow, walk through the nodes in order and describe each step in plain language. `flow_map.json` is a map, not an editable source, and it is never pushed.

List actions directly:
```bash
node snsync --modify-flow --flow-id <flow_sys_id> --operation list --project projects/<env>
node snsync --modify-flow --flow-id <flow_sys_id> --action-id <action_sys_id> --operation get --project projects/<env>
```
`list` and `get` are read-only. Every other `--operation` writes to the instance.

### Edit a flow: preferred path via flow.json
1. Pull the catalog item that uses the flow: `node snsync --pull --catalog-item <sys_id> --project projects/levidev`.
2. Edit `src/<Item>/flow/flow.json` → `actions.<action_sys_id>.config`. The values are decoded and human-readable.
3. Push the file: `node snsync --push projects/levidev/src/<Item>/flow/flow.json --project projects/levidev --update-set "<US>"`. The tool fetches the current XML from `sys_update_xml/<_meta.sys_id>`, re-encodes each action's config with `FlowModifier`, and PUTs it back.

Leave `_meta.sys_id` and `_meta.flow_id` alone. The push needs both.

Approval condition patterns:
```
ApprovesRejectsAnyG[{{static.<group_sys_id>}}]           any member of a group
ApprovesRejectsAnyU[{{static.<user_sys_id>}}]            a specific user
ApprovesRejectsAnyU[{{triggerref.request_for.manager}}]  requester's manager
""                                                       empty = approval is skipped
```
Look up group and user sys_ids with a pull on `sys_user_group` / `sys_user`. Never guess them.

### Edit a flow: one-shot CLI (no catalog item needed)
```bash
node snsync --modify-flow --flow-id <id> --action-id <id> --operation skip-approval --project projects/levidev --update-set "<US>"
node snsync --modify-flow --flow-id <id> --action-id <id> --operation approval --value "ApprovesRejectsAnyG[{{static.<grp>}}]" --project projects/levidev --update-set "<US>"
node snsync --modify-flow --flow-id <id> --action-id <id> --operation modify --param <input_name> --value <v> --project projects/levidev --update-set "<US>"
```
`modify` automatically converts `true`, `false`, and numbers to the right type.

More detail: `_tool/Docs/flow-modifier-usage.md`.

## Legacy Workflow

### Why the scripts look odd
Run Script activities don't store their code on `wf_activity.script`. The field holds a reference such as `vars.var__m_<definition>.script`, and the real code lives in `sys_variable_value`. To make snsync resolve it, the `wf_activity` entry in `sn-config.json` needs:
```json
"variableFields": ["script", "on_cancel", "result_condition"],
"workflowCheckout": true
```
With that set, a pull writes the real code to `script.js` and saves `.wf_meta.json`. That file records which `sys_variable_value` to update and the `workflow_version`. Don't edit it.

### Edit a workflow activity
```bash
# pull the activities of one workflow
node snsync --pull --table wf_activity --query "workflow_version.workflow.name=<Workflow Name>^workflow_version.published=true" --project projects/levidev --context-action skip
# edit src/wf_activity/<Activity>/script.js, then:
node snsync --push projects/levidev/src/wf_activity/<Activity>/script.js --project projects/levidev --update-set "<US>"
```
The push goes to `sys_variable_value`, not to `wf_activity`.

### Published versions
Published `wf_workflow_version` records are read-only. With `workflowCheckout: true`, the push checks the version out for you. It reuses an existing unpublished version or clones the published one (activities, transitions, variable values) into a new unpublished version, then refreshes the local activity folders to point at it. After a checkout, tell the user that the workflow now has an unpublished draft. Someone has to **publish it in the Workflow Editor** before the change runs.

If the push is blocked and no checkout happened, give the user the URL from the output, have them check out the workflow manually, re-pull, and push again.

Pushing `flow/workflow.json` directly isn't supported. Edit the individual `wf_activity` folders instead.
