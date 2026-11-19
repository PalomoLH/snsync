---
name: sn-pull
description: Download ServiceNow records into the local snsync workspace (projects/<env>/src). Use whenever the user wants to pull, fetch, download, sync down, refresh, inspect or "look at" something from a ServiceNow instance (levidev, leviaskhr, leviprod): script includes, business rules, widgets, catalog items, flows, workflows, or a record by name or sys_id. This includes requests that only mention a record or an environment, like "get the X script from prod" or "what does catalog item Y do in dev". Pulling is read-only and is the only allowed operation on leviprod.
---

# Pulling from ServiceNow

Pulling is **read-only** on the instance. It is safe in every environment, including `leviprod`. Run all commands from the repo root.

## 1. Choose the environment

| User says | `--project` |
|---|---|
| dev, levidev, or nothing | `projects/levidev` |
| askhr, leviaskhr, hr | `projects/leviaskhr` |
| prod, production, leviprod, levi | `projects/leviprod` |

If the user names none, default to `levidev` and say so. Prod is fine for pulls: people often pull prod to compare it with dev or to see what is live.

## 2. Choose the pull type

**A specific record or query** (the most common case):
```bash
node snsync --pull --table <table> --query "<encoded_query>" --project projects/<env> --context-action skip
```
Example queries: `name=MyScriptInclude`, `sys_id=<32hex>`, `nameSTARTSWITHLevi`, `sys_scope.scope=x_levi_app`.

**Refresh a record you already have locally.** The tool reads the folder's `.sys_id`:
```bash
node snsync --pull --target projects/<env>/src/<table>/<Record>/script.js --project projects/<env> --context-action skip
```

**A whole catalog item.** This pulls the item, its variables, its client scripts, and its flow or workflow into `src/<Item_Name>/`:
```bash
node snsync --pull --catalog-item <sc_cat_item_sys_id> --project projects/<env>
```

**A Flow Designer flow.** This also writes `flow_map.json`. See the `sn-flow` skill for how to read it.
```bash
node snsync --pull --table sys_hub_flow --query "name=<Flow Name>" --project projects/<env> --context-action skip
```

**Everything in the config.** Run this only when the user asks for it. The default filters only return records updated *today*, so it can quietly come back nearly empty:
```bash
node snsync --pull --project projects/<env> --context-action skip
```

Always pass `--context-action skip` (or `auto`) when running non-interactively. The default, `prompt`, waits on stdin and will hang.

## 3. If the table isn't mapped

The error `Table '<x>' not found in sn-config.json` means `projects/<env>/sn-config.json` needs a `mapping` entry. `_tool/templates/sn-config.json` has ready-made entries for about 60 tables, so copy from there first. Otherwise, add a minimal entry:
```json
"<table>": {
  "filter": "sys_updated_onONToday@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()",
  "fields": ["script"],
  "ext": { "script": "js" },
  "saveContext": true
}
```
- `fields` + `ext`: each field becomes its own file (`script` → `script.js`).
- `jsonExport`: non-script fields that go into `_record.json`.

## 4. After pulling

Results land in `projects/<env>/src/<table>/<Record_Name>/`. Read the field files and `_record.json` to answer the user's question. Leave the dotfiles (`.sys_id`, `.sys_updated_on`, `.wf_meta.json`) alone.

If the pull returns nothing, the query probably matched nothing. Check field names and the scope, or try `LIKE` in place of `=`.

**Comparing environments:** pull the same query into both projects, then `diff -r projects/levidev/src/<table>/<Rec> projects/leviprod/src/<table>/<Rec>`.

## Auth problems

- **OAuth projects** (levidev, leviaskhr): the first run opens a browser for login. If the token is expired, the tool tries to refresh it and, failing that, reopens the browser. Tell the user to finish the login there.
- `SN_ENC_SECRET` must be exported in the shell (`~/.zshrc`) for the token cache to work.
- **leviprod** uses Basic auth from its `.env`. Never print the contents of any `.env`.

## TLS error: `unable to get local issuer certificate` (Zscaler)

This machine sits behind **Zscaler**, which intercepts TLS and re-signs traffic with its own root CA. `curl` and browsers work because they trust the macOS Keychain. Node does not use the Keychain, so axios fails with `unable to get local issuer certificate`. The error is a certificate problem, not a login problem. Retrying or disabling the sandbox doesn't help.

Which environments are affected (checked 2026-09-24):

| Project | Intercepted? |
|---|---|
| `leviprod` (levi.service-now.com) | ✅ Yes |
| `leviaskhr` | ✅ Yes |
| `levidev` | ❌ No (real DigiCert certificate). This depends on Zscaler policy and can change. |

Check any host with:
```bash
echo | openssl s_client -connect <host>.service-now.com:443 -servername <host>.service-now.com 2>/dev/null | grep -m1 'i:'
# issuer mentions "Zscaler" → intercepted
```

Fix: export the Zscaler root CA from the Keychain and point Node at it. **Do not** set `NODE_TLS_REJECT_UNAUTHORIZED=0`.
```bash
mkdir -p ~/.certs
security find-certificate -a -c "Zscaler Root CA" -p /Library/Keychains/System.keychain > ~/.certs/zscaler.pem
export NODE_EXTRA_CA_CERTS=~/.certs/zscaler.pem   # add this line to ~/.zshrc so it persists
```
If `~/.zshrc` doesn't set it yet, prefix the command for the current run (`NODE_EXTRA_CA_CERTS=~/.certs/zscaler.pem node snsync ...`) and suggest the `~/.zshrc` line to the user. Don't edit their shell config without asking. The same fix applies to `sn-push` and any ad-hoc Node script that calls the instance.
