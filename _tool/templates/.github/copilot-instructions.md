# ServiceNow Project Instructions for AI Assistant

## Project Context
This repository is a local representation of a ServiceNow instance, synchronized using a custom **Node.js Bridge (sn-sync.js)**.
- **Architecture:** Files are organized by Table and Record Name: `src/<Table>/<RecordName>/<Field>.ext`.
- **Sync Mechanism:** Saving a file (Ctrl+S) automatically uploads the code to the ServiceNow instance via the Table API.
- **Context:** 
  - Each record folder contains a hidden `.sys_id` file that links it to the server.
  - Table schema and available fields are documented in `src/<Table>/.ai_context/_schema.<Table>.json`. READ THIS JSON to understand available fields.

## Critical Workflow Rules
1.  **DO NOT Suggest Creating Files Manually:**
    - The folder structure relies on the hidden `.sys_id` file to work.
    - Creating a file manually will NOT create a record in ServiceNow and will fail to sync because it lacks the ID.
    - **CORRECT ACTION:** If I need a new Script Include or Business Rule, tell me to create it in the ServiceNow UI first, then run the **"SN: Pull (Download) Project"** task.

2.  **Sys_ID Handling:**
    - Do not invent or hallucinate `sys_id` values.
    - Treat `sys_id` as read-only metadata handled by the platform.

3.  **Global Scope Nuances:**
    - Since we are in the **Global** scope, avoid adding `x_` or `u_` prefixes to function names or classes unless explicitly requested.
    - Assume access to global system APIs (`gs.`, `g_form`, `GlideRecord`, `GlideSystem`) without strict scoping restrictions.

## Coding Standards (ServiceNow Best Practices)
- **Database Operations:**
    - Always prefer `GlideAggregate` over `GlideRecord` for counting records.
    - Always use `setLimit()` when querying for a check or single record update.
    - **Never** use `gr.update()` inside a loop without batching or reconsidering the logic.
- **Script Includes:**
    - Structure new Script Includes as strictly defined Classes (Prototype pattern).
    - Ensure functions are documented with `@param` and `@return` for IntelliSense.
- **Logging:**
    - Use `gs.info()`, `gs.warn()`, or `gs.error()` instead of `gs.log()`.
    - Prefix logs with the feature name for easier filtering (e.g., `[ClientA]: Log message`).
