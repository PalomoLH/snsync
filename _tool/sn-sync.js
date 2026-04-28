const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const chokidar = require("chokidar");
const express = require("express");
const open = require("open");
const crypto = require("crypto");
const readline = require("readline");
const FlowModifier = require("./flow-modifier");

// --- ENVIRONMENT PREPARATION (Allows running from root by specifying the project) ---
// Checks if --project "path/to/folder" was passed
const args = process.argv.slice(2);
const projectIdx = args.indexOf("--project");
const updateSetIdx = args.indexOf("--update-set");
const cliUpdateSetSysId =
  updateSetIdx !== -1 && args[updateSetIdx + 1] && !args[updateSetIdx + 1].startsWith("--")
    ? args[updateSetIdx + 1].trim()
    : null;
if (projectIdx !== -1 && args[projectIdx + 1]) {
  const targetProject = args[projectIdx + 1];
  if (fs.existsSync(targetProject)) {
    process.chdir(targetProject); // Changes execution directory to the project folder
  }
}

// --- CONTEXT LOGIC ---
// Where was the command run? (e.g., /Users/user/workspace/sn/projects/client_A)
let CURRENT_DIR = process.cwd();

// AUTO-FIX: If the script runs inside /src or subfolders
// Tries to go up the directory tree until it finds .env or sn-config.json
const MAX_LEVELS = 5;
for (let i = 0; i < MAX_LEVELS; i++) {
  if (fs.existsSync(path.join(CURRENT_DIR, ".env"))) {
    break; // Found the root!
  }
  const parent = path.dirname(CURRENT_DIR);
  if (parent === CURRENT_DIR) break; // Reached system root
  CURRENT_DIR = parent;
}
// Adjusts the process to run in the correct root
if (process.cwd() !== CURRENT_DIR) {
  process.chdir(CURRENT_DIR);
}

// Looks for .env in the folder WHERE YOU ARE, not where the script is
const envPath = path.join(CURRENT_DIR, ".env");

if (!fs.existsSync(envPath)) {
  console.error(`❌ ERROR: .env file not found in: ${CURRENT_DIR}`);
  console.error(`   Make sure you are inside the client project folder.`);
  process.exit(1);
}

// Loads local .env variables
require("dotenv").config({ path: envPath });

// --- EXTRA ENVIRONMENT VARIABLES (ZSH) ---
const SN_ENC_SECRET = process.env.SN_ENC_SECRET; // Secret to encrypt the token at rest

// --- ENCRYPTION HELPERS ---
function encryptData(data) {
  const text = JSON.stringify(data);
  if (!SN_ENC_SECRET) return text; // If no password, save as pure JSON

  const key = crypto.createHash("sha256").update(SN_ENC_SECRET).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  // Format: iv:content
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decryptData(text) {
  if (!SN_ENC_SECRET) return JSON.parse(text);

  // If file is pure JSON but we have password, try to read as JSON (migration)
  if (text.trim().startsWith("{")) return JSON.parse(text);

  const parts = text.split(":");
  if (parts.length !== 2)
    throw new Error("Invalid cache format or encrypted with different key.");

  const iv = Buffer.from(parts[0], "hex");
  const encryptedText = Buffer.from(parts[1], "hex");
  const key = crypto.createHash("sha256").update(SN_ENC_SECRET).digest();

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return JSON.parse(decrypted.toString());
}

function saveTokenCache(data) {
  const content = encryptData(data);
  fs.writeFileSync(CONFIG.tokenCache, content, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function loadTokenCache() {
  const content = fs.readFileSync(CONFIG.tokenCache, "utf8");
  return decryptData(content);
}

// Visual confirmation of where we are connecting
console.log(`🔌 Connecting to: ${process.env.SN_INSTANCE}`);
console.log(`📂 Project Folder: ${CURRENT_DIR}`);

// --- AUTH CONFIGURATION (Hybrid: Basic or OAuth Browser) ---
// If CLIENT_ID exists but NO PASSWORD in .env, assume Browser Auth
const USE_BROWSER_AUTH = process.env.SN_CLIENT_ID && !process.env.SN_PASSWORD;
const AUTH_MODE = USE_BROWSER_AUTH
  ? "OAUTH_BROWSER"
  : process.env.SN_USER
    ? "BASIC"
    : "UNKNOWN";

console.log(`🔐 Authentication Mode: ${AUTH_MODE}`);

let snUpdateSetSysId = null;

const CONFIG = {
  url: process.env.SN_INSTANCE,
  basicAuth: {
    username: process.env.SN_USER,
    password: process.env.SN_PASSWORD,
  },
  oauth: {
    clientId: process.env.SN_CLIENT_ID,
    clientSecret: process.env.SN_CLIENT_SECRET,
    tokenUrl: `${process.env.SN_INSTANCE}/oauth_token.do`,
    authUrl: `${process.env.SN_INSTANCE}/oauth_auth.do`,
    redirectUri: "http://localhost:3000/callback",
  },
  localFolder: path.join(CURRENT_DIR, "src"),
  tokenCache: path.join(CURRENT_DIR, ".token_cache.json"),
  mapping: loadMappingConfig(),
};

// CLI --update-set overrides whatever sn-config.json defined
if (cliUpdateSetSysId) snUpdateSetSysId = cliUpdateSetSysId;

// --- FUNCTION: BROWSER LOGIN (Local Server) ---
async function startBrowserLogin() {
  return new Promise((resolve, reject) => {
    const app = express();
    let server;

    console.log("🌍 Starting local authentication server...");

    app.get("/callback", async (req, res) => {
      const code = req.query.code;
      if (code) {
        res.send(
          "<h1>Login successful!</h1><p>You can close this window and return to the terminal.</p>",
        );
        try {
          console.log(
            "🔑 Authorization code received! Exchanging for token...",
          );
          const params = new URLSearchParams();
          params.append("grant_type", "authorization_code");
          params.append("client_id", CONFIG.oauth.clientId);
          params.append("client_secret", CONFIG.oauth.clientSecret);
          params.append("code", code);
          params.append("redirect_uri", CONFIG.oauth.redirectUri);

          const tokenRes = await axios.post(CONFIG.oauth.tokenUrl, params);
          const tokenData = tokenRes.data;

          // Save to cache with timestamp
          tokenData.expires_at = Date.now() + tokenData.expires_in * 1000;
          tokenData.last_used_at = Date.now(); // Starts inactivity counter

          try {
            saveTokenCache(tokenData);
            console.log("💾 Tokens saved (🔐 ENCRYPTED) to .token_cache.json");
          } catch (saveErr) {
            console.error("❌ Error saving cache:", saveErr.message);
          }

          resolve(tokenData.access_token);
        } catch (e) {
          console.error(
            "❌ Token exchange error:",
            e.response?.data || e.message,
          );
          reject(e);
        } finally {
          server.close();
        }
      } else {
        res.status(400).send("Error: Code not received.");
        reject(new Error("No code received"));
        server.close();
      }
    });

    server = app.listen(3000, async () => {
      const authUrl = `${CONFIG.oauth.authUrl}?response_type=code&client_id=${CONFIG.oauth.clientId}&redirect_uri=${CONFIG.oauth.redirectUri}&state=2&scope=openid profile email`;
      console.log(`🚀 Opening browser for login: ${authUrl}`);
      await open(authUrl);
    });
  });
}

// --- SMART HTTP CLIENT ---
const snClient = axios.create({ baseURL: CONFIG.url });

async function getValidToken() {
  // 1. Try to load from cache
  if (fs.existsSync(CONFIG.tokenCache)) {
    try {
      const tokenData = loadTokenCache();

      // --- SECURITY CHECK: INACTIVITY TIMEOUT ---
      const IDLE_TIMEOUT = 20 * 60 * 1000; // 20 minutes
      if (
        tokenData.last_used_at &&
        Date.now() - tokenData.last_used_at > IDLE_TIMEOUT
      ) {
        console.warn("\n🔒 Session expired due to inactivity (+20min).");
        console.warn("   For security, please login again.");
        fs.removeSync(CONFIG.tokenCache);
        // Force fall through to login flow below
        throw new Error("Session timed out due to inactivity");
      }

      // Updates "last used" timestamp (sliding window effect)
      // Only saves if more than 10s passed since last update to save disk I/O
      if (
        !tokenData.last_used_at ||
        Date.now() - tokenData.last_used_at > 10000
      ) {
        tokenData.last_used_at = Date.now();
        saveTokenCache(tokenData);
      }

      // 60s security buffer
      if (Date.now() < tokenData.expires_at - 60000) {
        return tokenData.access_token;
      }
      console.log("⚠️ Token expired or expiring soon. Attempting refresh...");
      if (tokenData.refresh_token) {
        const params = new URLSearchParams();
        params.append("grant_type", "refresh_token");
        params.append("client_id", CONFIG.oauth.clientId);
        params.append("client_secret", CONFIG.oauth.clientSecret);
        params.append("refresh_token", tokenData.refresh_token);

        const refreshRes = await axios.post(CONFIG.oauth.tokenUrl, params);
        const newTokenData = refreshRes.data;
        newTokenData.expires_at = Date.now() + newTokenData.expires_in * 1000;
        newTokenData.last_used_at = Date.now(); // Reset timer on refresh too

        // Preserve old refresh token if new one is not returned
        if (!newTokenData.refresh_token)
          newTokenData.refresh_token = tokenData.refresh_token;

        saveTokenCache(newTokenData);
        console.log("✅ Token refreshed (and re-encrypted) successfully!");
        return newTokenData.access_token;
      }
    } catch (e) {
      // Only log if not the inactivity error we just generated
      if (e.message !== "Session timed out due to inactivity") {
        console.warn("⚠️ Error reading/refreshing cache:", e.message);
      }
      // If failed (e.g., wrong password), will fall through to browser login below
    }
  }

  // 2. If everything failed, start browser login
  if (AUTH_MODE === "OAUTH_BROWSER") {
    return await startBrowserLogin();
  } else {
    throw new Error(
      "Traditional OAUTH mode failed or not configured correctly.",
    );
  }
}

snClient.interceptors.request.use(async (reqConfig) => {
  if (AUTH_MODE === "OAUTH_BROWSER") {
    const token = await getValidToken();
    reqConfig.headers["Authorization"] = `Bearer ${token}`;
  } else if (AUTH_MODE === "BASIC") {
    reqConfig.auth = CONFIG.basicAuth;
  }
  if (snUpdateSetSysId) {
    reqConfig.headers["X-UpdateSet"] = snUpdateSetSysId;
  }
  return reqConfig;
});

// No complex retry interceptor needed, the preventive logic above solves it
function loadMappingConfig() {
  const configPath = path.join(CURRENT_DIR, "sn-config.json");
  if (fs.existsSync(configPath)) {
    console.log("⚙️  Loading sn-config.json from project...");
    const loaded = fs.readJsonSync(configPath);
    if (loaded.updateSetSysId) snUpdateSetSysId = loaded.updateSetSysId;
    return loaded.mapping || loaded;
  }

  // Empty default fallback (Force use of sn-config.json)
  console.warn("⚠️  WARNING: No sn-config.json found in this folder!");
  console.warn(
    "   Create a sn-config.json file to define which tables to sync.",
  );
  return {};
}

// --- FUNCTIONS ---

async function pullCatalogItem(sysId, contextAction = "skip") {
  console.log("📦 Pulling complete catalog item...");
  console.log(`   Catalog Item ID: ${sysId}`);
  console.log("");

  const tables = [
    { name: "sc_cat_item", query: `sys_id=${sysId}`, label: "📋 Catalog Item" },
    {
      name: "item_option_new",
      query: `cat_item=${sysId}`,
      label: "📝 Form Variables",
    },
    {
      name: "catalog_script_client",
      query: `cat_item=${sysId}`,
      label: "⚡ Client Scripts",
    },
  ];

  let catalogItemName = null;

  for (const table of tables) {
    console.log(`${table.label} (${table.name})...`);

    const config = CONFIG.mapping[table.name];
    if (!config) {
      console.warn(
        `   ⚠️  Table ${table.name} not configured in sn-config.json`,
      );
      continue;
    }

    await pullFromServiceNow({
      table: table.name,
      query: table.query,
      contextAction: contextAction,
      skipContextPrompt: true,
    });

    // Get catalog item name for folder reorganization
    if (table.name === "sc_cat_item" && !catalogItemName) {
      const itemPath = path.join(CONFIG.localFolder, "sc_cat_item");
      if (fs.existsSync(itemPath)) {
        const items = fs.readdirSync(itemPath).filter((f) => {
          return (
            fs.statSync(path.join(itemPath, f)).isDirectory() &&
            !f.startsWith(".")
          );
        });
        if (items.length > 0) {
          catalogItemName = items[0];
        }
      }
    }
  }

  if (!catalogItemName) {
    console.error("❌ Could not find catalog item name for reorganization");
    return;
  }

  // Pull linked flow/workflow
  let flowJson = null;
  let flowIsWorkflow = false;
  const recordJsonPath = path.join(CONFIG.localFolder, "sc_cat_item", catalogItemName, "_record.json");
  if (fs.existsSync(recordJsonPath)) {
    const record = fs.readJsonSync(recordJsonPath);
    const flowId = record?.flow_designer_flow?.value;
    if (flowId) {
      console.log("🔄 Flow Designer (sys_hub_flow)...");
      try {
        // Reuse the already-authenticated snClient (no separate token needed)
        const xmlRes = await snClient.get("/api/now/table/sys_update_xml", {
          params: {
            sysparm_query: `name=sys_hub_flow_${flowId}`,
            sysparm_fields: "sys_id,name,payload,sys_updated_on,sys_updated_by",
          },
        });

        const xmlResults = xmlRes.data?.result;
        if (!xmlResults || xmlResults.length === 0) {
          console.warn(`   ⚠️  Flow XML not found in sys_update_xml for flow: ${flowId}`);
        } else {
          const flowData = xmlResults[0];

          // Use FlowModifier only for XML parsing (no separate axios/token needed)
          const flowModifier = new FlowModifier(process.env.SN_INSTANCE, "unused");

          // Parse actions directly from the already-fetched XML
          const xml = flowData.payload;
          const actionPattern = /<sys_hub_action_instance_v2[^>]*>[\s\S]*?<sys_id>(.*?)<\/sys_id>[\s\S]*?<ui_id>(.*?)<\/ui_id>[\s\S]*?<order>(.*?)<\/order>[\s\S]*?<\/sys_hub_action_instance_v2>/g;
          const actions = [];
          let m;
          while ((m = actionPattern.exec(xml)) !== null) {
            actions.push({ sys_id: m[1], ui_id: m[2], order: parseInt(m[3]) });
          }
          actions.sort((a, b) => a.order - b.order);
          const decodedActions = {};
          for (const action of actions) {
            try {
              const { encodedValues } = flowModifier.findActionInXML(flowData.payload, action.sys_id);
              const config = await flowModifier.decodeActionValues(encodedValues);
              decodedActions[action.sys_id] = { order: action.order, ui_id: action.ui_id, config };
            } catch (_) { /* skip undecodable actions */ }
          }

          flowJson = {
            _meta: {
              sys_id: flowData.sys_id,
              flow_id: flowId,
              name: flowData.name,
              last_updated: flowData.sys_updated_on,
              updated_by: flowData.sys_updated_by,
            },
            actions: decodedActions,
          };
          console.log(`   ✅ Flow retrieved: ${flowData.name}`);
        }
      } catch (err) {
        console.warn(`   ⚠️  Could not pull flow: ${err.message}`);
      }
    } else {
      console.log("ℹ️  No Flow Designer flow linked to this catalog item.");
    }

    // Pull legacy Workflow Engine (wf_workflow) if no Flow Designer flow
    const workflowId = record?.workflow?.value;
    if (!flowJson && workflowId) {
      console.log("🔄 Legacy Workflow (wf_workflow)...");
      try {
        // Fetch the workflow record for metadata
        const wfRes = await snClient.get(`/api/now/table/wf_workflow/${workflowId}`, {
          params: {
            sysparm_fields: "sys_id,name,description,sys_updated_on,sys_updated_by,active",
          },
        });
        const wfRecord = wfRes.data?.result;

        // Fetch activities for this workflow
        const actRes = await snClient.get("/api/now/table/wf_activity", {
          params: {
            sysparm_query: `workflow_version.workflow=${workflowId}^workflow_version.published=true`,
            sysparm_fields: "sys_id,name,description,order,script,activity_definition",
            sysparm_orderby: "order",
          },
        });
        const activities = actRes.data?.result || [];

        // Fetch XML payload from sys_update_xml
        const xmlRes = await snClient.get("/api/now/table/sys_update_xml", {
          params: {
            sysparm_query: `name=wf_workflow_${workflowId}`,
            sysparm_fields: "sys_id,name,payload,sys_updated_on,sys_updated_by",
          },
        });
        const xmlData = xmlRes.data?.result?.[0] || null;

        flowJson = {
          _meta: {
            type: "wf_workflow",
            sys_id: wfRecord?.sys_id || workflowId,
            name: wfRecord?.name || "",
            description: wfRecord?.description || "",
            active: wfRecord?.active || "",
            last_updated: wfRecord?.sys_updated_on || "",
            updated_by: wfRecord?.sys_updated_by || "",
            ...(xmlData ? { xml_sys_id: xmlData.sys_id, xml_name: xmlData.name } : {}),
          },
          activities: activities.map((a) => ({
            sys_id: a.sys_id,
            name: a.name,
            order: a.order,
            description: a.description,
            activity_definition: a.activity_definition,
            script: a.script || "",
          })),
        };
        flowIsWorkflow = true;
        console.log(`   ✅ Workflow retrieved: ${wfRecord?.name || workflowId} (${activities.length} activities)`);
      } catch (err) {
        console.warn(`   ⚠️  Could not pull workflow: ${err.message}`);
      }
    } else if (!flowJson && !workflowId) {
      console.log("ℹ️  No workflow engine linked to this catalog item.");
    }
  }

  // Reorganize files
  console.log("");
  console.log("📦 Reorganizing files by catalog item...");

  try {
    const srcPath = CONFIG.localFolder;
    const masterFolder = path.join(srcPath, catalogItemName);

    // Create master folder structure
    fs.ensureDirSync(path.join(masterFolder, "catalog_item"));
    fs.ensureDirSync(path.join(masterFolder, "variables"));
    fs.ensureDirSync(path.join(masterFolder, "client_scripts"));
    if (flowJson) fs.ensureDirSync(path.join(masterFolder, "flow"));


    // Move catalog item files
    const oldCatalogPath = path.join(srcPath, "sc_cat_item", catalogItemName);
    if (fs.existsSync(oldCatalogPath)) {
      const files = fs.readdirSync(oldCatalogPath);
      files.forEach((file) => {
        const src = path.join(oldCatalogPath, file);
        const dest = path.join(masterFolder, "catalog_item", file);
        fs.moveSync(src, dest, { overwrite: true });
      });
      fs.removeSync(oldCatalogPath);
    }

    // Move variables
    const variablesPath = path.join(srcPath, "item_option_new");
    if (fs.existsSync(variablesPath)) {
      const variables = fs.readdirSync(variablesPath).filter((f) => {
        return (
          fs.statSync(path.join(variablesPath, f)).isDirectory() &&
          !f.startsWith(".")
        );
      });

      variables.forEach((varName) => {
        const src = path.join(variablesPath, varName);
        const dest = path.join(masterFolder, "variables", varName);
        fs.moveSync(src, dest, { overwrite: true });
      });

      if (
        fs.readdirSync(variablesPath).filter((f) => !f.startsWith("."))
          .length === 0
      ) {
        fs.removeSync(variablesPath);
      }
    }

    // Move client scripts
    const scriptsPath = path.join(srcPath, "catalog_script_client");
    if (fs.existsSync(scriptsPath)) {
      const scripts = fs.readdirSync(scriptsPath).filter((f) => {
        return (
          fs.statSync(path.join(scriptsPath, f)).isDirectory() &&
          !f.startsWith(".")
        );
      });

      scripts.forEach((scriptName) => {
        const src = path.join(scriptsPath, scriptName);
        const dest = path.join(masterFolder, "client_scripts", scriptName);
        fs.moveSync(src, dest, { overwrite: true });
      });

      if (
        fs.readdirSync(scriptsPath).filter((f) => !f.startsWith(".")).length ===
        0
      ) {
        fs.removeSync(scriptsPath);
      }
    }

    // Clean up empty sc_cat_item folder
    const catalogItemPath = path.join(srcPath, "sc_cat_item");
    if (
      fs.existsSync(catalogItemPath) &&
      fs.readdirSync(catalogItemPath).filter((f) => !f.startsWith("."))
        .length === 0
    ) {
      fs.removeSync(catalogItemPath);
    }

    // Write flow.json or workflow.json
    if (flowJson) {
      const filename = flowIsWorkflow ? "workflow.json" : "flow.json";
      fs.writeJsonSync(path.join(masterFolder, "flow", filename), flowJson, { spaces: 2 });
    }

    console.log(`   ✅ Organized into: ${catalogItemName}/`);
    console.log("");
    console.log("📁 Structure:");
    console.log(`   src/${catalogItemName}/`);
    console.log(`   ├── catalog_item/       (item settings & description)`);
    console.log(`   ├── variables/          (form fields)`);
    if (flowJson) {
      console.log(`   ├── client_scripts/     (form behavior)`);
      console.log(`   └── flow/               (${flowIsWorkflow ? "legacy workflow" : "flow designer flow"})`);
    } else {
      console.log(`   └── client_scripts/     (form behavior)`);
    }
    console.log("");
    console.log("💡 Edit files, then push: node snsync --push");
  } catch (error) {
    console.warn("   ⚠️  Could not reorganize files:", error.message);
  }
}

async function pullFromServiceNow(options = {}) {
  console.log("⬇️  Starting Smart Download...");

  const contextOptions = {
    mode: options.contextAction || "prompt",
    selection: options.contextList || "",
  };

  let targets = Object.entries(CONFIG.mapping);

  // Filter by specific table (--table)
  if (options.table) {
    if (CONFIG.mapping[options.table]) {
      targets = [[options.table, CONFIG.mapping[options.table]]];
      console.log(`🎯 Focusing only on table: ${options.table}`);
    } else {
      console.error(
        `❌ Error: Table '${options.table}' not found in sn-config.json.`,
      );
      return;
    }
  }

  for (const [table, config] of targets) {
    // Query Overlay (--query) - Only applies if it's a specific table or user knows what they are doing
    // If --query is passed without --table, applies to ALL (can be dangerous, but flexible)
    const activeFilter = options.query ? options.query : config.filter;

    console.log(`   Searching in [${table}] with filter: "${activeFilter}"...`);

    // 0. NEW LOGIC: Save Context (Schema) ONLY ONCE
    if (config.saveContext || config.onlyContext) {
      const missingRefs = await captureTableSchema(
        table,
        activeFilter,
        contextOptions,
      );

      // Context Interactive Suggestion (Auto-Import)
      if (missingRefs && missingRefs.length > 0) {
        await processMissingRefs(missingRefs, contextOptions);
      }
    }

    // If ONLY Context, skip file download
    if (config.onlyContext) {
      console.log(
        `      ⏭️  onlyContext mode active for ${table}. Skipping file download.`,
      );
      continue;
    }

    // 1. FILE Download (Now light and fast)
    // We always limit fields to save bandwidth, since context is saved separately
    // Added sys_updated_on for conflict check

    // --- FEATURE: JSON Metadata & AI Context Support ---
    // Support 'jsonExport' (from user config) or 'jsonFields'
    const jsonExportFields = config.jsonExport || config.jsonFields || [];
    const hasJsonFields = jsonExportFields.length > 0;
    const displayValueMode = hasJsonFields ? "all" : "false";

    let fetchFields = [
      "sys_id",
      "sys_updated_on",
      "name",
      "u_name",
      "short_description",
      ...(config.fields || []),
    ];
    if (hasJsonFields) fetchFields.push(...jsonExportFields);
    if (config.contextKeys) fetchFields.push(...config.contextKeys); // Future proofing

    fetchFields = [...new Set(fetchFields)]; // Unique

    const fieldsParam = `&sysparm_fields=${fetchFields.join(",")}&sysparm_display_value=${displayValueMode}`;
    const queryParam = activeFilter
      ? `&sysparm_query=${encodeURIComponent(activeFilter)}`
      : "";

    try {
      const url = `/api/now/table/${table}?sysparm_limit=100${queryParam}${fieldsParam}`;
      const response = await snClient.get(url);
      const records = response.data.result;

      if (!records || records.length === 0) {
        console.log(`   ⚠️ No records found for ${table}.`);
        continue;
      }

      // --- AI Context tags prompt disabled (always skip) ---
      let contextTags = [];

      // Helper to get raw value regardless of display_value mode
      const getVal = (r, f) => {
        const val = r[f];
        if (val && typeof val === "object" && "value" in val) return val.value;
        return val;
      };

      for (const rec of records) {
        const sysId = getVal(rec, "sys_id");
        const nameKey =
          getVal(rec, "name") ||
          getVal(rec, "u_name") ||
          getVal(rec, "short_description") ||
          "Record";
        let safeName = nameKey.replace(/[^a-z0-9_-]/gi, "_");

        // --- NEW FOLDER LOGIC PER RECORD ---
        // Check name conflict
        let recordDir = path.join(CONFIG.localFolder, table, safeName);
        const sysIdFile = path.join(recordDir, ".sys_id");

        // If folder exists but is from ANOTHER sys_id, we need to rename current one to avoid conflict
        if (fs.existsSync(recordDir) && fs.existsSync(sysIdFile)) {
          const existingSysId = fs.readFileSync(sysIdFile, "utf8").trim();
          if (existingSysId !== sysId) {
            // Name conflict! Add sys_id chunk to folder name
            safeName = `${safeName}_${sysId.substring(0, 5)}`;
            recordDir = path.join(CONFIG.localFolder, table, safeName);
          }
        }

        // Create record folder
        fs.ensureDirSync(recordDir);

        // Save hidden .sys_id so Push knows who this record is
        fs.outputFileSync(path.join(recordDir, ".sys_id"), sysId);

        // Save hidden .sys_updated_on for Overwrite Protection
        const updatedOn = getVal(rec, "sys_updated_on");
        if (updatedOn) {
          fs.outputFileSync(path.join(recordDir, ".sys_updated_on"), updatedOn);
        }

        // Save field files (e.g., script.js, template.html)
        if (config.fields) {
          config.fields.forEach((field) => {
            const val = getVal(rec, field);
            if (val) {
              const extension = config.ext ? config.ext[field] : "txt";
              const fileName = `${field}.${extension}`; // Clean name: script.js
              const filePath = path.join(recordDir, fileName);
              fs.outputFileSync(filePath, val);
            }
          });
        }

        // --- FEATURE: Extra JSON Metadata ---
        if (hasJsonFields) {
          const jsonContent = {};
          jsonExportFields.forEach((f) => {
            // If mode is 'all', rec[f] is usually { value, display_value }
            // We want to save exactly that structure as per user request
            jsonContent[f] = rec[f];
          });
          // Also include name/type if available
          if (rec["name"]) jsonContent["name"] = rec["name"];
          if (rec["sys_name"]) jsonContent["sys_name"] = rec["sys_name"];

          // User requested "_properties.json", but we should be generic.
          // If it's sys_properties, use _properties.json, else _record.json
          const jsonName =
            table === "sys_properties" ? "_properties.json" : "_record.json";
          fs.writeJsonSync(path.join(recordDir, jsonName), jsonContent, {
            spaces: 4,
          });
        }

        // --- FEATURE: AI Context File ---
        if (contextTags.length > 0) {
          const contextFile = path.join(recordDir, "_ai_context.md");
          let currentContent = "";
          if (fs.existsSync(contextFile)) {
            currentContent = fs.readFileSync(contextFile, "utf8");
          } else {
            currentContent = `# AI Context: ${nameKey}\n\n> **Auto-generated context**\n\n`;
          }

          // Append new tags if not present
          const lines = currentContent.split("\n");
          let tagsToAdd = [...contextTags];

          // Simple check if tag exists in file
          tagsToAdd = tagsToAdd.filter((tag) => !currentContent.includes(tag));

          if (tagsToAdd.length > 0) {
            const newTagsBlock = tagsToAdd
              .map((t) => `- **Context**: ${t}`)
              .join("\n");
            currentContent += `\n${newTagsBlock}\n`;
            fs.writeFileSync(contextFile, currentContent);
            console.log(`      🧠 Added context tags to ${safeName}`);
          }
        }
      }
      console.log(
        `   ✅ ${table}: ${records.length} records downloaded/updated.`,
      );
    } catch (error) {
      console.error(`   ❌ Error in ${table}:`, error.message);
      if (error.response) console.error(error.response.data);
    }
  }
}

// --- HELPER: USER INTERACTION ---
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    }),
  );
}

async function processMissingRefs(missingRefs, contextOptions = {}) {
  if (!missingRefs || missingRefs.length === 0) return;

  console.log(
    `\n      🤔 Found ${missingRefs.length} referenced tables without context:`,
  );
  missingRefs.forEach((ref) => console.log(`         - ${ref}`));

  const mode = (contextOptions.mode || "prompt").toLowerCase();
  const selectionRaw = contextOptions.selection || "";
  let toAdd = [];

  if (mode === "skip" || mode === "no" || mode === "n") {
    return;
  } else if (
    mode === "auto" ||
    mode === "all" ||
    mode === "yes" ||
    mode === "y"
  ) {
    toAdd = missingRefs;
  } else if (mode === "select") {
    const selected = selectionRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    toAdd = selected.filter((s) => missingRefs.includes(s));
    if (toAdd.length === 0) {
      console.warn("      ⚠️ No valid tables provided via --context-list.");
      return;
    }
  } else if (mode === "prompt") {
    if (!process.stdout.isTTY) return;

    const ans = await askQuestion(
      "      ❓ Add their context to sn-config.json? (y/n/select): ",
    );
    const normalized = ans.trim().toLowerCase();

    if (normalized === "y" || normalized === "s") {
      toAdd = missingRefs;
    } else if (normalized === "select") {
      const selected = await askQuestion(
        "      ✍️  Enter tables separated by comma (e.g., sys_user, cmn_location): ",
      );
      toAdd = selected
        .split(",")
        .map((s) => s.trim())
        .filter((s) => missingRefs.includes(s));
    } else {
      return;
    }
  } else {
    console.warn(
      `      ⚠️ Unknown context mode '${mode}'. Skipping context update.`,
    );
    return;
  }

  if (toAdd.length === 0) return;

  console.log(`      ⚙️  Adding [${toAdd.join(", ")}] to sn-config.json...`);

  // Load, Edit and Save JSON
  const configPath = path.join(CURRENT_DIR, "sn-config.json");
  const currentConfig = fs.readJsonSync(configPath);

  // Ensure structure
  if (!currentConfig.mapping) currentConfig.mapping = {};

  for (const newTable of toAdd) {
    if (!currentConfig.mapping[newTable]) {
      currentConfig.mapping[newTable] = {
        onlyContext: true,
        filter: "sys_idISNOTEMPTY", // Safe default filter
      };
      // Update local memory for this run too
      CONFIG.mapping[newTable] = currentConfig.mapping[newTable];
    }
  }

  fs.writeJsonSync(configPath, currentConfig, { spaces: 4 });
  console.log(`      ✅ Configuration updated! Downloading contexts now...`);

  // Download context immediately for new tables
  for (const newTable of toAdd) {
    await captureTableSchema(newTable, "sys_idISNOTEMPTY", contextOptions);
  }
}

// --- INTEGRATION: ADVANCED SCHEMA CAPTURE ---
async function captureTableSchema(table, activeFilter, contextOptions = {}) {
  let missingRefs = [];
  try {
    console.log(
      `      🧠 Generating Smart Context (Schema + Choices + Refs) for ${table}...`,
    );

    const schemaData = {
      _meta: { timestamp: new Date(), source: "sn-sync v2" },
      columns: [],
      number_prefix: "",
      sample_data: {},
    };

    // 1. Dictionary (Fields, Types, Labels)
    // Get display=true to know which is the default Display Value of the table
    const dictUrl = `/api/now/table/sys_dictionary?sysparm_query=name=${table}^active=true&sysparm_fields=element,column_label,internal_type,reference,choice,display&sysparm_limit=500`;
    const dictRes = await snClient.get(dictUrl);
    const dictEntries = dictRes.data.result || [];

    // 2. Choices (Option lists) - Only for choice fields
    const choiceFields = dictEntries
      .filter((d) => d.choice === "1")
      .map((d) => d.element);
    let choicesMap = {};
    if (choiceFields.length > 0) {
      const choiceUrl = `/api/now/table/sys_choice?sysparm_query=name=${table}^elementIN${choiceFields.join(",")}^inactive=false&sysparm_fields=element,label,value,sequence`;
      try {
        const choiceRes = await snClient.get(choiceUrl);
        (choiceRes.data.result || []).forEach((c) => {
          if (!choicesMap[c.element]) choicesMap[c.element] = [];
          choicesMap[c.element].push({ label: c.label, value: c.value });
        });
      } catch (e) {
        console.warn(
          "      ⚠️ Failed to fetch choices (might be missing ACL):",
          e.message,
        );
      }
    }

    // 3. Number Prefix (sys_number)
    try {
      const numRes = await snClient.get(
        `/api/now/table/sys_number?sysparm_query=category=${table}&sysparm_fields=prefix&sysparm_limit=1`,
      );
      if (numRes.data.result && numRes.data.result.length > 0) {
        schemaData.number_prefix = numRes.data.result[0].prefix;
      }
    } catch (ignored) {}

    // 4. Schema Assembly

    schemaData.columns = dictEntries.map((d) => {
      const col = {
        name: d.element,
        label: d.column_label,
        type: d.internal_type?.value || d.internal_type,
        reference: d.reference?.value || d.reference,
        is_display: d.display === "true",
      };

      // Add choices if any
      if (choicesMap[col.name]) {
        col.choices = choicesMap[col.name];
      }

      // Missing Reference Check (Auto-Discovery Suggestion)
      if (col.reference && col.reference !== table) {
        // Ignore self-ref
        // If referenced table is NOT in our config, suggest
        if (!CONFIG.mapping[col.reference]) {
          if (!missingRefs.includes(col.reference))
            missingRefs.push(col.reference);
        }
      }

      return col;
    });

    // 5. Sample Data (1 real record - Sanitized/Fictional for Privacy)
    const queryParam = activeFilter
      ? `&sysparm_query=${encodeURIComponent(activeFilter)}`
      : "";
    // sysparm_display_value=all gives us value + display value, good for context
    const sampleUrl = `/api/now/table/${table}?sysparm_limit=1&sysparm_display_value=all${queryParam}`;
    const sampleRes = await snClient.get(sampleUrl);
    if (sampleRes.data.result && sampleRes.data.result.length > 0) {
      const raw = sampleRes.data.result[0];
      const sanitized = {};

      for (const [k, v] of Object.entries(raw)) {
        // Simple case: null
        if (v === null) {
          sanitized[k] = null;
          continue;
        }

        // Checks if it's the standard object from display_value=all
        const isComplex =
          typeof v === "object" && ("value" in v || "display_value" in v);

        // Determine dummy values based on field name to keep typing without leaking data
        let dummyVal = "SAMPLE_VALUE";
        let dummyDisp = "Sample Display Value";

        if (k === "sys_id") {
          dummyVal = "00000000000000000000000000000000";
          dummyDisp = "00000000000000000000000000000000";
        } else if (
          k.includes("date") ||
          k.includes("_on") ||
          k.includes("_at")
        ) {
          dummyVal = "2025-01-01 12:00:00";
          dummyDisp = "2025-01-01 12:00:00";
        } else if (k.includes("count") || k === "order" || k === "sequence") {
          dummyVal = "1";
          dummyDisp = "1";
        } else if (typeof v === "boolean" || v === "true" || v === "false") {
          dummyVal = "true";
          dummyDisp = "true";
        }

        if (isComplex) {
          sanitized[k] = {
            display_value: dummyDisp,
            value: v.link ? "REF_SYS_ID_HASH" : dummyVal,
          };
          if (v.link) {
            // Keeps base URL but kills real ID
            sanitized[k].link = v.link.replace(
              /[a-f0-9]{32}/gi,
              "REF_SYS_ID_HASH",
            );
          }
        } else {
          sanitized[k] = dummyVal;
        }
      }
      schemaData.sample_data = sanitized;
    }

    // Save JSON
    const schemaPath = path.join(
      CONFIG.localFolder,
      table,
      ".ai_context",
      `_schema.${table}.json`,
    );
    fs.outputFileSync(schemaPath, JSON.stringify(schemaData, null, 2));
    console.log(
      `      📘 Context Saved. Prefix: [${schemaData.number_prefix}] Columns: ${schemaData.columns.length}`,
    );

    // Return missing references for caller to decide what to do
    return missingRefs;
  } catch (e) {
    console.warn(`      ⚠️  Error generating advanced context: ${e.message}`);
    return [];
  }
}

async function createRecordInServiceNow(
  folderPath,
  table,
  skipPathValidation = false,
) {
  const recordName = path.basename(folderPath);
  const tableDir = path.join(CONFIG.localFolder, table);
  const expectedParent = path.resolve(tableDir);
  const actualParent = path.resolve(path.dirname(folderPath));
  if (!skipPathValidation && actualParent !== expectedParent) {
    console.error(
      `   ❌ Invalid path: folder must be inside ${table}/ (got ${folderPath})`,
    );
    return;
  }
  console.log(
    `✨ Creating NEW record in [${table}] from folder: ${recordName}...`,
  );

  const payload = {};
  const config = CONFIG.mapping[table];

  if (config && config.fields) {
    config.fields.forEach((field) => {
      const ext = config.ext[field];
      const fname = `${field}.${ext}`;
      const fpath = path.join(folderPath, fname);
      if (fs.existsSync(fpath)) {
        payload[field] = fs.readFileSync(fpath, "utf8");
      }
    });
  }

  const jsonFiles = ["_properties.json", "_record.json", "meta.json"];
  for (const jf of jsonFiles) {
    const jsonPath = path.join(folderPath, jf);
    if (fs.existsSync(jsonPath)) {
      try {
        const data = fs.readJsonSync(jsonPath);
        for (const [k, v] of Object.entries(data)) {
          if (payload[k] != null) continue;
          if (v && typeof v === "object" && "value" in v) {
            payload[k] = v.value;
          } else {
            payload[k] = v;
          }
        }
      } catch (e) {
        console.warn(`   ⚠️ Invalid JSON metadata: ${e.message}`);
      }
    }
  }

  // Only set name from folder if not already set by JSON
  if (!payload.name) {
    payload.name = recordName;
  }

  if (Object.keys(payload).length === 0) {
    console.error(
      "   ❌ No data found to create record. (Check json files or field files)",
    );
    return;
  }

  // 2. POST (Create)
  try {
    const res = await snClient.post(`/api/now/table/${table}`, payload);
    const result = res.data.result;

    if (result && result.sys_id) {
      console.log(`   ✅ Record created! SysID: ${result.sys_id}`);

      fs.outputFileSync(path.join(folderPath, ".sys_id"), result.sys_id);
      if (result.sys_updated_on) {
        fs.outputFileSync(
          path.join(folderPath, ".sys_updated_on"),
          result.sys_updated_on,
        );
      }

      const jsonName =
        table === "sys_properties" ? "_properties.json" : "_record.json";
      const jsonPath = path.join(folderPath, jsonName);

      let finalJson = {};
      if (fs.existsSync(jsonPath)) finalJson = fs.readJsonSync(jsonPath);

      finalJson.sys_id = { value: result.sys_id, display_value: result.sys_id };
      const displayName = result.name || result.api_name || recordName;
      if (displayName)
        finalJson.name = { value: displayName, display_value: displayName };

      fs.writeJsonSync(jsonPath, finalJson, { spaces: 4 });

      if (config && config.saveContext) {
        const contextPath = path.join(folderPath, "_ai_context.md");
        if (!fs.existsSync(contextPath)) {
          const contextContent = `# AI Context: ${displayName}\n\n> **Auto-generated context**\n\n`;
          fs.writeFileSync(contextPath, contextContent);
        }
      }

      // Handle choices for Multiple Choice variables (item_option_new)
      if (table === "item_option_new") {
        const choicesPath = path.join(folderPath, "choices.json");
        if (fs.existsSync(choicesPath)) {
          try {
            const choices = fs.readJsonSync(choicesPath);
            console.log(`   📝 Creating ${choices.length} question choices...`);
            for (const choice of choices) {
              const choicePayload = {
                question: result.sys_id,
                text: choice.text,
                value: choice.value,
                order: choice.order || "100",
              };
              await snClient.post(
                "/api/now/table/question_choice",
                choicePayload,
              );
            }
            console.log(`   ✅ All choices created successfully!`);
          } catch (e) {
            console.warn(`   ⚠️ Failed to create choices: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    console.error(
      `   🔥 Creation Failed:`,
      e.response?.data?.error?.message || e.message,
    );
    if (e.response && e.response.data)
      console.error(JSON.stringify(e.response.data, null, 2));
  }
}

function resolveFieldByConfig(table, fileName) {
  const tableConfig = CONFIG.mapping[table];
  if (!tableConfig || !tableConfig.ext) return null;
  for (const [fieldName, extension] of Object.entries(tableConfig.ext)) {
    if (!extension) continue;
    const expectedName = `${fieldName}.${extension}`;
    if (expectedName === fileName) {
      return { field: fieldName, extension };
    }
  }
  return null;
}

// --- Push flow.json back to ServiceNow ---
async function pushFlowJson(flowJsonPath) {
  console.log("\n🔄 Pushing flow.json to ServiceNow...");
  const flowJson = fs.readJsonSync(flowJsonPath);
  const meta = flowJson._meta;
  const actions = flowJson.actions || {};

  if (!meta || !meta.sys_id || !meta.flow_id) {
    console.error("❌ flow.json is missing _meta.sys_id or _meta.flow_id");
    return;
  }

  // Get the current XML from ServiceNow
  console.log(`   📥 Fetching current XML for flow: ${meta.flow_id}...`);
  const xmlRes = await snClient.get(`/api/now/table/sys_update_xml/${meta.sys_id}`);
  const flowData = xmlRes.data?.result;
  if (!flowData || !flowData.payload) {
    console.error("❌ Could not retrieve flow XML from ServiceNow.");
    return;
  }

  const flowModifier = new FlowModifier(CONFIG.url, "unused");
  let xml = flowData.payload;
  let modified = 0;

  for (const [actionSysId, actionData] of Object.entries(actions)) {
    try {
      const newEncoded = await flowModifier.encodeActionValues(actionData.config);
      xml = flowModifier.replaceActionInXML(xml, actionSysId, newEncoded);
      modified++;
    } catch (e) {
      console.warn(`   ⚠️  Could not encode action ${actionSysId}: ${e.message}`);
    }
  }

  console.log(`   📝 Re-encoded ${modified}/${Object.keys(actions).length} actions.`);
  console.log(`   ⬆️  Pushing to ServiceNow...`);
  const flowPayload = { payload: xml };
  if (snUpdateSetSysId) {
    flowPayload.update_set = snUpdateSetSysId;
    console.log(`   📋 Targeting Update Set: ${snUpdateSetSysId}`);
  }
  await snClient.put(`/api/now/table/sys_update_xml/${meta.sys_id}`, flowPayload);
  console.log("✅ Flow pushed successfully!");
}

async function pushToServiceNow(filePath, tableOverride = null) {
  const fileName = path.basename(filePath);

  // Ignore context files, hidden files and AI metadata
  if (fileName.startsWith(".") || fileName.includes(".ai_context")) return;

  const dirPath = path.dirname(filePath);
  const parentDir = path.dirname(dirPath); // src/table or src

  // Try to find .sys_id in the same folder as the file
  const sysIdPath = path.join(dirPath, ".sys_id");

  let sysId, table, field, extension;

  // --- NEW MODE (FOLDERS) ---
  if (fs.existsSync(sysIdPath)) {
    sysId = fs.readFileSync(sysIdPath, "utf8").trim();
    // Use tableOverride when the folder name doesn't match the SN table name
    // (e.g. catalog client scripts live under 'client_scripts/' but the SN table is 'catalog_script_client')
    table = tableOverride || path.basename(parentDir); // Assume: src/table/Record/file.js

    const resolved = resolveFieldByConfig(table, fileName);
    if (resolved) {
      ({ field, extension } = resolved);
    } else {
      // Filename is "field.ext" (e.g., script.js, template.html)
      const parts = fileName.split(".");
      extension = parts.pop();
      field = parts.join(".");
    }
  }
  // --- LEGACY MODE (COMPATIBILITY FOR OLD FILES REMAINING IN ROOT) ---
  else {
    // Old parse: Name.SysID.Field.ext
    const parts = fileName.split(".");
    if (parts.length >= 4) {
      extension = parts.pop();
      field = parts.pop();
      sysId = parts.pop();
      table = path.basename(dirPath);
    } else {
      return; // File not recognized
    }
  }

  // Security validation: skip mapping check when table is explicitly overridden
  if (!tableOverride && !CONFIG.mapping[table]) return;

  console.log(`🔄 Uploading: ${table} | Field: ${field}...`);

  // --- OVERWRITE PROTECTION (COLLISION CHECK) ---
  const updatedOnPath = path.join(dirPath, ".sys_updated_on");
  if (fs.existsSync(updatedOnPath)) {
    const localUpdatedOn = fs.readFileSync(updatedOnPath, "utf8").trim();

    try {
      // Check version on server before uploading
      // sysparm_display_value=false ENSURES we compare raw string from DB
      const checkRes = await snClient.get(
        `/api/now/table/${table}/${sysId}?sysparm_fields=sys_updated_on,sys_updated_by&sysparm_display_value=false`,
      );
      const serverUpdatedOn = checkRes.data.result.sys_updated_on;
      const updatedBy = checkRes.data.result.sys_updated_by;

      if (serverUpdatedOn && localUpdatedOn !== serverUpdatedOn) {
        console.error(`\n🛑 BLOCKED: Version Conflict Detected!`);
        console.error(`   Local:    ${localUpdatedOn}`);
        console.error(`   Server:   ${serverUpdatedOn} (by ${updatedBy})`);
        console.error(
          `   Solution: Save your changes elsewhere, run 'snsync --pull' and re-apply.`,
        );
        return; // Abort upload
      }
    } catch (e) {
      console.warn(
        `   ⚠️ Could not check conflicts on server. Proceeding at your own risk...`,
      );
    }
  }

  const content = fs.readFileSync(filePath, "utf8");
  const payload = {};
  payload[field] = content;

  try {
    const putRes = await snClient.put(
      `/api/now/table/${table}/${sysId}`,
      payload,
    );

    // Update local timestamp to new one, allowing future pushes without conflict
    if (putRes.data.result && putRes.data.result.sys_updated_on) {
      fs.outputFileSync(updatedOnPath, putRes.data.result.sys_updated_on);
    }

    const recordUrl = generateRecordUrl(table, sysId);
    console.log(`   ✨ Success! Saved to ServiceNow.`);
    console.log(`      🔗 ${recordUrl}`);
  } catch (error) {
    console.error(
      `   🔥 Error:`,
      error.response?.data?.error?.message || error.message,
    );
  }
}

function generateRecordUrl(table, sysId) {
  const target = `${table}.do?sys_id=${sysId}`;
  const encodedTarget = encodeURIComponent(target);
  // Polaris/Next Experience URL format
  return `${CONFIG.url}/now/nav/ui/classic/params/target/${encodedTarget}`;
}

async function deleteFromServiceNow(target, table, sysId, force = false) {
  if (!target && (!table || !sysId)) {
    console.error("❌ You must specify what to delete.");
    console.error("   Usage: --delete src/table/folder");
    console.error("   Usage: --delete --table X --sys_id Y");
    return;
  }

  let targetTable = table;
  let targetSysId = sysId;
  let targetPath = null;

  if (target && target !== "true") {
    const resolved = path.resolve(target);
    if (fs.existsSync(resolved)) {
      // If user passed a FILE in a folder, get the folder
      let searchPath = resolved;
      if (fs.lstatSync(resolved).isFile()) searchPath = path.dirname(resolved);

      targetPath = searchPath;

      // Try to find .sys_id
      const sysIdPath = path.join(searchPath, ".sys_id");
      if (fs.existsSync(sysIdPath)) {
        targetSysId = fs.readFileSync(sysIdPath, "utf8").trim();
        const tableDir = path.dirname(searchPath);
        targetTable = path.basename(tableDir);
      }
    }
  }

  if (!targetTable || !targetSysId) {
    console.error(
      "❌ Could not identify Table and SysID (missing .sys_id file?).",
    );
    return;
  }

  const performDeleteAction = async () => {
    console.log(`🗑️  Deleting from ServiceNow...`);
    try {
      await snClient.delete(`/api/now/table/${targetTable}/${targetSysId}`);
      console.log(`   ✅ Record deleted successfully from ServiceNow.`);

      if (targetPath && fs.existsSync(targetPath)) {
        const trashPath = targetPath + "_DELETED";
        try {
          fs.renameSync(targetPath, trashPath);
          console.log(
            `   🗑️  Local folder moved to: ${path.basename(trashPath)}`,
          );
        } catch (err) {
          console.warn(`   ⚠️ Could not rename local folder: ${err.message}`);
        }
      }
    } catch (e) {
      console.error(
        `   🔥 Delete Failed:`,
        e.response?.data?.error?.message || e.message,
      );
    }
  };

  if (force) {
    await performDeleteAction();
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\n⚠️  WARNING: You are about to DELETE the remote record:`);
  console.log(`   Table: ${targetTable}`);
  console.log(`   SysID: ${targetSysId}`);
  if (targetPath) console.log(`   Local: ${targetPath}`);

  rl.question(
    '\n🔴 Are you sure? Type "delete" to confirm: ',
    async (answer) => {
      if (answer !== "delete") {
        console.log("❌ Cancelled.");
        rl.close();
        return;
      }
      await performDeleteAction();
      rl.close();
    },
  );
}

async function handleOpen(target) {
  if (!target || target === "true") {
    console.log("❌ You must specify the file or folder to open.");
    return;
  }

  let filePath = target;
  // If folder, try to find .sys_id inside
  if (fs.lstatSync(target).isDirectory()) {
    filePath = path.join(target, ".sys_id"); // dummy path for logic below
  }

  const dirPath = fs.lstatSync(target).isDirectory()
    ? target
    : path.dirname(filePath);
  const parentDir = path.dirname(dirPath);
  const sysIdPath = path.join(dirPath, ".sys_id");

  if (fs.existsSync(sysIdPath)) {
    const sysId = fs.readFileSync(sysIdPath, "utf8").trim();
    const table = path.basename(parentDir);
    const url = generateRecordUrl(table, sysId);
    console.log(`🚀 Opening: ${url}`);
    await open(url);
  } else {
    console.log("❌ Could not identify .sys_id for this item.");
    console.log("   Ensure .sys_id file exists in the folder.");
  }
}

async function pushAllNewFromAllTables() {
  console.log("🚀 Pushing all new records from all tables...");
  const tables = Object.entries(CONFIG.mapping).filter(
    ([, c]) => c.fields && !c.onlyContext,
  );
  for (const [tableName, config] of tables) {
    const tableDir = path.join(CONFIG.localFolder, tableName);
    if (!fs.existsSync(tableDir) || !fs.lstatSync(tableDir).isDirectory())
      continue;
    const children = fs.readdirSync(tableDir);
    for (const child of children) {
      const childPath = path.join(tableDir, child);
      if (!fs.lstatSync(childPath).isDirectory()) continue;
      if (child.startsWith(".") || child === ".ai_context") continue;
      const sysIdPath = path.join(childPath, ".sys_id");
      if (!fs.existsSync(sysIdPath)) {
        await createRecordInServiceNow(childPath, tableName);
      }
    }
  }
}

async function handleManualPush(target, table, name) {
  console.log("🚀 Starting Manual Push...");

  // Normalize target
  let targetPath = target && target !== "true" ? target : null;

  if (!targetPath && table && name) {
    targetPath = path.join(CONFIG.localFolder, table, name);
  }
  if (!targetPath && table && !name) {
    targetPath = path.join(CONFIG.localFolder, table);
  }
  if (!targetPath && args.includes("--all")) {
    await pushAllNewFromAllTables();
    return;
  }

  if (!targetPath) {
    console.error(
      "❌ Insufficient parameters. Usage: --push src/table/folder | --push --table X --name Y | --push --table X (all new) | --push --all",
    );
    return;
  }

  if (!fs.existsSync(targetPath)) {
    console.error(`❌ Path not found: ${targetPath}`);
    return;
  }

  const stats = fs.lstatSync(targetPath);

  // Case 1: Single File
  if (stats.isFile()) {
    console.log(`   📄 Single file detected: ${path.basename(targetPath)}`);

    // Special case: flow.json (Flow Designer)
    if (path.basename(targetPath) === "flow.json") {
      await pushFlowJson(targetPath);
      return;
    }
    // If file is inside a "New Record" folder (no .sys_id), this calls pushToServiceNow which fails/skips?
    // We probably assume user knows what they are doing.
    // But if they push a single file in a new record, maybe they want to create the record?
    // Let's check context.
    const dirPath = path.dirname(targetPath);
    const sysIdPath = path.join(dirPath, ".sys_id");
    if (!fs.existsSync(sysIdPath)) {
      // It is a file in a NEW record folder.
      // Delegate to Creating the whole record because partial POST is bad.
      const parentName = path.basename(path.dirname(dirPath));
      if (CONFIG.mapping[parentName]) {
        console.log(
          `   🆕 New Record detected from single file. Creating full record...`,
        );
        await createRecordInServiceNow(dirPath, parentName);
        return;
      }
    }
    await pushToServiceNow(targetPath);
    return;
  }

  // Case 2: Directory
  if (stats.isDirectory()) {
    const dirName = path.basename(targetPath);
    const parentName = path.basename(path.dirname(targetPath));

    // Scenario CATALOG: Detect Catalog Item folder structure
    const catalogItemFolder = path.join(targetPath, "catalog_item");
    const variablesFolder = path.join(targetPath, "variables");
    const clientScriptsFolder = path.join(targetPath, "client_scripts");

    if (
      fs.existsSync(catalogItemFolder) ||
      fs.existsSync(variablesFolder) ||
      fs.existsSync(clientScriptsFolder)
    ) {
      console.log(`   📦 Catalog Item structure detected: ${dirName}`);

      // Push catalog_item (sc_cat_item)
      if (fs.existsSync(catalogItemFolder)) {
        console.log(`   📝 Pushing catalog item...`);
        const sysIdPath = path.join(catalogItemFolder, ".sys_id");
        if (fs.existsSync(sysIdPath)) {
          const files = fs.readdirSync(catalogItemFolder);
          for (const file of files) {
            if (file.startsWith(".")) continue;
            const fp = path.join(catalogItemFolder, file);
            if (fs.lstatSync(fp).isFile()) await pushToServiceNow(fp);
          }
        }
      }

      // Push variables (item_option_new)
      if (fs.existsSync(variablesFolder)) {
        console.log(`   📋 Pushing variables...`);
        const varDirs = fs.readdirSync(variablesFolder);
        for (const varDir of varDirs) {
          const varPath = path.join(variablesFolder, varDir);
          if (!fs.lstatSync(varPath).isDirectory()) continue;

          const sysIdPath = path.join(varPath, ".sys_id");
          if (fs.existsSync(sysIdPath)) {
            // Update existing variable
            console.log(`      ↻ Updating variable: ${varDir}`);
            const files = fs.readdirSync(varPath);
            for (const file of files) {
              if (file.startsWith(".")) continue;
              const fp = path.join(varPath, file);
              if (fs.lstatSync(fp).isFile()) await pushToServiceNow(fp);
            }

            // Sync choices if choices.json exists
            const choicesPath = path.join(varPath, "choices.json");
            if (fs.existsSync(choicesPath)) {
              try {
                const varSysId = fs.readFileSync(sysIdPath, "utf8").trim();
                const choices = fs.readJsonSync(choicesPath);

                // Delete existing choices
                const existingRes = await snClient.get(
                  `/api/now/table/question_choice?sysparm_query=question=${varSysId}`,
                );
                const existing = existingRes.data.result || [];
                for (const ex of existing) {
                  await snClient.delete(
                    `/api/now/table/question_choice/${ex.sys_id}`,
                  );
                }

                // Create new choices
                console.log(`         📝 Syncing ${choices.length} choices...`);
                for (const choice of choices) {
                  const choicePayload = {
                    question: varSysId,
                    text: choice.text,
                    value: choice.value,
                    order: choice.order || "100",
                  };
                  await snClient.post(
                    "/api/now/table/question_choice",
                    choicePayload,
                  );
                }
              } catch (e) {
                console.warn(
                  `         ⚠️ Failed to sync choices: ${e.message}`,
                );
              }
            }
          } else {
            // Create new variable
            console.log(`      ✨ Creating new variable: ${varDir}`);
            await createRecordInServiceNow(varPath, "item_option_new", true);
          }
        }
      }

      // Push client_scripts (catalog_script_client)
      if (fs.existsSync(clientScriptsFolder)) {
        console.log(`   📜 Pushing client scripts...`);
        const scriptDirs = fs.readdirSync(clientScriptsFolder);
        for (const scriptDir of scriptDirs) {
          const scriptPath = path.join(clientScriptsFolder, scriptDir);
          if (!fs.lstatSync(scriptPath).isDirectory()) continue;

          const sysIdPath = path.join(scriptPath, ".sys_id");
          if (fs.existsSync(sysIdPath)) {
            // Update existing script
            console.log(`      ↻ Updating script: ${scriptDir}`);
            const files = fs.readdirSync(scriptPath);
            for (const file of files) {
              // Skip hidden files and metadata files (only push actual field files like script.js)
              if (file.startsWith(".") || file.startsWith("_")) continue;
              const fp = path.join(scriptPath, file);
              // Pass the real SN table name — folder is 'client_scripts' but table is 'catalog_script_client'
              if (fs.lstatSync(fp).isFile()) await pushToServiceNow(fp, "catalog_script_client");
            }
          } else {
            // Create new script
            console.log(`      ✨ Creating new script: ${scriptDir}`);
            await createRecordInServiceNow(
              scriptPath,
              "catalog_script_client",
              true,
            );
          }
        }
      }

      // Push flow (flow.json / workflow.json)
      const flowFolder = path.join(targetPath, "flow");
      if (fs.existsSync(flowFolder)) {
        const flowJsonPath = path.join(flowFolder, "flow.json");
        const workflowJsonPath = path.join(flowFolder, "workflow.json");
        if (fs.existsSync(flowJsonPath)) {
          console.log(`   🔄 Pushing flow...`);
          await pushFlowJson(flowJsonPath);
        } else if (fs.existsSync(workflowJsonPath)) {
          console.log(`   ⚠️  workflow.json push not yet supported (legacy engine).`);
        }
      }

      console.log("   ✅ Catalog item push complete!");
      return;
    }

    // Scenario A: It is a Record Folder (Parent is a mapped table OR user specified table)
    // Check if parent matches a table
    let tableName = CONFIG.mapping[parentName] ? parentName : null;

    // If exact table param was passed, trust it
    if (!tableName && table) tableName = table;

    // If we found a valid table context
    if (tableName) {
      const sysIdPath = path.join(targetPath, ".sys_id");

      if (fs.existsSync(sysIdPath)) {
        // Push All Files (Update)
        console.log(`   📂 Updating record: ${dirName}`);
        const files = fs.readdirSync(targetPath);
        for (const file of files) {
          if (file.startsWith(".")) continue;
          const fp = path.join(targetPath, file);
          if (fs.lstatSync(fp).isFile()) await pushToServiceNow(fp);
        }
      } else {
        // Create New
        await createRecordInServiceNow(targetPath, tableName);
      }
      return;
    }

    // Scenario B: It is a Table Folder (The folder itself IS the table)
    // e.g. src/sys_script
    if (CONFIG.mapping[dirName]) {
      console.log(`   📦 Bulk Mode: Scanning table [${dirName}]...`);
      const children = fs.readdirSync(targetPath);
      for (const child of children) {
        const childPath = path.join(targetPath, child);
        if (fs.lstatSync(childPath).isDirectory()) {
          // Check if it's new
          const childSysId = path.join(childPath, ".sys_id");
          if (!fs.existsSync(childSysId)) {
            await createRecordInServiceNow(childPath, dirName);
          } else {
            // Optional: Could update existing too, but 'Bulk Create' is safer default for broad push
            // console.log(`      Skipping existing: ${child}`);
          }
        }
      }
      return;
    }

    console.error(
      `❌ Folder '${dirName}' is neither a configured table nor a record inside one.`,
    );
  }

  console.error("❌ Insufficient parameters.");
  console.error("   Usage 1: --push src/table/folder/file.js");
  console.error("   Usage 2: --push --table sp_widget --name Folder_Name");
}

// --- EXECUTION ---

// Simple arg parser
function getArgValue(flag) {
  const idx = args.indexOf(flag);
  const next = idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  return next && !next.startsWith("--") ? next : null;
}

// Resolves an Update Set name (e.g. "Github Form Updates") to its sys_id.
// If the input already looks like a 32-char hex sys_id, it is returned as-is.
async function resolveUpdateSetSysId(nameOrSysId) {
  if (!nameOrSysId || !nameOrSysId.trim()) return null;
  const value = nameOrSysId.trim();

  // Already a sys_id (32 hex chars)
  if (/^[a-f0-9]{32}$/i.test(value)) return value;

  console.log(`🔍 Looking up Update Set: "${value}"...`);
  try {
    const res = await snClient.get("/api/now/table/sys_update_set", {
      params: {
        sysparm_query: `nameLIKE${value}^state=in progress`,
        sysparm_fields: "sys_id,name,state",
        sysparm_limit: 10,
      },
    });
    const records = res.data.result || [];
    if (records.length === 0) {
      console.error(`❌ No Update Set found matching "${value}".`);
      console.error("   Make sure the name is correct and the Update Set is 'In Progress'.");
      process.exit(1);
    }
    if (records.length === 1) {
      console.log(`✅ Update Set resolved: "${records[0].name}" (${records[0].sys_id})`);
      return records[0].sys_id;
    }
    // Multiple matches — list them and pick the first exact match, or the first result
    console.log(`⚠️  Multiple Update Sets matched "${value}":`);
    records.forEach((r, i) => console.log(`   [${i + 1}] ${r.name} (${r.sys_id})`));
    const exact = records.find((r) => r.name.toLowerCase() === value.toLowerCase());
    const chosen = exact || records[0];
    console.log(`   → Using: "${chosen.name}" (${chosen.sys_id})`);
    return chosen.sys_id;
  } catch (err) {
    console.error(`❌ Error resolving Update Set: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  // Resolve --update-set name → sys_id before any push/pull
  const rawUpdateSet = cliUpdateSetSysId || snUpdateSetSysId;
  if (rawUpdateSet) {
    snUpdateSetSysId = await resolveUpdateSetSysId(rawUpdateSet);
  }

if (args.includes("--pull")) {
  const catalogItemId = getArgValue("--catalog-item");

  if (catalogItemId) {
    // Catalog Item Mode: Pull everything related to this CI
    const contextAction = getArgValue("--context-action") || "skip";
    pullCatalogItem(catalogItemId, contextAction);
  } else {
    // Normal Pull Mode
    let options = {
      table: getArgValue("--table"),
      query: getArgValue("--query"),
      contextAction: getArgValue("--context-action"),
      contextList: getArgValue("--context-list"),
    };

    // Support --target for Surgical Pull (Update current record)
    const target = getArgValue("--target");
    if (target && fs.existsSync(target)) {
      // Try to discover context (Table + SysId) based on file
      let searchPath = target;
      if (fs.lstatSync(searchPath).isFile())
        searchPath = path.dirname(searchPath); // Get folder if it's a file

      const sysIdPath = path.join(searchPath, ".sys_id");

      // If not found in immediate folder, try one level up (if using src/table/record/extra_folder)
      // But our structure is src/table/record, so searchPath should be the record.

      if (fs.existsSync(sysIdPath)) {
        const sysId = fs.readFileSync(sysIdPath, "utf8").trim();
        // src/table/record -> Get table name (parent of record)
        const tableDir = path.dirname(searchPath);
        const tableName = path.basename(tableDir);

        console.log(
          `🎯 Surgical Pull detected: Table [${tableName}] ID [${sysId}]`,
        );
        options.table = tableName;
        options.query = `sys_id=${sysId}`;
      } else {
        console.error(
          "❌ Could not identify .sys_id for this file. Surgical pull impossible.",
        );
        process.exit(1);
      }
    }

    pullFromServiceNow(options);
  }
} else if (args.includes("--push")) {
  const target = getArgValue("--push");
  const table = getArgValue("--table");
  const name = getArgValue("--name"); // Expects FOLDER name
  handleManualPush(target, table, name);
} else if (args.includes("--open")) {
  const target = getArgValue("--open");
  handleOpen(target);
} else if (args.includes("--delete")) {
  const target = getArgValue("--delete"); // Folder path
  const table = getArgValue("--table");
  const sysId = getArgValue("--sys_id");
  const force = args.includes("--force");
  deleteFromServiceNow(target, table, sysId, force);
} else if (args.includes("--watch")) {
  console.log(`👀 Monitoring: ${CONFIG.localFolder}`);
  console.log(
    `   (Edit files and save to push to ServiceNow; new records created on save)`,
  );

  const watcher = chokidar.watch(CONFIG.localFolder, {
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on("change", (filePath) => {
    const ext = path.extname(filePath);
    if (
      ![".js", ".html", ".css", ".xml", ".scss", ".json", ".txt"].includes(
        ext,
      ) ||
      filePath.includes(".ai_context")
    )
      return;
    const dirPath = path.dirname(filePath);
    const sysIdPath = path.join(dirPath, ".sys_id");
    if (!fs.existsSync(sysIdPath)) {
      const tableDir = path.dirname(dirPath);
      const tableName = path.basename(tableDir);
      if (CONFIG.mapping[tableName] && CONFIG.mapping[tableName].fields) {
        createRecordInServiceNow(dirPath, tableName);
        return;
      }
    }
    pushToServiceNow(filePath);
  });
} else if (args.includes("--modify-flow")) {
  const flowId = getArgValue("--flow-id");
  const actionId = getArgValue("--action-id");
  const operation = getArgValue("--operation") || "list";
  const param = getArgValue("--param");
  const value = getArgValue("--value");

  if (!flowId) {
    console.error("❌ --modify-flow requires --flow-id <sys_id>");
    process.exit(1);
  }

  const token = await getValidToken();
  const flowModifier = new FlowModifier(CONFIG.url, token, snUpdateSetSysId);

  if (operation === "list") {
    const actions = await flowModifier.listFlowActions(flowId);
    console.log(`\n📋 Actions in flow ${flowId}:`);
    actions.forEach((a) =>
      console.log(`   [${a.order}] ${a.sys_id}  ui_id: ${a.ui_id}`)
    );
  } else if (operation === "get") {
    if (!actionId) { console.error("❌ --operation get requires --action-id"); process.exit(1); }
    const config = await flowModifier.getActionConfig(flowId, actionId);
    console.log(JSON.stringify(config, null, 2));
  } else if (operation === "skip-approval") {
    if (!actionId) { console.error("❌ --operation skip-approval requires --action-id"); process.exit(1); }
    await flowModifier.skipApproval(flowId, actionId, { push: true });
  } else if (operation === "approval") {
    if (!actionId) { console.error("❌ --operation approval requires --action-id"); process.exit(1); }
    if (value === null) { console.error("❌ --operation approval requires --value"); process.exit(1); }
    await flowModifier.modifyApprovalConditions(flowId, actionId, value, { push: true });
  } else if (operation === "modify") {
    if (!actionId) { console.error("❌ --operation modify requires --action-id"); process.exit(1); }
    if (!param) { console.error("❌ --operation modify requires --param"); process.exit(1); }
    if (value === null) { console.error("❌ --operation modify requires --value"); process.exit(1); }
    // Auto-cast value type
    let castValue = value;
    if (value === "true") castValue = true;
    else if (value === "false") castValue = false;
    else if (!isNaN(value) && value !== "") castValue = Number(value);
    await flowModifier.modifyActionParameter(flowId, actionId, param, castValue, { push: true });
  } else {
    console.error(`❌ Unknown operation: ${operation}`);
    console.error("   Valid operations: list, get, skip-approval, approval, modify");
    process.exit(1);
  }
} else {
  console.log("Commands: node snsync --pull | node snsync --watch");
}

} // end main()

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
