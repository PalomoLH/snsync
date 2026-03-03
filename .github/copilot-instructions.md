# GitHub Copilot Instructions for ServiceNow Sync (snsync)

This repository contains a tool (`snsync`) for bi-directional synchronization between a local file system and a ServiceNow instance. As an AI assistant, you can use this tool to manage ServiceNow metadata (Tables, Fields, Scripts, etc.) and data directly from this workspace.

## 1. Project Structure

The workspace is organized as follows:

- `_tool/`: Contains the synchronization logic (`sn-sync.js`, `bin/snsync.js`).
- `projects/`: Contains project-specific configurations and data.
  - `<project_name>/` (e.g., `levidev`):
    - `sn-config.json`: Configuration for the project (instance URL, auth, table mappings).
      - **IMPORTANT**: If you need to work with a table that is not yet mapped, add it to the `"folders"` object in `sn-config.json` first.
    - `<table_name>/` (e.g., `sys_script`, `sys_db_object`):
      - `<record_folder>/` (e.g., `my_script_include`):
        - `_record.json`: The metadata/content of the record.
        - `script.js` (optional): Externalized script content (if configured).

## 2. Key Concepts

- **Folder = Record**: Each record in ServiceNow is represented by a folder.
- **`_record.json`**: This file contains the field values for the record.
- **Table Mapping**: Mappings between local folders and ServiceNow tables are defined in `projects/<project>/sn-config.json`.
  - **Standard Tables**: `sys_script`, `sys_script_include`, `sys_ui_action`, etc.
  - **Schema Tables**: `sys_db_object` (Tables), `sys_dictionary` (Columns), `sys_choice` (Choice Lists).
  - **Logic Tables**: `wf_workflow` (Workflows), `sys_ui_policy` (UI Policies).

## 3. Operations & Commands

Use the `snsync` tool via `node sn-sync.js` (or `node _tool/sn-sync.js`) to interact with ServiceNow.

### A. Creating Records (Push)

To create a new record in ServiceNow:

1.  **Create the Folder**: Create a directory: `projects/<project>/<table_name>/<record_name>`.
    - **Note**: `<record_name>` is used as a folder name but doesn't strictly have to match the record's `name` or `sys_id`. It's best practice to name it clearly.
2.  **Create `_record.json`**: Add the JSON file with the record's fields.
    ```json
    {
      "name": "My Record Name",
      "active": "true",
      "short_description": "Created via AI"
    }
    ```
3.  **Push**: Run the push command pointing to the _file_ or _folder_.
    ```bash
    node _tool/sn-sync.js --push projects/levidev/<table_name>/<record_name> --project levidev
    ```

### B. Updating Records (Push)

Edit the `_record.json` file and run the same `--push` command. The tool will update the existing record based on the `sys_id` stored in `_record.json` (created after the first push).

### C. Deleting Records

To delete a record from ServiceNow and the local file system:

```bash
node _tool/sn-sync.js --delete --target projects/levidev/<table_name>/<record_name> --project levidev --force
```

- Use `--force` to skip interactive confirmation (useful for automated scripts).

### D. Reading/Pulling Records

To download specific records from ServiceNow:

```bash
node _tool/sn-sync.js --pull --table <table_name> --query "<encoded_query>" --project levidev
```

- This will create the folder structure under `projects/levidev/<table_name>/<record_sys_id_or_name>`.

## 4. Managing Schema (Tables & Fields)

You can create new Tables and Columns by creating records in `sys_db_object` and `sys_dictionary`.

### Creating a Table (`sys_db_object`)

1.  Navigate to `projects/levidev/sys_db_object/`.
2.  Create folder: `<table_name_folder>` (e.g., `x_snc_ai_test`).
3.  Create `_record.json`:
    ```json
    {
      "name": "x_snc_ai_test",
      "label": "AI Test Table",
      "sys_scope": "Global"
    }
    ```
4.  Run: `node _tool/sn-sync.js --push projects/levidev/sys_db_object/<table_name_folder> --project levidev`

### Creating a Column (`sys_dictionary`)

1.  Navigate to `projects/levidev/sys_dictionary/`.
2.  Create folder: `<table_column_folder>` (e.g., `x_snc_ai_test_status`).
3.  Create `_record.json`:
    ```json
    {
      "name": "x_snc_ai_test", // The table name
      "element": "status", // The column name
      "internal_type": "string",
      "column_label": "Status",
      "max_length": "40"
    }
    ```
4.  Run: `node _tool/sn-sync.js --push projects/levidev/sys_dictionary/<table_column_folder> --project levidev`

## 5. Tips for AI

- **Always verify the path**: Ensure you are in the correct project folder (`projects/levidev`).
- **Use `sys_id` for References**: When linking records (e.g., a field referencing a table), you may need the `sys_id`. However, for `sys_dictionary`, `name` (table) and `element` (column) are usually sufficient.
- **Check `sn-config.json`**: If a table folder (e.g., `sys_user`) doesn't exist, check `sn-config.json` to see if it's mapped. If not, add it to the `folders` object in `sn-config.json`.
