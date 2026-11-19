#!/usr/bin/env node
// PreToolUse guard for Bash commands that reach a ServiceNow instance.
//
// - Blocks snsync writes (--push, --watch, --delete, --create-update-set,
//   --modify-flow other than list/get) on read-only environments:
//   leviprod always, and any project still using the shared integration user.
// - Asks for confirmation before any now-sdk write on the leviprod alias.
// - Shows a notice every time a command uses the shared integration user.
//
// "Shared integration user" = the project's .env has SNSYNC_SHARED_USER_SHA
// and it still matches sha256(SN_USER). Once a teammate puts their own
// SN_USER in that .env, the notice and the read-only lock stop (except for
// leviprod, which stays read-only for snsync no matter what).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ALWAYS_READONLY = new Set(["leviprod"]);

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch (_) {
    return {};
  }
}

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function envInfo(root, name) {
  const env = parseEnv(path.join(root, "projects", name, ".env"));
  const sharedSha = env.SNSYNC_SHARED_USER_SHA;
  const shared =
    !!sharedSha &&
    !!env.SN_USER &&
    crypto.createHash("sha256").update(env.SN_USER).digest("hex") === sharedSha;
  return { name, shared, readonly: ALWAYS_READONLY.has(name) || shared };
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

const input = readStdin();
if (input.tool_name !== "Bash") process.exit(0);

const cmd = String(input.tool_input?.command || "");
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

// Every projects/<env> named in the command, plus the cwd if it sits inside one.
const names = new Set();
for (const m of cmd.matchAll(/projects\/([A-Za-z0-9_.-]+)/g)) names.add(m[1]);
const cwdMatch = String(input.cwd || "").match(/\/projects\/([A-Za-z0-9_.-]+)/);
if (cwdMatch) names.add(cwdMatch[1]);

const envs = [...names]
  .filter((n) => fs.existsSync(path.join(root, "projects", n)))
  .map((n) => envInfo(root, n));

const isSnsync = /\bsnsync\b|sn-sync\.js/.test(cmd);
const isNowSdk = /\bnow-sdk\b/.test(cmd);
const touchesInstance = isSnsync || /\b(node|curl)\b/.test(cmd);

const snWrite =
  isSnsync &&
  (/--(push|watch|delete|create-update-set)\b/.test(cmd) ||
    (/--modify-flow\b/.test(cmd) && !/--operation[\s=]+(list|get)\b/.test(cmd)));

// 1. snsync writes on read-only environments: hard block.
const blocked = envs.filter((e) => e.readonly);
if (snWrite && blocked.length) {
  const why = blocked
    .map((e) =>
      e.shared
        ? `${e.name} uses the shared integration user, which is read-only`
        : `${e.name} is production and is pull-only through snsync`,
    )
    .join("; ");
  emit({
    systemMessage: `🛑 Blocked a write: ${why}.`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `snsync write blocked by .claude/hooks/sn-guard.cjs: ${why}. Make the change in levidev (or a project using your own login) instead.`,
    },
  });
}

// 2. now-sdk on the leviprod alias: anything other than query/auth needs a human yes.
const sdkProd = isNowSdk && /(?:-a|--auth)[\s=]+["']?leviprod\b/.test(cmd);
const sdkReadOnly = /\bnow-sdk\s+(query|auth)\b/.test(cmd);
if (sdkProd && !sdkReadOnly) {
  emit({
    systemMessage:
      "⚠️ now-sdk write on leviprod. Allowed only for rm_story, rm_scrum_task, change_request, change_task.",
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        "now-sdk write on leviprod: only rm_story / rm_scrum_task / change_request / change_task are allowed, and only after the user confirms the exact records and values.",
    },
  });
}

// 3. Shared integration user in use: tell the user every time.
const shared = envs.filter((e) => e.shared);
if (touchesInstance && shared.length) {
  const list = shared.map((e) => e.name).join(", ");
  emit({
    systemMessage: `🔐 ${list}: using the SHARED integration user (read-only). Put your own SN_USER/SN_PASSWORD in projects/<env>/.env to stop this notice.`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `This command runs on ${list} with the team's shared integration user (read-only). Tell the user in chat that you are using the shared read-only integration user for ${list}.`,
    },
  });
}

process.exit(0);
