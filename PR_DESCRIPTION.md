# feat: Add Service Catalog, Workflow support + Unified Catalog Item Workflow

## Service Catalog and Workflow Tables

Added synchronization support for ServiceNow Service Catalog and Workflow tables:

### Service Catalog tables:
- **sc_cat_item**: Catalog Items with script and execution_plan fields
- **sc_cat_item_producer**: Record Producers
- **catalog_script_client**: Catalog Client Scripts
- **item_option_new**: Catalog Variables/Questions

### Workflow tables:
- **wf_workflow**: Workflow Definitions
- **wf_activity**: Workflow Activities with script support
- **sys_hub_flow**: Flow Designer Flows
- **sys_hub_action_type_definition**: Flow Designer Custom Actions

---

## NEW: Unified Catalog Item Workflow

Added `--catalog-item` flag for pulling complete catalog items in one command:

```bash
node snsync --pull --catalog-item <sys_id> --project projects/myproject
```

### What gets pulled:
- Catalog item (settings, description, execution plan)
- All form variables (with editable parameters via jsonExport)
- All client scripts (onChange, onSubmit validation)

### Automatic file organization

Files are organized by catalog item name instead of scattered across table folders:

```
src/
└── Catalog_Item_Name/
    ├── catalog_item/      (settings in _record.json, description.html)
    ├── variables/         (editable parameters per variable)
    └── client_scripts/    (validation logic)
```

### Parameter editing

Edit catalog item and variable parameters directly in `_record.json` files:
- Catalog items: title, price, roles, visibility, workflow, etc.
- Variables: mandatory fields, order, tooltips, help text, etc.

---

## What This Enables

Developers can now:
- ✅ Pull complete catalog items with one command
- ✅ Edit catalog parameters in code instead of UI
- ✅ Work with organized, version-control-friendly file structure
- ✅ Sync catalog client scripts (form validation, onChange handlers)
- ✅ Work with workflow activities and their scripts
- ✅ Manage Flow Designer flows and custom actions

---

## Changes

### Files Modified:
- **_tool/sn-sync.js**: 
  - Added `pullCatalogItem()` function for unified pulling
  - Added `--catalog-item` flag support
  - Added `skipContextPrompt` option to suppress prompts during catalog pulls

- **_tool/templates/sn-config.json**: 
  - Added 8 new table configurations
  - Added `jsonExport` for `sc_cat_item` (40+ editable parameters)
  - Added `jsonExport` for `item_option_new` (20+ editable parameters)

- **README.md**: 
  - Added "Working with Catalog Items" section with complete workflow documentation
  - Added supported tables documentation organized by category

---

## Testing

Tested with ServiceNow catalog items including:
- Multiple form variables with various field types
- Client scripts with validation logic
- Catalog items with workflows and execution plans
- Parameter editing and push operations
