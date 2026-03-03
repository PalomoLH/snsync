# ServiceNow Sync Tool (SNSync) 🚀

Agile local development CLI and VS Code integration for the ServiceNow platform. Synchronize widgets, scripts, and other records across multiple projects (clients/instances) securely and organized.

## ✨ Features

- **Multi-Project**: Manage multiple clients in the `projects/` folder.
- **Secure Authentication**:
  - OAuth 2.0 (Browser Login) - No passwords in text files!
  - Basic Auth support (`.env` user/password) if needed.
  - **Local Encryption**: OAuth Tokens are saved encrypted (`AES-256`) using a Zsh secret key (Memory-only).
- **VS Code Tasks**: Ready-to-use buttons for `Pull`, `Push`, `Watch`, and `Create Project`.
- **Collision Protection**: Checks if the file was modified on the server before uploading.
- **Context Aware**: Each record gets its own folder with separate scripts (`server.js`, `client.js`, `template.html`).
- **🤖 AI-Ready**: Generates `_ai_context.md` with tags and `_record.json` with metadata to help AI agents understand your ServiceNow instance.
- **Creation & Bulk Push**: Create new records by just making a folder and pushing it.
- **🤖 AI Documentation**: Includes detailed instructions for AI agents (`.github/copilot-instructions.md`, `AI_GUIDE.md`).

---

## 🛠️ Installation & Setup

### 1. Dependencies

Ensure Node.js (v18+) is installed.

```bash
cd _tool
npm install
```

### 2. Configure Encryption Secret (Zsh)

To secure the token cache (`.token_cache.json`), define a master password in your system environment variables (not in the project).

Add to your `~/.zshrc` (or `~/.bashrc`):

```bash
# Password to encrypt ServiceNow Sync tokens locally
export SN_ENC_SECRET="a-very-secure-secret-phrase-only-you-know"
```

Then reload: `source ~/.zshrc`.

### 3. Optional: Terminal alias (Zsh)

To run `snsync` from anywhere, add to your `~/.zshrc`:

```bash
alias snsync='node /Users/palomo/workspace/sn/_tool/sn-sync.js'
```

Then reload: `source ~/.zshrc`. Adjust the path if your repo lives elsewhere.

---

## 🚀 Usage Guide

### ⬇️ Pulling Data (Download)

- **Full Project**: Downloads all tables defined in `sn-config.json`.
- **Custom Query**: Search for specific records interactively.
  - _Tip_: Enable "AI Context" when asked to tag records with keywords (e.g., `Finance`, `Auth`).

### ⬆️ Pushing Data (Upload & Create)

- **Edit & Sync**: Just save the file (`.js`, `.html`) and run the "Push" task (or use Watch mode).
- **Create New Record**:
  1. Create a folder inside the table folder (e.g., `src/sys_script_include/MyNewScript`).
  2. Add your `script.js`.
  3. Run `snsync --push projects/myproject/src/sys_script_include/MyNewScript`.
  4. The script creates the record, gets the `sys_id`, and saves it locally.
- **Bulk Create**: Run push on the _Table_ folder to create all new subfolders at once.

### 🧠 AI Features

- **Context Tags**: Every record can have `_ai_context.md`. Search for "Context: MyTag" to find all related files.
- **Metadata**: `_record.json` contains the full record payload (display values, types) for the AI to analyze.

### 📦 Working with Catalog Items

Use the `--catalog-item` flag to pull everything related to a single catalog item: settings, form variables, and client scripts. Files are automatically organized in one folder instead of scattered across multiple table folders.

#### 🚀 How to Use

**1. Pull a complete catalog item:**

```bash
node snsync --pull --catalog-item <catalog_item_sys_id> --project projects/your-project
```

**Example:**

```bash
node snsync --pull --catalog-item a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6 --project projects/myproject
```

**What gets pulled:**

- ✅ **Catalog item** (settings, description, execution plan)
- ✅ **All form variables** (questions with editable parameters)
- ✅ **All client scripts** (onChange, onSubmit validation)
- ✅ **Flow Designer flow** (workflow actions - if assigned to catalog item)

**2. The organized structure:**

```
src/
└── Your_Catalog_Item_Name/
    ├── catalog_item/
    │   ├── _record.json        ← Edit: title, price, roles, workflow, visibility
    │   ├── description.html    ← Edit: catalog description
    │   └── script.js           ← Edit: execution plan (if any)
    ├── variables/
    │   ├── role/
    │   │   └── _record.json    ← Edit: label, mandatory, order, tooltip, help_text
    │   ├── team_name/
    │   │   └── _record.json    ← Edit variable parameters
    │   └── ...
    ├── client_scripts/
    │   ├── On_Change_of_role/
    │   │   └── script.js       ← Edit: validation logic
    │   ├── popup_on_submit/
    │   │   └── script.js       ← Edit: submission behavior
    │   └── ...
    └── flow/
        └── flow.json           ← Edit: workflow approval rules (DECODED!)
```

**3. Edit files locally:**

```json
// Example: catalog_item/_record.json
{
  "short_description": { "value": "Request Software License" },
  "price": { "value": "0" },
  "active": { "value": "true" },
  "roles": { "value": "itil,admin", "display_value": "ITIL, Admin" },
  "no_cart": { "value": "true" }
}
```

**4. Push changes back:**

```bash
node snsync --push --project projects/your-project
```

✨ **The tool automatically detects which files changed and only pushes those!**

**5. Validate UI-to-script mapping after catalog changes:**
```bash
node snsync --validate-catalog-mapping --project projects/your-project
```

Optional flags:
- `--catalog Access_request_to_GitHub` (validate one catalog folder)
- `--catalog-path src` (custom catalog base path)
- `--strict` (fail if expected catalog folder is missing)

#### 🎯 Editing Flow Designer Workflows

If your catalog item has a flow assigned, it's automatically pulled as `flow/flow.json` with **all actions decoded** and ready to edit!

**Example flow.json structure:**
```json
{
  "_meta": {
    "sys_id": "66abc0dd87f932105668c88d0ebb359f",
    "flow_id": "88a75b531b8952107fca32231b4bcb09",
    "name": "Access request to GitHub",
    "last_updated": "2025-12-12 14:54:46"
  },
  "actions": {
    "b397fbe08785f210f7a2a60d3fbb359a": {
      "order": 8,
      "ui_id": "25fd2f8f-12ba-4c14-9ecd-39bf5e20312a",
      "config": {
        "approval_conditions": "ApprovesRejectsAnyG[{{static.d3a933afc383ee1048abf00c0501311b}}]",
        "additional_approvers": "",
        "reminder_frequency": 0,
        "reminder_threshold": 0
      }
    }
  }
}
```

**Common flow edits:**

1. **Skip an approval (auto-approve):**
```json
"approval_conditions": ""  // Empty = auto-skip
```

2. **Change approval to a different group:**
```json
"approval_conditions": "ApprovesRejectsAnyG[{{static.YOUR_GROUP_SYS_ID}}]"
```

3. **Change approval to a specific user:**
```json
"approval_conditions": "ApprovesRejectsAnyU[{{static.USER_SYS_ID}}]"
```

4. **Require manager approval:**
```json
"approval_conditions": "ApprovesRejectsAnyU[{{triggerref.request_for.manager}}]"
```

After editing, just push:
```bash
node snsync --push projects/your-project/src/Your_Catalog_Item/flow/flow.json
```

✨ **The tool automatically re-encodes, validates, and pushes the flow!**

#### 💡 Pro Tips

- **Finding the sys_id**: Open the catalog item in ServiceNow → Right-click header → Copy sys_id
- **Bulk editing**: Use find/replace across all `_record.json` files to update multiple parameters at once
- **No prompts**: Unlike custom queries, catalog item pulls run without interruptions (no AI context prompts)

---

## 📂 Folder Structure

```
workspace/sn/
├── _tool/                  # The brain of operations
│   ├── sn-sync.js          # Main script
│   ├── create-project.js   # Scaffolding script
│   └── sn-config-template.json
├── projects/               # Your Clients/Instances
│   ├── client_A/
│   │   ├── .env            # Instance Configs (Ignored in Git)
│   │   ├── sn-config.json  # Table mappings for this project
│   │   └── src/            # Downloaded Source Code
│   └── client_B/
```

---

## 🚀 Creating a New Project

Use the VS Code Task to create everything automatically:

1. Open Command Palette (`Cmd+Shift+P`).
2. Type **"Run Task"** -> **"SN: Create New Project 🆕"**.
3. Fill in the data:
   - **Name**: `client_x` (folder name).
   - **URL**: `https://dev12345.service-now.com`
   - **Client ID/Secret**: If using OAuth (Recommended).
   - **User/Pass**: Leave blank if using OAuth.

This will create `projects/client_x` with `.env` and `sn-config.json` ready.

---

## 🎮 Daily Usage (VS Code Tasks)

We recommend using the tasks configured in `.vscode/tasks.json` instead of manual terminal.

### ⬇️ Pull (Download)

- **SN: Pull (Download) Project**: Downloads EVERYTHING defined in `sn-config.json`.
- **SN: Pull Custom (Query)**: Downloads only a specific table/query (e.g., `incident` with `active=true`). Note: Ensure custom tables/fields are mapped in `sn-config.json`.
- **SN: Pull Current Record Only**: If a file is open, updates only that specific record (surgical).

### ⬆️ Push (Upload)

- **SN: Push Current File**: Sends the file currently open in the editor.
- **SN: Watch (Monitor)**: Runs in background sending any saved file automatically.

### 🌎 Utilities

- **SN: Open Record in Browser**: Opens the current file's record directly in the browser.

---

## ⚙️ Configuration (sn-config.json)

Each project has its `sn-config.json` defining what to sync.

**Example:**

```json
"sp_widget": {
    "filter": "sys_updated_onONToday@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()",
    "fields": ["template", "script", "client_script", "css"],
    "ext": {
        "template": "html",
        "script": "server.js",
        "client_script": "client.js"
    },
    "saveContext": true
}
```

- **filter**: ServiceNow Encoded Query.
- **fields**: Table fields to download.
- **ext**: File extension for each field.
- **saveContext**: Saves a schema JSON to help AI/Copilot understand user configs.

---

## 📋 Supported Tables

The tool supports synchronization for the following ServiceNow tables:

**Core Scripts:**

- `sys_script_include` - Server-side Script Includes
- `sys_script_client` - Client Scripts
- `sys_script` - Business Rules
- `sys_ui_script` - UI Scripts
- `sys_ui_action` - UI Actions
- `sysauto_script` - Scheduled Jobs
- `sysevent_script_action` - Event Script Actions

**Service Catalog:**

- `sc_cat_item` - Catalog Items
- `sc_cat_item_producer` - Record Producers
- `catalog_script_client` - Catalog Client Scripts
- `item_option_new` - Catalog Variables

**Workflows:**

- `wf_workflow` - Workflow Definitions
- `wf_activity` - Workflow Activities
- `sys_hub_flow` - Flow Designer Flows
- `sys_hub_action_type_definition` - Flow Designer Actions

**Service Portal:**

- `sp_widget` - Service Portal Widgets
- `sp_angular_provider` - Angular Providers
- `sp_page` - Service Portal Pages
- `sp_css` - Portal CSS

**UI Components:**

- `sys_ui_macro` - UI Macros
- `sys_ui_page` - UI Pages
- `sys_ui_policy` - UI Policies

**Integration:**

- `sys_ws_operation` - Web Service Operations
- `sys_rest_message_fn` - REST Message Functions

---

## 🔐 Authentication: Browser vs. Basic

### Recommended: Browser Auth (OAuth)

1. In ServiceNow, create an **OAuth API Endpoint** (Create Application Endpoint).
   - **Redirect URL**: `http://localhost:3000/callback`
2. Copy Client ID and Client Secret.
3. In `.env`, set `SN_CLIENT_ID` and `SN_CLIENT_SECRET`. Leave `SN_USER` empty.
4. When running the tool, it will open the browser for you to log in.

### Alternative: Basic Auth

1. In `.env`, fill `SN_USER` and `SN_PASSWORD`.

---

## 🚑 Troubleshooting

- **"Version Conflict" Error?**
  Someone edited the file on the server after you downloaded it. Do a Pull and then apply your changes again.

- **Invalid/Expired Token?**
  The tool will try to renew automatically. If it fails, it will reopen the browser for re-authentication.

- **Where are my files?**
  Check if `sn-config.json` has the correct filter (e.g., `sys_updated_onONToday` only downloads things from today).
