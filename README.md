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
