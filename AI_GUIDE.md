# AI Agent Guide for ServiceNow Synchronization (snsync)

This guide provides instructions for AI agents (GitHub Copilot, Cursor, ChatGPT, etc.) on how to use the `snsync` tool to manage ServiceNow instances.

## Overview

This repository uses a Node.js CLI tool (`node snsync`) to sync local files with a ServiceNow instance.

- **Local -> ServiceNow**: `node snsync --push ...`
- **ServiceNow -> Local**: `node snsync --pull ...`
- **Delete Record**: `node snsync --delete ...`

## Project Structure

- `_tool/`: Tool source code (`bin/snsync.js`, `flow-modifier.js`).
- `projects/<your-project>/`: The active project folder.
  - `sn-config.json`: Configuration file. defines table mappings.
  - `src/<CatalogItemName>/`: Catalog items pulled via `--catalog-item` are organized here.
    - `catalog_item/`: Catalog item settings (`_record.json`, `description.html`).
    - `variables/`: Form variables (`item_option_new` records).
    - `client_scripts/`: Client scripts (`catalog_script_client` records).
    - `flow/`: Automation — `flow.json` (Flow Designer) or `workflow.json` (Legacy Workflow).
  - `<table_name>/`: Folders named after ServiceNow tables (e.g., `sys_script`).
    - `<record_folder>/`: Folders named after records.
      - `_record.json`: The record's fields in JSON format.

## Capabilities

### 1. Create/Update Records

To create or update a record:

1.  **Identify the Table**: Determine the ServiceNow table (e.g., `sys_user`, `sys_script_include`).
2.  **Verify Mapping**: Check `projects/<your-project>/sn-config.json`. If the table is not in `"folders"`, add it.
3.  **Create File Structure**:
    - `mkdir -p projects/<your-project>/<table_name>/<record_name>`
    - Create `projects/<your-project>/<table_name>/<record_name>/_record.json`
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
    node snsync --push projects/<your-project>/<table_name>/<record_name> --project <your-project>
    ```

### 2. Delete Records

To delete a record:

```bash
node snsync --delete --target projects/<your-project>/<table_name>/<record_name> --project <your-project> --force
```

### 4. Pull a Complete Catalog Item

To pull a catalog item with all its related data (variables, client scripts, and flow/workflow) in one command:

```bash
node snsync --pull --catalog-item <catalog_item_sys_id> --project projects/<your-project>
```

This automatically:
- Pulls the catalog item record (`sc_cat_item`)
- Pulls all form variables (`item_option_new`)
- Pulls all client scripts (`catalog_script_client`)
- Detects and pulls the linked flow: `flow/flow.json` (Flow Designer) or `flow/workflow.json` (Legacy Workflow Engine)
- Organizes everything under `src/<CatalogItemName>/`

The `<catalog_item_sys_id>` is the `sys_id` from the catalog item URL, e.g.:
```
https://<instance>.service-now.com/services?id=sc_cat_item&sys_id=<catalog_item_sys_id>
```

### 5. Schema Management

- **Tables**: Use `sys_db_object`. Create a folder and `_record.json` with `name`, `label`, `sys_scope`.
- **Columns**: Use `sys_dictionary`. Create a folder and `_record.json` with `name` (table name), `element` (column name), `internal_type`, `column_label`, `max_length`.
- **Choice Lists**: Use `sys_choice`.
- **Catalog Items**: Use `--catalog-item` to pull a complete catalog item. See section 4 above.

## Best Practices

- **JSON Formatting**: Always use valid JSON.
- **Naming**: Use descriptive folder names. The tool uses `_record.json` content for actual record values, but the folder name helps organization.
- **Paths**: Always use relative paths from the workspace root (e.g., `projects/<your-project>/...`).
- **Dependencies**: Be aware of reference fields. For example, create the Table (`sys_db_object`) before creating Columns (`sys_dictionary`) for it.

## Troubleshooting

- **"Table not found"**: Add the table to `sn-config.json` under `"folders"`.
- **"Authentication failed"**: Check `sn-config.json` credentials (or prompting).
- **"Reference error"**: Ensure referenced records exist.
