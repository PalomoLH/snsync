# Platform Analytics dashboards with snsync

How Platform Analytics (PA) dashboards are built in ServiceNow, which tables hold them, and how to pull, build and push them with snsync.

Everything here was learned from real records in `levidev` (2026-10-06). The main reference is the OOB **Incident Management** dashboard (`par_dashboard` `1e4e9cc4c31e3110458f1fec5440dd66`). It is a good template because it uses PA indicators, breakdowns, a formula indicator and filters.

---

## 1. The two layers

A dashboard is two separate stacks of records. The **presentation layer** decides what is drawn and where. The **data layer** (PA) decides what numbers exist. A widget can skip the data layer and query a table in real time.

```
PRESENTATION (Next Experience)                       DATA (Performance Analytics)
──────────────────────────────                       ────────────────────────────
par_dashboard                                        pa_cubes            (Indicator Source: table + filter + frequency)
 └─ par_dashboard_tab        (dashboard)              └─ pa_indicators   (cube + aggregate → one number per day)
     └─ par_dashboard_canvas (dashboard, dashboard_tab)      ├─ type=2 formula: [[ind_sys_id]] / [[ind_sys_id]] * 100
         └─ par_dashboard_widget (canvas)                    └─ pa_indicator_breakdowns (indicator ↔ breakdown)
              component_props.dataSources ──────────┐   pa_dimensions       (Breakdown Source: table of possible elements)
                 sourceType "table"  → live query   │    └─ pa_breakdowns   (dimension)
                 sourceType "indicator" → PA scores ┘         └─ pa_breakdown_mappings (breakdown + facts_table + field)
                                                     sysauto_pa / pa_job_indicators (collection job → pa_scores_*)
```

**Key rule:** an indicator widget shows **nothing** until a data collection job has run for that indicator. A table widget shows data right away.

---

## 2. Presentation layer: real fields

### `par_dashboard`
| Field | Notes |
|---|---|
| `name` | translated field |
| `description`, `active` | |
| `grid` | Column count of the canvas grid. **48** on every dashboard checked. |
| `certified`, `base_dashboard`, `experience` | Usually empty. `base_dashboard` points to the original when a dashboard is a clone. |

Owners, sharing and permissions are **not** fields on the dashboard. They live in related tables such as `par_dashboard_permission`.

### `par_dashboard_tab`
`name`, `dashboard` → par_dashboard, `order` (0, 1, 2…), `active`, `background_color`.

### `par_dashboard_canvas`
`dashboard`, `dashboard_tab`, `layout` (string, JSON).
- Both dashboards checked have **one canvas per tab**, plus **one canvas with an empty `dashboard_tab`** whose `layout` is `[]`. Create that extra canvas too, to match OOB.
- `layout` is a **JSON array that mirrors every widget on the canvas**: `{sys_id, x, y, w, h, name, component_id, component_props}`. The UI keeps the canvas `layout` and the widget records in sync. When you create widgets through the API, write both and keep them identical.

### `par_dashboard_widget`
| Field | Notes |
|---|---|
| `canvas` | → par_dashboard_canvas |
| `name` | Widget title. Headings and filters are often unnamed, so snsync pulls them as `Record`, `Record_xxxxx`. |
| `x`, `y`, `w`, `h` | Grid position on the 48-column grid. Full width = `w:48`; half width = `w:24` at `x:0` or `x:24`. Charts are usually `h:14`, single scores `h:7`, filters `h:4`, headings `h:3`. |
| `component` | → `sys_ux_macroponent` (which visualization; IDs below) |
| `component_props` | **The real configuration: JSON string** (data sources, metrics, group-by, styling) |
| `widget_props`, `visualization`, `stored_component` | Empty in the samples checked |

Component sys_ids (levidev; OOB records, so they should match other instances):

| Visualization | `component` |
|---|---|
| Single score | `d24d53f60350de7a652caf3188a46ed2` |
| Column | `2bd5dc19a7ad083941b7c992a966dd78` |
| Vertical bar | `23051643b7e03010097cb81cde11a910` |
| Horizontal bar | `85855283b7e03010097cb81cde11a91d` |
| Line | `18ac962264404bcc0039359d184b15f3` |
| Donut | `a2b0596cec6b9d49dd1ff9bf76b5084b` |
| Pie | `96abe7e38d8790718022c5630a92176c` |
| Heatmap | `d1f6c60ce95607ea1ef236430d5fdec9` |
| Pivot Table | `06f6aacbd1818110f877d87436272684` |
| List | `7ff373544303121093711347efb8f23c` |
| Gauge | `037bd8ea3013833fd049186779528b70` |
| Filter | `226449101138d0dff1abe0e1566c8b2a` |
| Heading | `1f6e0643eca7a637e36bd7833549ec9e` |

### `component_props` anatomy

Three parts work together. `dataSources` says where the data comes from. `metrics` says what to compute, and each metric points to a data source by `id`. `groupBy` says how to slice it, and points to a data source and a metric. The `id` values are opaque base64 strings, but they only have to be unique and match each other inside the widget.

**Indicator data source** (PA scores), from "Incidents created (by priority)":
```json
"dataSources": [{
  "sourceType": "indicator", "label": "Number of incidents created",
  "indicatorType": "1", "isScriptedIndicator": false, "allowRealTime": true, "allowTotalValue": true,
  "uuid": { "indicator": "<pa_indicators.sys_id>", "breakdowns": [] },
  "id": "<ds-id>", "dataCategories": ["trend","group","simple"]
}],
"metrics": [{ "dataSource": "<ds-id>", "id": "<metric-id>",
  "aggregateIndicator": "<pa_aggregates.sys_id>",   // e.g. 1d7a2073eb21020065deac6aa206fe5c = "By month SUM +"
  "frequency": 40, "frequencyInterval": "MONTH_PLUS", "axisId": "primary" }],
"groupBy": [{ "groupBy": [{ "dataSource": "<ds-id>", "metric": "<metric-id>",
  "groupByField": "<pa_breakdowns.sys_id>",          // the BREAKDOWN sys_id, not a field name
  "isChoice": true, "isRange": false, "isPaBucket": false }],
  "maxNumberOfGroups": "ALL", "showOthers": false }]
```
For an indicator source, grouping uses a **breakdown sys_id**. The breakdown must be linked to the indicator through `pa_indicator_breakdowns`.

**Table data source** (real time, no PA), from the custom "Incidentes Andes" dashboard:
```json
"dataSources": [{ "sourceType": "table", "tableOrViewName": "incident", "isDatabaseView": false,
  "filterQuery": "assignment_groupLIKEAndes^state!=6", "id": "<ds-id>", ... }],
"metrics": [{ "dataSource": "<ds-id>", "aggregateFunction": "COUNT", ... }],
"groupBy": [{ "groupBy": [{ "dataSource": "<ds-id>", "groupByField": "cmdb_ci", "isChoice": false }],
  "maxNumberOfGroups": 10 }]
```
For a table source, grouping uses a plain field name, and no PA records are needed.

**Filter widget** (`226449…`). It filters by a PA breakdown and pushes the selection to targets, both tables and indicators:
```json
{ "filterName": "Priority", "filterComponentType": "multiselect",
  "datasource": { "type": "pa", "breakdown": { "sysId": "0df47e02d7130100b96d45a3ce610399",
      "breakdownSourceName": "Incident.Priority", "isOfChoiceType": true, "type": "AUTOMATED",
      "factsTable": "sys_choice", "field": "sys_id", "targetTable": "sys_choice" } },
  "targets": [ { "type": "table", "table": {"id":"incident"}, "field": {"id":"priority","type":"choice"} },
               { "type": "pa", "breakdown": { "sysId": "0df47e02…" } } ],
  "cascadeScope": "<par_dashboard_tab.sys_id>" }
```
A data widget follows the filters when its props have `"followFilters": true` and `"filterConfigurations": "@state.parFilters"`.

**Heading**: `{"variant":"header-tertiary","label":"Overview of open incidents","level":"1"}`.

> Practical tip: don't write `component_props` from scratch. Build one widget of each type in the UI (or copy an OOB one), pull it, and use its `component_props.json` as the template. The full prop set has about 70 keys (colors, empty states, number format, and so on).

---

## 3. Data layer: real fields and choice values

### `pa_cubes`: Indicator Source
`name`, `facts_table`, `conditions`, `frequency` (10 Daily, 20 Weekly, 40 Monthly…), `calendar`.
The "open records" pattern used by the OOB `Incidents.Open` source (`b5cf2c23…`) counts what was open **on the collection date**, so historical collection works:
```
opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^ORopened_at<javascript:gs.daysAgoStart(0)
^resolved_atISEMPTY^ORresolved_at>javascript:gs.daysAgoEnd(0)^state!=10
```
Don't use `active=true`. It is only correct for "today" and breaks backfills.

### `pa_indicators`
| Field | Values |
|---|---|
| `type` | **1 Automated**, **2 Formula**, 3 Manual, 4 External |
| `cube` | → pa_cubes (automated only) |
| `aggregate` | **1 Count**, 2 Sum, 3 Average, 4 Min, 5 Max, 6 Count distinct |
| `field` | Field to aggregate. OOB "Number of open incidents" uses `active` with Count. |
| `conditions` | Extra filter on top of the source's conditions |
| `formula` | Formula only (see below) |
| `unit` | → pa_units: `#` = `17b365e2d7320100ba986f14ce6103ad`, `%` = `f9c365e2d7320100ba986f14ce6103b8` |
| `frequency` | 10 Daily, 20 Weekly, 40 Monthly |
| `direction` | **1 None, 2 Minimize, 3 Maximize** |
| `precision` | Decimals: 0 for counts, 2 for % |
| `value_when_nil` | 0 for counts |
| `collect_records` | Store record snapshots (enables drill-down) |
| `collect_breakdown_matrix` | Collect breakdown × breakdown combinations |
| `formula_allow_null`, `formula_aggregate_whole` | Formula options |

### Formula syntax (from real records)
The formula references indicators **by sys_id**:
```
( [[efc5ef12d7230100ba986f14ce6103eb]] / [[ff18f822d7230100ba986f14ce61033d]] ) * 100     // % open and overdue incidents
( [[ind_a / 80e19051d7001100ba986f14ce610320]] / [[ind_b / 80e19051…]] ) * 100           // "/ <pa_aggregates.sys_id>" = time-series aggregate (By month SUM)
```
The UI shows indicator names, but the stored text uses sys_ids. Create the component indicators first, then write the formula with their sys_ids.

### `pa_dimensions`: Breakdown Source
`name`, `facts_table` (the table of **possible elements**), `field` (the element key, almost always `sys_id`), `conditions`, `empty_value`.

### `pa_breakdowns`
`name`, `dimension` → pa_dimensions, `type` (1 Automated, 2 Manual), `display`.

### `pa_breakdown_mappings` (essential, and easy to forget)
`breakdown`, `facts_table`, `field`. Tells PA **which field on the indicator source's table** holds the breakdown element. Without a mapping for the source's `facts_table`, the breakdown can't be collected for that indicator.
OOB examples: Priority → `incident.priority`, `sc_request.priority`. Assignment Group → `incident.assignment_group.sys_id`, `sc_request.assignment_group`.

### `pa_indicator_breakdowns`
`indicator`, `breakdown`, `order`, `display`. Links a breakdown to an indicator. This is what lets a widget group or filter that indicator by the breakdown. Formula indicators need their own links too.

### Priority breakdown → `sys_choice` (not the field directly)
The OOB pattern, Breakdown Source `Incident.Priority` (`4f44dd12bf230100b96dac808c0739ab`):
```
facts_table = sys_choice
field       = sys_id
conditions  = name=task^language=en^element=priority^value!=5^inactive=false^ORinactiveISEMPTY
```
- In levidev, priority choices exist **only on `task`**. There are no `incident`/`sc_request`/`sc_req_item` rows, so the filter must be `name=task`. `name=incident` would return zero elements.
- `language=en` keeps one row per value. Without it you get one element per language.
- The mapping still points at the plain field (`incident.priority`). PA matches the choice value to the `sys_choice` row by itself (`isOfChoiceType: true` in the widget props).

### Data collection
- Jobs: `sysauto_pa`, and `pa_job_indicators` (job ↔ indicator). The OOB "Number of open incidents" is in 4 jobs.
- New indicators must be added to a job. Then run a **historic collection** (backfill) once, and the daily job afterwards.
- Scores are stored in `pa_scores_l1`/`pa_scores_l2` and snapshots in `pa_snapshots`. Scores are **data**: they are not captured in Update Sets, so every instance must collect its own.

---

## 4. What already exists in levidev (reuse first)

| Need | Existing record |
|---|---|
| Open incidents source | `pa_cubes` **Incidents.Open** `b5cf2c23d7030100b96d45a3ce6103cc` (excludes HR groups) |
| Open requests source | `pa_cubes` **Requests.Open** `060219f9d7200200b96d45a3ce6103da` (sc_request); **Requested.Items.Open** `730c1960bf330100b96dac808c07396a` (sc_req_item) |
| Open incidents indicator | **Number of open incidents** `fb007202d7130100b96d45a3ce6103b4` (already linked to Priority, Assignment Group, State, Category, Age…) |
| Open requests indicator | **Number of open requests** `e0fa913dd7200200b96d45a3ce6103b8` (sc_request; linked to Priority `785a913d…`, Assignment Group, State, Age) |
| Priority breakdown (incident) | `0df47e02d7130100b96d45a3ce610399` → source Incident.Priority (sys_choice) |
| Priority breakdown (sc_request) | `785a913dd7200200b96d45a3ce610386` |
| Assignment group breakdown | **Assignment Group** `baec0752bf130100b96dac808c0739ed` → source IT.Groups.Active; mapped for incident, sc_request, sc_req_item, task_sla… |
| Configuration Item | **No mapping for `incident.cmdb_ci` exists.** The "Configuration Item" breakdown `45690504…` is mapped only to `cmdb_ci_outage`. To group by CI, add a `pa_breakdown_mappings` row (`incident` / `cmdb_ci`), or create a new breakdown with a `cmdb_ci` source. |
| % example | **% open and overdue incidents** `12bbb112bf201100b96dac808c073906` (formula) |

---

## 5. "% of open incidents by group / by priority" (formula indicator)

The natural formula is `open_by_group / total_open * 100`. The catch is that a formula evaluated on a breakdown element evaluates **every** referenced indicator on that element. So `[[Open]] / [[Open]]` gives 100% for every group.

The approach that works:
1. Numerator: **Number of open incidents**, linked to Assignment Group and Priority (already done OOB).
2. Denominator: a second automated indicator, e.g. **Number of open incidents (total)**, on the same source, with **no** breakdowns linked.
3. Formula: `[[<open_sys_id>]] / [[<total_sys_id>]] * 100`, unit `%`, precision 2. Link it (`pa_indicator_breakdowns`) to Assignment Group and to Priority.
4. When the formula is evaluated for a group, the denominator has no score for that element, so it falls back to its overall score.

> ⚠️ Validate step 4 in levidev after the first collection: the breakdown scores across all groups should add up to about 100%. If this release doesn't fall back to the total, the alternative is a Donut/Pie widget on "Number of open incidents" grouped by the breakdown, which shows % of total natively and needs no formula.

---

## 6. snsync workflow

`sn-config.json` → `mapping` now has entries for all of these tables (in `_tool/templates/sn-config.json` and the levi projects). Large JSON fields are written as files: `component_props.json` (widget), `layout.json` (canvas), `formula.txt`/`conditions.txt` (indicators, sources).

### Pull (learn)
```bash
# Dashboard + its whole tree (use the dashboard sys_id from src/par_dashboard/<Name>/.sys_id)
node snsync --pull --table par_dashboard        --query "name=Incident Management"          --project projects/levidev --context-action skip
node snsync --pull --table par_dashboard_tab    --query "dashboard=<dash_id>"               --project projects/levidev --context-action skip
node snsync --pull --table par_dashboard_canvas --query "dashboard=<dash_id>"               --project projects/levidev --context-action skip
node snsync --pull --table par_dashboard_widget --query "canvas.dashboard=<dash_id>"        --project projects/levidev --context-action skip

# PA layer
node snsync --pull --table pa_indicators           --query "nameLIKEopen incidents"         --project projects/levidev --context-action skip
node snsync --pull --table pa_indicator_breakdowns --query "indicator=<ind_id>"            --project projects/levidev --context-action skip
node snsync --pull --table pa_breakdown_mappings   --query "breakdown=<bk_id>"             --project projects/levidev --context-action skip
```
Notes:
- Tables without a `name` field (`pa_indicator_breakdowns`, `pa_breakdown_mappings`, unnamed widgets) land in folders called `Record`, `Record_<5 chars of sys_id>`. Read `_record.json` to tell them apart.
- A pull returns at most 100 records. Narrow the query.
- `par_dashboard` folders are named by dashboard title. Many are `Untitled*`.

### Build: push order (references need sys_ids that exist)
Create in this order. After each push, the new `.sys_id` is written to the folder; copy it into the children's `_record.json` before pushing them.
1. `pa_cubes` (only if no existing source fits)
2. `pa_dimensions` → `pa_breakdowns` → `pa_breakdown_mappings`
3. `pa_indicators` (automated) → `pa_indicator_breakdowns`
4. `pa_indicators` (formula; `formula.txt` uses the sys_ids from step 3) → its `pa_indicator_breakdowns`
5. Add the indicators to a collection job (`pa_job_indicators`) and run a historic collection **in the instance**
6. `par_dashboard` → `par_dashboard_tab` (one per tab) → `par_dashboard_canvas` (one per tab + one with empty tab) → `par_dashboard_widget`
7. Update each canvas's `layout.json` to mirror its widgets, then push it

`_record.json` for a new record holds plain values (or `{ "value": … }`). References are sys_ids:
```json
{ "breakdown": "baec0752bf130100b96dac808c0739ed", "facts_table": "incident", "field": "cmdb_ci" }
```
On create, snsync also sends `name` (taken from the folder) when `_record.json` has none. Tables without a `name` column ignore it.

```bash
node snsync --push src/pa_indicators/My_Indicator --project projects/levidev --update-set "PA Dashboard v1"
```
Check afterwards that the records landed in the Update Set (`sys_update_xml`). Scores and collection runs don't travel. Dashboards built in the UI are often easier: build in the UI, then pull to version them.

---

## 7. Reusable prompt (template)

```
Follow the Platform Analytics workflow in _tool/Docs/platform-analytics.md (env: levidev, Update Set: "<name>").
1. Pull: the OOB Incident Management dashboard tree as a template, plus the PA records listed in section 4.
2. Learn: reuse existing sources/indicators/breakdowns; list what is missing.
3. Develop: create a par_dashboard "<Name>" with tabs "Incidents" and "Requests"
   (par_dashboard_tab → par_dashboard_canvas, plus the empty-tab canvas → par_dashboard_widget).
   - Indicators (pa_indicators) for each needed filter; validate/create sources (pa_cubes) using the
     "open on collection date" condition pattern.
   - Breakdowns (pa_breakdowns) for assignment_group, cmdb_ci, priority, each with a source (pa_dimensions),
     a pa_breakdown_mappings row per facts table, and pa_indicator_breakdowns links.
     Priority source: sys_choice, field sys_id, conditions name=task^element=priority^language=en^inactive=false^ORinactiveISEMPTY.
   - Formula indicators: % of open incidents by group and by priority (section 5: separate un-broken-down total denominator).
4. Push in the order from section 6, then tell me which collection job to run.
Do not create the widgets yet: <yes/no>.
```

> To build a dashboard from these pieces, use the `sn-pa-dashboard` skill (`.claude/skills/sn-pa-dashboard/`): a JSON spec plus `scripts/pa-build.cjs`, which creates everything in dependency order through snsync.
