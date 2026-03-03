# AI Agent Guide for ServiceNow Synchronization (snsync)

This guide provides instructions for AI agents (GitHub Copilot, Cursor, ChatGPT, etc.) on how to use the `snsync` tool to manage ServiceNow instances.

## Overview

This repository uses a Node.js CLI tool (`_tool/sn-sync.js`) to sync local files with a ServiceNow instance.

- **Local -> ServiceNow**: `node _tool/sn-sync.js --push ...`
- **ServiceNow -> Local**: `node _tool/sn-sync.js --pull ...`
- **Delete Record**: `node _tool/sn-sync.js --delete ...`

## Project Structure

- `_tool/`: Tool source code.
- `projects/levidev/`: The active project folder.
  - `sn-config.json`: Configuration file. defines table mappings.
  - `<table_name>/`: Folders named after ServiceNow tables (e.g., `sys_script`).
    - `<record_folder>/`: Folders named after records.
      - `_record.json`: The record's fields in JSON format.

## Capabilities

### 1. Create/Update Records

To create or update a record:

1.  **Identify the Table**: Determine the ServiceNow table (e.g., `sys_user`, `sys_script_include`).
2.  **Verify Mapping**: Check `projects/levidev/sn-config.json`. If the table is not in `"folders"`, add it.
3.  **Create File Structure**:
    - `mkdir -p projects/levidev/<table_name>/<record_name>`
    - Create `projects/levidev/<table_name>/<record_name>/_record.json`
4.  **Populate JSON**:
    ```json
    {
      "name": "My Record",
      "active": "true",
      "short_description": "Description here"
      // Add other fields as needed
    }
    ```
5.  **Push**:
    ```bash
    node _tool/sn-sync.js --push projects/levidev/<table_name>/<record_name> --project levidev
    ```

### 2. Delete Records

To delete a record:

```bash
node _tool/sn-sync.js --delete --target projects/levidev/<table_name>/<record_name> --project levidev --force
```

### 3. Schema Management

- **Tables**: Use `sys_db_object`. Create a folder and `_record.json` with `name`, `label`, `sys_scope`.
- **Columns**: Use `sys_dictionary`. Create a folder and `_record.json` with `name` (table name), `element` (column name), `internal_type`, `column_label`, `max_length`.
- **Choice Lists**: Use `sys_choice`.
- **Workflows**: Use `wf_workflow`.

## Best Practices

- **JSON Formatting**: Always use valid JSON.
- **Naming**: Use descriptive folder names. The tool uses `_record.json` content for actual record values, but the folder name helps organization.
- **Paths**: Always use relative paths from the workspace root (e.g., `projects/levidev/...`).
- **Dependencies**: Be aware of reference fields. For example, create the Table (`sys_db_object`) before creating Columns (`sys_dictionary`) for it.

## Troubleshooting

- **"Table not found"**: Add the table to `sn-config.json` under `"folders"`.
- **"Authentication failed"**: Check `sn-config.json` credentials (or prompting).
- **"Reference error"**: Ensure referenced records exist.
