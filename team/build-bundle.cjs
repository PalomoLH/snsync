#!/usr/bin/env node
// Builds the encrypted team bundle from this machine's snsync setup.
// Run by the kit owner only. Never prints secret values.
//
//   node team/build-bundle.cjs [--out team-private/snsync-team-bundle.txt]
//                              [--pass-file team-private/PASSPHRASE.txt]
//                              [--exclude-memory a.md,b.md] [--no-memory]
//
// Bundles, per projects/<env> that has a .env:
//   - .env (Basic-auth projects get SNSYNC_SHARED_USER_SHA so the guard hook
//     treats them as the shared read-only integration user)
//   - sn-config.json with the owner's Update Set choices cleared
// plus the owner's Claude memories for this repo (minus exclusions).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { encrypt, claudeMemoryDir } = require("./bundle-lib.cjs");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

const OUT = path.resolve(ROOT, opt("--out", "team-private/snsync-team-bundle.txt"));
const PASS_FILE = path.resolve(ROOT, opt("--pass-file", "team-private/PASSPHRASE.txt"));
const NO_MEMORY = args.includes("--no-memory");
// Machine-specific notes that don't apply to other laptops.
const EXCLUDE = new Set(
  ["python-blocked-use-node.md", ...String(opt("--exclude-memory", "")).split(",")].filter(Boolean),
);
const OWNER = opt("--owner", "Luiz");

const files = [];

// --- Environments ---------------------------------------------------------
const projectsDir = path.join(ROOT, "projects");
for (const name of fs.readdirSync(projectsDir).sort()) {
  const dir = path.join(projectsDir, name);
  const envFile = path.join(dir, ".env");
  if (!fs.statSync(dir).isDirectory() || !fs.existsSync(envFile)) continue;

  let env = fs
    .readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => !/^\s*SNSYNC_SHARED_USER_SHA\s*=/.test(l) && !/snsync team kit/.test(l))
    .join("\n")
    .trimEnd();
  const user = (env.match(/^\s*SN_USER\s*=\s*(.*)$/m) || [])[1];
  if (user) {
    const sha = crypto.createHash("sha256").update(user.trim().replace(/^["']|["']$/g, "")).digest("hex");
    env += [
      "",
      "",
      "# --- snsync team kit ---",
      "# SN_USER above is the team's shared integration user: READ-ONLY (enforced by .claude/hooks/sn-guard.cjs).",
      "# Put your own SN_USER/SN_PASSWORD above to lift the lock (leviprod stays pull-only regardless).",
      `SNSYNC_SHARED_USER_SHA=${sha}`,
    ].join("\n");
  }
  files.push({ path: `projects/${name}/.env`, mode: 0o600, content: env + "\n" });

  const cfgFile = path.join(dir, "sn-config.json");
  if (fs.existsSync(cfgFile)) {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    if ("defaultUpdateSet" in cfg) cfg.defaultUpdateSet = "";
    delete cfg.updateSetSysId;
    for (const scope of Object.values(cfg.scopes || {})) {
      if ("updateSet" in scope) scope.updateSet = "";
      if ("updateSetSysId" in scope) scope.updateSetSysId = "";
    }
    files.push({ path: `projects/${name}/sn-config.json`, mode: 0o644, content: JSON.stringify(cfg, null, 2) + "\n" });
  }
  console.log(`📦 ${name}: .env (${user ? "basic, shared read-only" : "oauth"})${fs.existsSync(cfgFile) ? " + sn-config.json" : ""}`);
}

// --- Memories --------------------------------------------------------------
if (!NO_MEMORY) {
  const memDir = claudeMemoryDir(ROOT);
  const today = new Date().toISOString().slice(0, 10);
  const included = [];
  for (const f of fs.readdirSync(memDir).sort()) {
    if (!f.endsWith(".md") || f === "MEMORY.md" || EXCLUDE.has(f)) continue;
    const content = fs
      .readFileSync(path.join(memDir, f), "utf8")
      .split("\n")
      .filter((l) => !/^\s*originSessionId:/.test(l))
      .join("\n");
    files.push({ path: `memory/${f}`, mode: 0o644, content });
    included.push(f);
  }

  files.push({
    path: "memory/team-kit-origin.md",
    mode: 0o644,
    content: `---
name: team-kit-origin
description: Most memories here were imported from ${OWNER}'s Claude on ${today}; "the user" in them means ${OWNER}, and their open items are ${OWNER}'s
metadata:
  type: reference
---

These memories came from ${OWNER}'s snsync setup through the team kit (team/setup.sh) on ${today}.

- In those files, "the user" means ${OWNER}, not you. Preferences and approvals recorded there were given by ${OWNER} and do not carry over to this teammate.
- Open items ("pending", "promote before", "booked") belong to ${OWNER}. Treat them as background, and check the instance before acting on them.
- Paths under projects/<env>/notes/ exist on ${OWNER}'s machine only.
- Facts were true when written. Re-check sys_ids, Update Sets and record states on the instance before relying on them.
`,
  });

  const index = fs.readFileSync(path.join(memDir, "MEMORY.md"), "utf8").split("\n");
  const kept = index.filter((l) => {
    const m = l.match(/\]\(([^)]+\.md)\)/);
    return m && included.includes(m[1]);
  });
  const header = `- [Team kit origin](team-kit-origin.md) — memories imported from ${OWNER} on ${today}; "the user" in them = ${OWNER}, verify before acting`;
  files.push({ path: "memory/MEMORY.md", mode: 0o644, content: [header, ...kept].join("\n") + "\n" });
  console.log(`🧠 memories: ${included.length} (+ origin note), excluded: ${[...EXCLUDE].join(", ") || "none"}`);
}

// --- Encrypt ---------------------------------------------------------------
fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (!fs.existsSync(PASS_FILE)) {
  fs.mkdirSync(path.dirname(PASS_FILE), { recursive: true });
  fs.writeFileSync(PASS_FILE, crypto.randomBytes(18).toString("base64url") + "\n", { mode: 0o600 });
  console.log(`🔑 New passphrase written to ${path.relative(ROOT, PASS_FILE)}`);
}
const passphrase = fs.readFileSync(PASS_FILE, "utf8").trim();
fs.writeFileSync(
  OUT,
  encrypt({ version: 1, created: new Date().toISOString(), files }, passphrase),
  { mode: 0o600 },
);
console.log(`✅ Bundle: ${path.relative(ROOT, OUT)} (${files.length} files, encrypted)`);
console.log("   Send the bundle and the passphrase through two different private channels.");
