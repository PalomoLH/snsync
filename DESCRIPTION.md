# ServiceNow Sync Tool (SNSync) 🚀

**Develop for ServiceNow with VS Code speed.**

**SNSync** is an open-source *CLI* and *Developer Bridge* allowing code synchronization (Scripts, Widgets, UI Macros, etc) between your ServiceNow instance and local environment. Designed for developers demanding performance, security, and a modern Developer Experience (DX).

![VS Code Tasks Integration](https://img.shields.io/badge/VS%20Code-Tasks%20Ready-blue) ![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green) ![Security](https://img.shields.io/badge/OAuth%202.0-Secure-lock)

---

## 🔥 Why use it?

Unlike traditional extensions or XMLs, SNSync focuses on **Context**, **Security**, and **Automation**:

*   **🔒 OAuth 2.0 Browser Flow**: No more passwords in `.env` files. Authenticate via secure browser flow, locally encrypted cache (AES-256), and Auto-Logout on inactivity.
*   **📂 Smart Structure**: Organizes files by `Table/Record/Field.js` with automatic conflict detection.
*   **🤖 AI-Ready Context**: Automatically generates schemas (`keys`, `choices`, `refs`) from your records to feed GitHub Copilot/Codeium, enabling real instance autocompletion.
*   **🛡️ Collision Protection**: Prevents overwriting a colleague's code by checking `sys_updated_on` on server before every push.
*   **⚡ Surgical & Bulk Sync**:
    *   *Surgical*: Download/Upload only the record you are editing.
    *   *Bulk*: Download entire project filtered by query (e.g., `sys_updated_onONToday`).

## 🚀 Quick Start

1.  **Clone Repo**:
    ```bash
    git clone https://github.com/YOUR_USER/sn-sync-tool.git
    cd sn-sync-tool
    ```

2.  **Install Dependencies**:
    ```bash
    cd _tool
    npm install
    ```

3.  **Create 1st Project**:
    In VS Code, run Task: **`SN: Create New Project 🆕`**
    *(Or use script manually: `node _tool/create-project.js --name my_client --instance https://dev00000.service-now.com`)*

4.  **Code!**:
    Use `Cmd+Shift+P` -> `Run Task` to access **Pull**, **Push**, **Watch**, and **Open** commands.

## 🛠️ Tech Stack

*   **Node.js**: Automation core.
*   **Axios**: Fast REST API communication.
*   **Express**: Local server for OAuth callback.
*   **Chokidar**: Real-time file watcher.

---
*Built with ❤️ for the ServiceNow Community.*
