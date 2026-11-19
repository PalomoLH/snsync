---
name: sn-pa-dashboard
description: Build ServiceNow Platform Analytics (PA) dashboards with snsync, covering the dashboard itself (par_dashboard, par_dashboard_tab, par_dashboard_canvas, par_dashboard_widget) and the PA data behind it (pa_cubes indicator sources, pa_indicators including formula/% indicators, pa_dimensions breakdown sources, pa_breakdowns, pa_breakdown_mappings, pa_indicator_breakdowns). Use whenever the user wants to create, clone, extend or understand a PA / Platform Analytics / Next Experience dashboard, add tabs or widgets, add indicators or breakdowns (by assignment group, priority, CI, state…), build "% of X by Y" formula indicators, or follow the Pull → Learn → Develop → Push dashboard workflow, even if they only say "make a dashboard for incidents and requests" or "add a priority breakdown".
---

# Building a Platform Analytics dashboard with snsync

The reference for every table, field and choice value is `_tool/Docs/platform-analytics.md`. Read it the first time you use this skill in a session. Sections 2 and 3 cover fields, section 4 lists the levidev records worth reusing, and section 5 covers % formulas. This file is the workflow.

The workflow is **Pull → Learn → Develop (spec) → Plan → Push (build) → Collect → Verify**. The build is driven by a JSON spec and `scripts/pa-build.cjs`, so references between ~30 records resolve automatically and the push order is always right.

## 0. Guards

- **Never write to `projects/leviprod`.** Pull from it freely, but build in `projects/levidev`. The script refuses leviprod paths too, but check yourself first.
- **Update Set:** ask the user which one to use if they haven't said. snsync takes the Update Set from `sn-config.json` → `scopes.global.updateSet` **before** the `--update-set` flag, so a stale config value silently wins. `pa-build.cjs build` refuses to run until the two match. For a new Update Set, this command creates it and also writes the config:
  ```bash
  node snsync --create-update-set "<Name>" --scope global --project projects/levidev
  ```
  For an existing Update Set, set `scopes.global.updateSet`/`updateSetSysId` in `projects/levidev/sn-config.json`, and tell the user you changed it.
- `leviaskhr` is writable, but confirm with the user first.

## 1. Pull

The tables are already mapped in `sn-config.json` (PA records → `_record.json`; big fields → `component_props.json`, `layout.json`, `formula.txt`, `conditions.txt`). Run from the repo root. Every command below ends with `--project projects/levidev --context-action skip` (shown as `...`):

```bash
node snsync --pull --table par_dashboard        --query "name=Incident Management" ...
node snsync --pull --table par_dashboard_tab    --query "dashboard=<dash_id>" ...
node snsync --pull --table par_dashboard_canvas --query "dashboard=<dash_id>" ...
node snsync --pull --table par_dashboard_widget --query "canvas.dashboard=<dash_id>" ...
node snsync --pull --table pa_indicators        --query "nameLIKEopen incidents" ...
node snsync --pull --table pa_indicator_breakdowns --query "indicator=<ind_id>" ...
node snsync --pull --table pa_breakdown_mappings   --query "breakdown=<bk_id>^facts_table=incident" ...
```
- A pull returns at most 100 records, so narrow the query.
- Tables without a `name` field land in `Record`, `Record_xxxxx` folders. Read `_record.json` to tell them apart.
- Read `.sys_id` for the dashboard id. The OOB **Incident Management** dashboard (`1e4e9cc4c31e3110458f1fec5440dd66`) is the best reference.

## 2. Learn: reuse before you create

For each number the dashboard needs, walk the chain and note what exists:

1. **Indicator source** (`pa_cubes`) on the right table. For "open" counts, the conditions must use the *open on the collection date* pattern (doc §3), not `active=true`.
2. **Indicator** (`pa_indicators`) on that source.
3. **Breakdown** (`pa_breakdowns`) for each grouping, and its **source** (`pa_dimensions`).
4. **Mapping** (`pa_breakdown_mappings`) from the breakdown to the source's `facts_table` and field. This is the link most often missing. Example: levidev has no `incident.cmdb_ci` mapping.
5. **Link** (`pa_indicator_breakdowns`) between indicator and breakdown. Without it, a widget can't group that indicator by the breakdown.

Show the user a short "reuse / create" table before building. Creating duplicates of OOB sources and breakdowns clutters PA and splits collected history.

**Priority breakdowns** use `sys_choice`, not the field directly: source `facts_table=sys_choice`, `field=sys_id`, conditions `name=task^element=priority^language=en^inactive=false^ORinactiveISEMPTY`. In levidev, priority choices exist only on `task`, so `name=incident` returns no elements. Check `sys_choice` for the table in question before choosing `name=`. The mapping still uses the plain field (`incident.priority`).

**"% of open X by group/priority"**: a formula indicator `[[open]] / [[open_total]] * 100`. Here `open_total` is a *separate* automated indicator on the same source with **no** breakdowns, and the formula gets its own `pa_indicator_breakdowns` links. Using the same indicator twice gives 100% for every element. See doc §5, and validate after the first collection that the elements add up to about 100%.

## 3. Develop: write the spec

Write the spec somewhere like `projects/levidev/notes/<dashboard>.spec.json` (git-ignored, next to the data). Start from `examples/incidents-requests.spec.json`, which is a complete Incidents + Requests dashboard built on reused OOB records.

```jsonc
{
  "project": "projects/levidev",
  "updateSet": "PA - My Dashboard v1",
  "records": [
    { "key": "ind_open", "table": "pa_indicators", "existing": "<sys_id>" },        // reuse: reference only, never pushed
    { "key": "ind_total", "table": "pa_indicators", "fields": { "name": "...", "type": "1", "cube": "@ref:src", ... } },
    { "key": "pct", "table": "pa_indicators", "fields": { "type": "2", "formula": "( [[@ref:ind_open]] / [[@ref:ind_total]] ) * 100", ... } },
    { "key": "dash", "table": "par_dashboard", "fields": { "name": "My Dashboard", "grid": "48", "active": "true" } },
    { "key": "w1", "table": "par_dashboard_widget", "folder": "MyDash_Open",
      "fields": { "name": "Open incidents", "canvas": "@ref:cv_inc", "x": 0, "y": 0, "w": 12, "h": 7 },
      "template": "single_score_indicator", "vars": { "INDICATOR": "@ref:ind_open" }, "props_patch": { "showSparkline": true } }
  ]
}
```
- `@ref:<key>` is replaced by that record's sys_id (from `existing`, or from the `.sys_id` written after it's created). The script orders records by these references.
- `fields` hold plain values. Mapped file fields (`formula`, `conditions`, `layout`, `component_props`, `script`) go to their files automatically. Objects are JSON-stringified. `{ "@file": "job.js" }` loads a field from a file next to the spec (use it for scripts).
- The spec can create any mapped table, not just PA ones: `sys_dictionary` fields, `sys_choice`, `sys_properties`, `sysauto_script`. Example: `projects/levidev/notes/dtlt-cmdb/foundation.spec.json`.
- Set `folder` on tabs, canvases, widgets and link records so names don't collide across dashboards.
- Dashboard structure: one `par_dashboard_tab` per tab, one `par_dashboard_canvas` per tab, **plus one canvas with only `dashboard`** (OOB always has it). Widget `layout` on canvases is generated for you.
- Field values and choice numbers are in doc §3. Use `type` 1 automated / 2 formula, `aggregate` 1 count, `direction` 1 none / 2 minimize / 3 maximize, `frequency` 10 daily, and units `#`=`17b365e2d7320100ba986f14ce6103ad`, `%`=`f9c365e2d7320100ba986f14ce6103b8`.
- If the user asks for the PA layer only ("don't create the reports yet"), leave widgets out of the spec. The dashboard, tabs and canvases can still be created empty.

### Widget templates (`templates/`)
Taken from real OOB widgets. Set `template` and fill `vars` (keys without underscores). The script fills ids, title and defaults.

| template | component | required vars | optional vars (default) |
|---|---|---|---|
| `single_score_indicator` | Single score | `INDICATOR` | `INDICATOR_TYPE` ("1"; "2" for formulas), `AGGREGATE` ("" = latest score), `FREQUENCY` (10) |
| `column_breakdown_indicator` | Column | `INDICATOR`, `BREAKDOWN` | `IS_CHOICE` (false; **true for priority/sys_choice**), `IS_BUCKET` (false), `MAX_GROUPS` ("ALL"), `INDICATOR_TYPE`, `AGGREGATE`, `FREQUENCY` |
| `donut_breakdown_indicator` | Donut | same as column | same as column |
| `filter_breakdown` | Filter | `BREAKDOWN`, `BREAKDOWN_SOURCE_NAME`, `ELEMENT_TABLE` (sys_choice / sys_user_group / cmdb_ci), `TAB` (@ref of the tab), `TARGETS` (array) | `IS_CHOICE`, `ELEMENT_FIELD` ("sys_id"; the source's key field, e.g. `name` for sys_db_object) |
| `hbar_breakdown_indicator` | Horizontal bar, sorted by value desc | `INDICATOR`, `BREAKDOWN` | as column |
| `hbar_multi_indicator` | Horizontal bar, one bar per indicator | `metrics` (see below) | |
| `line_multi_indicator` | Line, one line per indicator, monthly | `metrics` | `PERIODS` (12); per metric `AXIS` ("primary" / "secondary") |
| `list_table` | List, real-time table source | `TABLE`, `FILTER_QUERY` (add `^ORDERBY…` to sort), `COLUMNS` (comma list, dot-walks OK) | `COLUMN_LIMIT` (6) |
| `heading` | Heading | none (uses `name`) | |
| `bar_table` | Vertical bar, real-time table source (no PA) | `TABLE`, `FILTER_QUERY`, `GROUP_FIELD` | `IS_CHOICE`, `MAX_GROUPS` |

- **Multi-metric widgets:** put `"metrics": [{ "INDICATOR": "@ref:x", "LABEL": "…", "INDICATOR_TYPE": "2", "AGGREGATE": "…", "FREQUENCY": 40, "AXIS": "secondary" }, …]` on the widget. Each entry becomes its own data source + metric, cloned from the template's first one.
- For time series (e.g. a monthly column), set `AGGREGATE` to a `pa_aggregates` sys_id (`1d7a2073eb21020065deac6aa206fe5c` = By month SUM +) with `FREQUENCY` 40.
- Other visualizations (pie, pivot, gauge…): pull an OOB widget of that type, copy its `component_props.json` into `templates/<name>.json`, and replace the instance ids with `__VAR__` placeholders. The full component list is in doc §2.
- **Grid:** 48 columns. Full width `w:48`, half `w:24`. Typical heights: filters 4, headings 3, single scores 7, charts 14. Stack rows by adding the previous row's `h` to `y`.
- **Colors:** set `COLOR` (a `sys_report_color` sys_id) in `vars`, or on each entry of `metrics`. The script writes a `singleColor` colorConfig. `COLOR_RULES: [{ "operator": ">=", "value1": 95, "color": "<id>" }]` adds thresholds; `COLOR` is the fallback when no rule matches. For donuts grouped by a choice field use `props_patch: { "colorConfig": { "type": "chartColor" } }` plus `sys_report_chart_color` rows (name = table, element = field, value, color_name). Named colors such as SeaGreen, RoyalBlue, Crimson, Darkorange and GoldenRod exist in `sys_report_color`.
- **Always set a component.** Every template must be in `TEMPLATE_COMPONENT` in `pa-build.cjs`, or the widget falls back to the field default and shows "Can't display this information".

## 4. Plan, then build

```bash
node .claude/skills/sn-pa-dashboard/scripts/pa-build.cjs plan  <spec.json>                 # validate, order, NEW vs existing; no writes
node .claude/skills/sn-pa-dashboard/scripts/pa-build.cjs plan  <spec.json> --show <key>    # print one rendered record/widget
node .claude/skills/sn-pa-dashboard/scripts/pa-build.cjs build <spec.json>                 # create records via snsync, in order
```
- Before `build`, show the user the plan (environment, Update Set, NEW records). Building is a write to the instance.
- `build` writes each folder under `projects/<env>/src/<table>/<folder>/` and runs `node snsync --push src/<table>/<folder> --project … --update-set …`. It then reads the new `.sys_id` and continues. At the end it pushes each canvas `layout.json` mirroring its widgets, and writes `<spec>.result.json` with every sys_id.
- **It is resumable.** Records whose folder already has a `.sys_id` are skipped, so fix the error and re-run `build`.
- **Changing existing records:** edit the spec and run `build <spec> --update`. It re-renders every record and pushes each mapped *file* field that changed (`component_props`, `x/y/w/h`, `component`, `formula`, `conditions`, `script`, `value`…), then rebuilds the canvas layout. Fields that live only in `_record.json` (e.g. a widget's `name`) can't be updated this way.
- **PA refuses to change an indicator's `cube` once it has scores.** Create a new indicator on the new source and repoint the widgets.
- **RLQUERY only works in indicator *source* (`pa_cubes`) conditions.** It's ignored in indicator and breakdown-source conditions. For breakdown sources use `sys_idINjavascript:new global.SomeUtil().getIds()` (client-callable script include).
- **Version conflicts after UI edits:** opening and saving a dashboard in the UI bumps widget timestamps, so `--update` gets BLOCKED. Pull the widgets (`--table par_dashboard_widget --query "canvas.dashboard=<id>"`; they land in name-based folders), compare `component_props.json` with the spec folder, and if nothing meaningful changed move the pulled folder over the spec folder and re-run. Never use `--pull --target` with a repo-root path: it falls back to a full pull of every mapped table.
- If a canvas layout push is BLOCKED (version conflict), the instance changed the canvas when the widgets were inserted. Pull the canvas, check whether `layout.json` already lists the widgets, and only re-push if it doesn't.

## 5. Collect and verify

- **Data collection:** new indicators show nothing until scores exist. Ask the user to add the new automated indicators to a PA job (`sysauto_pa` / Indicators related list) and run a historic collection. Formula indicators compute from their components. Scores are not captured in Update Sets.
- **Update Set:** confirm the records landed in the right Update Set:
  ```bash
  node snsync --pull --table sys_update_xml --query "update_set.name=<US>^nameSTARTSWITHpa_^ORnameSTARTSWITHpar_" --project projects/levidev --context-action skip
  ```
- **Open it:** `https://levidev.service-now.com/now/platform-analytics-workspace/dashboards/params/edit/false/sys-id/<dash_sys_id>`. If that route differs on the instance, find it from the Platform Analytics workspace. Check that each tab renders, the filters affect the widgets, and the % elements add up to about 100%.

## 6. Report back

Tell the user:
- the environment and Update Set used;
- the records created, with links or sys_ids from `<spec>.result.json`, and the records reused;
- what they must do in the instance: run the collection job, then promote the Update Set;
- anything still unvalidated, such as the formula behavior before the first collection.
