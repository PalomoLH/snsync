#!/usr/bin/env node
// Builds a Platform Analytics dashboard (and its PA records) from a declarative spec,
// using the snsync CLI for every write. Run from the repo root.
//
//   node .claude/skills/sn-pa-dashboard/scripts/pa-build.cjs plan  <spec.json> [--show <key>]  # validate + show order (+ one rendered record), no writes
//   node .claude/skills/sn-pa-dashboard/scripts/pa-build.cjs build <spec.json> [--update]  # create missing records in order; --update also pushes changed file fields of existing ones
//
// Spec format: see ../SKILL.md ("The build spec"). References between records use "@ref:<key>".

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SKILL_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = process.cwd();
const REF = /@ref:([A-Za-z0-9_]+)/g;

const COMPONENTS = {
  single_score: "d24d53f60350de7a652caf3188a46ed2",
  column: "2bd5dc19a7ad083941b7c992a966dd78",
  vertical_bar: "23051643b7e03010097cb81cde11a910",
  horizontal_bar: "85855283b7e03010097cb81cde11a91d",
  line: "18ac962264404bcc0039359d184b15f3",
  donut: "a2b0596cec6b9d49dd1ff9bf76b5084b",
  pie: "96abe7e38d8790718022c5630a92176c",
  heatmap: "d1f6c60ce95607ea1ef236430d5fdec9",
  pivot_table: "06f6aacbd1818110f877d87436272684",
  list: "7ff373544303121093711347efb8f23c",
  gauge: "037bd8ea3013833fd049186779528b70",
  filter: "226449101138d0dff1abe0e1566c8b2a",
  heading: "1f6e0643eca7a637e36bd7833549ec9e",
  rich_text: "2d56f06d55f46bbd4e79b5e624beb940",
};
const TEMPLATE_COMPONENT = {
  single_score_indicator: "single_score",
  column_breakdown_indicator: "column",
  donut_breakdown_indicator: "donut",
  bar_table: "vertical_bar",
  filter_breakdown: "filter",
  heading: "heading",
  hbar_breakdown_indicator: "horizontal_bar",
  hbar_multi_indicator: "horizontal_bar",
  column_multi_indicator: "column",
  line_multi_indicator: "line",
  list_table: "list",
  single_score_table: "single_score",
  hbar_multi_table: "horizontal_bar",
  rich_text: "rich_text",
};

function die(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

const [cmd, specArg] = process.argv.slice(2);
if (!["plan", "build"].includes(cmd) || !specArg) {
  die("Usage: pa-build.cjs plan|build <spec.json>");
}
const specPath = path.resolve(specArg);
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const project = spec.project || "projects/levidev";
const projectDir = path.resolve(REPO_ROOT, project);

// --- Guard 1: never write to production ---
const realProject = fs.existsSync(projectDir) ? fs.realpathSync(projectDir) : projectDir;
if (/(^|\/)leviprod(\/|$)/.test(realProject)) {
  die("Target project is leviprod (production). It is READ-ONLY. Build in projects/levidev and promote via Update Set.");
}
if (!fs.existsSync(path.join(projectDir, "sn-config.json"))) {
  die(`No sn-config.json in ${project}. Is the project path right? (run from the repo root)`);
}
const cfg = JSON.parse(fs.readFileSync(path.join(projectDir, "sn-config.json"), "utf8"));

// --- Guard 2: Update Set must be explicit and must match the scope config ---
// snsync resolves the Update Set from sn-config scopes.<scope>.updateSet BEFORE the --update-set flag,
// so a stale config value silently wins. Refuse to run unless they agree.
// In `plan` mode this is only a warning, so the plan can be reviewed before the Update Set exists.
const usProblem = cmd === "plan" ? (m) => console.warn(`\n⚠️  ${m}\n   (build will refuse until this is fixed)`) : die;
if (!spec.updateSet || spec.updateSet.startsWith("<")) {
  usProblem('Spec has no real "updateSet". Ask the user which Update Set to use.');
}
const g = cfg.scopes && cfg.scopes.global;
if (g && g.updateSet && ![g.updateSet, g.updateSetSysId].includes(spec.updateSet)) {
  usProblem(
    `sn-config.json scopes.global.updateSet is "${g.updateSet}", but the spec targets "${spec.updateSet}".\n` +
      `   snsync would use the config value. Fix it first, e.g.:\n` +
      `   node snsync --create-update-set "${spec.updateSet}" --scope global --project ${project}\n` +
      `   (or, for an existing Update Set, set scopes.global.updateSet/updateSetSysId in ${project}/sn-config.json)`,
  );
}

// --- Validate records ---
const records = spec.records || [];
const byKey = {};
for (const r of records) {
  if (!r.key || !r.table) die(`Every record needs "key" and "table": ${JSON.stringify(r).slice(0, 120)}`);
  if (byKey[r.key]) die(`Duplicate key "${r.key}"`);
  if (!r.existing && !cfg.mapping[r.table]) die(`Table ${r.table} is not mapped in ${project}/sn-config.json`);
  byKey[r.key] = r;
}

function refsIn(value, out = new Set()) {
  if (typeof value === "string") for (const m of value.matchAll(REF)) out.add(m[1]);
  else if (Array.isArray(value)) value.forEach((v) => refsIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => refsIn(v, out));
  return out;
}
for (const r of records) {
  r.deps = [...refsIn([r.fields, r.vars, r.props_patch, r.metrics])];
  for (const d of r.deps) if (!byKey[d]) die(`${r.key} references unknown key @ref:${d}`);
}

// Topological order (dependencies first, otherwise keep spec order)
const order = [];
const state = {};
function visit(r, trail = []) {
  if (state[r.key] === 2) return;
  if (state[r.key] === 1) die(`Reference cycle: ${[...trail, r.key].join(" → ")}`);
  state[r.key] = 1;
  r.deps.forEach((d) => visit(byKey[d], [...trail, r.key]));
  state[r.key] = 2;
  order.push(r);
}
records.forEach((r) => visit(r));

const folderOf = (r) =>
  r.folder || String((r.fields && r.fields.name) || r.key).replace(/[^a-z0-9_-]/gi, "_");
const dirOf = (r) => path.join(projectDir, "src", r.table, folderOf(r));
const sysIds = {};
for (const r of records) {
  if (r.existing) sysIds[r.key] = r.existing;
  else if (fs.existsSync(path.join(dirOf(r), ".sys_id")))
    sysIds[r.key] = fs.readFileSync(path.join(dirOf(r), ".sys_id"), "utf8").trim();
}

// --- Plan output ---
console.log(`\n📋 ${cmd.toUpperCase()}  project=${project}  updateSet="${spec.updateSet}"`);
for (const r of order) {
  const status = r.existing ? "existing" : sysIds[r.key] ? "already created" : "NEW";
  console.log(`  ${status.padEnd(15)} ${r.table.padEnd(24)} ${r.key}${r.existing ? "" : `  → src/${r.table}/${folderOf(r)}`}`);
}
if (cmd === "plan") {
  // Dry-render widgets so template/variable mistakes surface before anything is pushed
  const fake = (k) => (byKey[k].existing ? byKey[k].existing : `<sys_id of ${k}>`);
  for (const r of order) if (r.template) renderProps(r, fake);
  const showIdx = process.argv.indexOf("--show");
  if (showIdx > 0) {
    const r = byKey[process.argv[showIdx + 1]] || die(`--show: unknown key ${process.argv[showIdx + 1]}`);
    console.log(`\n🔎 ${r.key}:`, JSON.stringify(r.template ? renderProps(r, fake) : resolveRefs(r.fields, fake), null, 2));
  }
  console.log("\n✅ Plan OK. Nothing was written. Run with `build` to create the records.");
  process.exit(0);
}

// --- Helpers ---
function resolveRefs(value, lookup) {
  if (typeof value === "string") return value.replace(REF, (_, k) => lookup(k));
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, lookup));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, lookup)]));
  return value;
}
function b64(s) {
  return Buffer.from(s).toString("base64");
}

function renderProps(r, lookup) {
  const tplPath = path.join(SKILL_DIR, "templates", `${r.template}.json`);
  if (!fs.existsSync(tplPath)) die(`${r.key}: unknown template "${r.template}"`);
  const title = (r.fields && r.fields.name) || "";
  const vars = {
    __TITLE__: title,
    __LABEL__: title,
    __DS_ID__: b64(`ds_${r.key}_${spec.updateSet}`),
    __METRIC_ID__: b64(`metric_${r.key}_${spec.updateSet}`),
    __FILTER_ID__: `f${b64(r.key).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 18)}`,
    __AGGREGATE__: "", // "" = latest collected score; a pa_aggregates sys_id = time-series (e.g. By month SUM +)
    __FREQUENCY__: 10,
    __INDICATOR_TYPE__: "1",
    __IS_CHOICE__: false,
    __IS_BUCKET__: false,
    __MAX_GROUPS__: "ALL",
    __AXIS__: "primary",
    __PERIODS__: 12,
    __COLUMN_LIMIT__: 6,
    __ELEMENT_FIELD__: "sys_id",
    ...Object.fromEntries(Object.entries(r.vars || {}).map(([k, v]) => [`__${k}__`, v])),
  };
  const fillWith = (vs) => {
    const f = (v) => {
      if (typeof v === "string") {
        if (v in vs) return resolveRefs(vs[v], lookup); // whole-value placeholder: keeps type (object, bool, number)
        return v.replace(/__[A-Z_]+__/g, (m) => (m in vs ? String(resolveRefs(vs[m], lookup)) : m));
      }
      if (Array.isArray(v)) return v.map(f);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, f(x)]));
      return v;
    };
    return f;
  };
  const tpl = JSON.parse(fs.readFileSync(tplPath, "utf8"));

  // "metrics": [{ INDICATOR, LABEL, ... }] → one data source + metric per entry (multi-line / multi-bar),
  // cloned from the template's first data source and metric. Per-metric vars override widget vars.
  if (Array.isArray(r.metrics) && r.metrics.length) {
    const [protoDs, protoMetric] = [tpl.dataSources[0], tpl.metrics[0]];
    const per = r.metrics.map((m, i) => ({
      ...vars,
      __DS_ID__: b64(`ds_${r.key}_${i}_${spec.updateSet}`),
      __METRIC_ID__: b64(`metric_${r.key}_${i}_${spec.updateSet}`),
      ...Object.fromEntries(Object.entries(m).map(([k, v]) => [`__${k}__`, v])),
    }));
    tpl.dataSources = per.map((vs) => fillWith(vs)(protoDs));
    tpl.metrics = per.map((vs) => fillWith(vs)(protoMetric));
  }

  const props = { ...fillWith(vars)(tpl), ...resolveRefs(fillWith(vars)(r.props_patch || {}), lookup) };

  // trendBy lists one entry per metric id; a template copied from another widget still carries that
  // widget's metric ids, which makes the chart render empty. Always rebuild it from this widget's metrics.
  if (props.trendBy && typeof props.trendBy === "object" && Array.isArray(props.metrics)) {
    props.trendBy = { ...props.trendBy, trendByFields: props.metrics.map((m) => ({ field: "anything", metric: m.id })) };
  }

  // Colors (sys_report_color sys_ids): COLOR (+ optional COLOR_RULES) on the widget or on each metric
  // become a "singleColor" colorConfig keyed by metric id. Rules: [{ operator: ">", value1: 0, color }].
  const colored = (props.metrics || [])
    .map((m, i) => {
      const src = Array.isArray(r.metrics) && r.metrics.length ? r.metrics[i] || {} : r.vars || {};
      if (!src.COLOR) return null;
      const v = { metric: m.id, color: src.COLOR };
      if (Array.isArray(src.COLOR_RULES)) {
        v.rules = src.COLOR_RULES.map((x, j) => ({ order: String(100 + j), value2: "", ...x, value1: String(x.value1) }));
      }
      return v;
    })
    .filter(Boolean);
  if (colored.length && !(r.props_patch && r.props_patch.colorConfig)) {
    props.colorConfig = { type: "singleColor", values: colored };
  }
  const left = JSON.stringify(props).match(/__[A-Z_]+__/g);
  if (left) die(`${r.key}: template variables not filled: ${[...new Set(left)].join(", ")} (add them to "vars")`);
  return props;
}

function snsync(args) {
  const res = spawnSync("node", ["snsync", ...args, "--project", project], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const out = (res.stdout || "") + (res.stderr || "");
  process.stdout.write(out.split("\n").filter((l) => !/^(🔌|📂|🔐|⚙️)/u.test(l)).join("\n"));
  return out;
}

const lookup = (k) => {
  if (!sysIds[k]) die(`@ref:${k} has no sys_id yet (did its push fail?)`);
  return sysIds[k];
};

function writeRecordFolder(r) {
  const dir = dirOf(r);
  fs.mkdirSync(dir, { recursive: true });
  const map = cfg.mapping[r.table];
  const fileFields = new Set(map.fields || []);
  const fields = resolveRefs({ ...(r.fields || {}) }, lookup);

  if (r.table === "par_dashboard_widget") {
    if (!fields.component && r.template) fields.component = TEMPLATE_COMPONENT[r.template];
    if (COMPONENTS[fields.component]) fields.component = COMPONENTS[fields.component];
    if (r.template) fields.component_props = renderProps(r, lookup);
  }
  // New canvases start empty; an existing canvas keeps its layout (rebuilt from the widgets after the build)
  if (r.table === "par_dashboard_canvas" && fields.layout === undefined && !fs.existsSync(path.join(dir, ".sys_id"))) {
    fields.layout = [];
  }

  // { "@file": "relative/to/spec.js" } loads a field's content from a file (e.g. long scripts)
  for (const [k, v] of Object.entries(fields)) {
    if (v && typeof v === "object" && typeof v["@file"] === "string") {
      fields[k] = fs.readFileSync(path.resolve(path.dirname(specPath), v["@file"]), "utf8");
    }
  }

  const json = {};
  for (const [k, v] of Object.entries(fields)) {
    const val = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    // snsync only reads a field file when the mapping gives it an extension; otherwise use _record.json
    const ext = map.ext && map.ext[k];
    if (fileFields.has(k) && ext) {
      fs.writeFileSync(path.join(dir, `${k}.${ext}`), String(val));
    } else {
      json[k] = typeof val === "number" || typeof val === "boolean" ? String(val) : val;
    }
  }
  fs.writeFileSync(path.join(dir, "_record.json"), JSON.stringify(json, null, 4) + "\n");
}

// Reads a field of a local record: from its mapped file if there is one, else from _record.json
function readVal(dir, table, field) {
  const map = cfg.mapping[table] || {};
  const ext = map.ext && map.ext[field];
  const f = ext && path.join(dir, `${field}.${ext}`);
  if (f && fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  const jf = path.join(dir, "_record.json");
  const rec = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, "utf8")) : {};
  const v = rec[field];
  return v && typeof v === "object" && "value" in v ? v.value : v;
}

// --- Build ---
// --update: records that already exist are re-rendered from the spec, and every mapped FILE field
// whose content changed is pushed (snsync updates one file field at a time). Fields that only live in
// _record.json can't be updated this way and are reported.
const UPDATE = process.argv.includes("--update");
const failures = [];
for (const r of order) {
  if (sysIds[r.key] && UPDATE && !r.existing) {
    const dir = dirOf(r);
    const map = cfg.mapping[r.table];
    const files = (map.fields || []).filter((f) => map.ext && map.ext[f]).map((f) => `${f}.${map.ext[f]}`);
    const snap = (name) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), "utf8") : null);
    const before = Object.fromEntries([...files, "_record.json"].map((f) => [f, snap(f)]));
    const oldJson = before["_record.json"] ? JSON.parse(before["_record.json"]) : {};
    const oldVal = (f) => {
      const v = oldJson[f.replace(/\.[^.]+$/, "")];
      return v && typeof v === "object" && "value" in v ? v.value : v;
    };
    writeRecordFolder(r);
    // A file that didn't exist yet (field newly mapped as a file) only counts as changed if its
    // value differs from what _record.json held; pushing identical values can be refused (e.g. cube)
    const changed = files.filter((f) => {
      const now = snap(f);
      if (now === before[f]) return false;
      if (before[f] === null && String(oldVal(f) ?? "") === String(now ?? "")) return false;
      return true;
    });
    for (const f of changed) {
      console.log(`\n✏️  ${r.table} ${r.key}: ${f}`);
      const out = snsync(["--push", `src/${r.table}/${folderOf(r)}/${f}`, "--update-set", spec.updateSet]);
      if (/BLOCKED|Error|❌/u.test(out)) {
        failures.push(`${r.key} (${f})`);
        // put the previous content back so the next run sees the change again and retries the push
        if (before[f] !== null) fs.writeFileSync(path.join(dir, f), before[f]);
        else fs.rmSync(path.join(dir, f), { force: true });
      }
    }
    continue;
  }
  if (sysIds[r.key]) continue;
  console.log(`\n➕ ${r.table} ${r.key}`);
  writeRecordFolder(r);
  snsync(["--push", `src/${r.table}/${folderOf(r)}`, "--update-set", spec.updateSet]);
  const idFile = path.join(dirOf(r), ".sys_id");
  if (!fs.existsSync(idFile)) {
    die(`Create failed for ${r.key}. Fix the cause above and re-run build (finished records are skipped).`);
  }
  sysIds[r.key] = fs.readFileSync(idFile, "utf8").trim();
}

// --- Canvas layouts mirror their widgets ---
for (const c of order.filter((r) => r.table === "par_dashboard_canvas" && !r.existing)) {
  const widgets = order.filter(
    (w) => w.table === "par_dashboard_widget" && w.fields && w.fields.canvas === `@ref:${c.key}`,
  );
  if (!widgets.length) continue;
  const layout = widgets.map((w) => {
    const dir = dirOf(w);
    const val = (f) => readVal(dir, "par_dashboard_widget", f);
    return {
      sys_id: sysIds[w.key],
      x: Number(val("x") || 0),
      y: Number(val("y") || 0),
      w: Number(val("w") || 12),
      h: Number(val("h") || 7),
      name: val("name") || "",
      component_id: val("component"),
      component_props: val("component_props") || "{}",
    };
  });
  const layoutFile = path.join(dirOf(c), "layout.json");
  const next = JSON.stringify(layout);
  if (fs.existsSync(layoutFile) && fs.readFileSync(layoutFile, "utf8") === next) continue;
  fs.writeFileSync(layoutFile, next);
  console.log(`\n🧩 Canvas ${c.key}: layout with ${layout.length} widgets`);
  const out = snsync(["--push", `src/par_dashboard_canvas/${folderOf(c)}/layout.json`, "--update-set", spec.updateSet]);
  if (/BLOCKED|Error|❌/u.test(out)) failures.push(`${c.key} (layout)`);
}

// --- Report ---
const reportPath = specPath.replace(/\.json$/, "") + ".result.json";
fs.writeFileSync(reportPath, JSON.stringify({ project, updateSet: spec.updateSet, sysIds }, null, 2) + "\n");
console.log(`\n📝 sys_ids written to ${path.relative(REPO_ROOT, reportPath)}`);
if (failures.length) die(`Finished with problems: ${failures.join(", ")}`);
console.log("✅ Build complete.");
