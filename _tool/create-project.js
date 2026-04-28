const fs = require("fs-extra");
const path = require("path");

function syncVSCodeProjectPicker(repoRoot, projectsDir, projectName) {
  const tasksPath = path.join(repoRoot, ".vscode", "tasks.json");
  if (!fs.existsSync(tasksPath)) {
    console.warn("   ⚠️ VS Code tasks.json not found; skipping picker update.");
    return;
  }

  try {
    const tasksConfig = fs.readJsonSync(tasksPath);
    if (!Array.isArray(tasksConfig.inputs)) {
      console.warn('   ⚠️ VS Code tasks.json missing "inputs" section.');
      return;
    }

    const picker = tasksConfig.inputs.find(
      (input) => input.id === "pickProject",
    );
    if (!picker) {
      console.warn("   ⚠️ VS Code project picker input not found.");
      return;
    }

    const directories = fs
      .readdirSync(projectsDir)
      .filter((entry) => {
        if (entry.startsWith(".")) return false;
        const fullPath = path.join(projectsDir, entry);
        try {
          return fs.statSync(fullPath).isDirectory();
        } catch (err) {
          return false;
        }
      })
      .map((entry) => path.posix.join("projects", entry));

    const newEntry = path.posix.join("projects", projectName);
    if (!directories.includes(newEntry)) directories.push(newEntry);
    directories.sort((a, b) => a.localeCompare(b));

    picker.options = directories;
    if (directories.length > 0) {
      picker.default = directories.includes(picker.default)
        ? picker.default
        : directories[0];
    }

    fs.writeJsonSync(tasksPath, tasksConfig, { spaces: 4 });
    console.log("   ✅ VS Code project picker updated.");
  } catch (err) {
    console.warn(
      `   ⚠️ Could not update VS Code project picker: ${err.message}`,
    );
  }
}

// Helper to parse arguments --flag value
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : "";
}

const name = getArg("--name");
const instance = getArg("--instance");
const authMode = getArg("--auth-mode"); // 'oauth' or 'basic'
const clientId = getArg("--clientId");
const clientSecret = getArg("--clientSecret");
const user = getArg("--user");
const pass = getArg("--password");

if (!name) {
  console.error("❌ Error: Project name is required (--name)");
  process.exit(1);
}
if (!instance) {
  console.error("❌ Error: Instance URL is required (--instance)");
  process.exit(1);
}

// Validate credentials based on auth mode
if (authMode === "oauth") {
  if (!clientId || !clientSecret) {
    console.error(
      "❌ Error: OAuth mode requires --clientId and --clientSecret",
    );
    process.exit(1);
  }
} else if (authMode === "basic") {
  if (!user || !pass) {
    console.error("❌ Error: Basic auth mode requires --user and --password");
    process.exit(1);
  }
} else {
  // Auto-detect: require at least one valid combo
  const hasOAuth = clientId && clientSecret;
  const hasBasic = user && pass;
  if (!hasOAuth && !hasBasic) {
    console.error(
      "❌ Error: Provide either --clientId + --clientSecret (OAuth) or --user + --password (Basic Auth)",
    );
    process.exit(1);
  }
}

// Base directory for projects is assumed as ../projects relative to this script in _tool/
const rootDir = path.resolve(__dirname, "..");
const projectsDir = path.join(rootDir, "projects");
const targetDir = path.join(projectsDir, name);

if (fs.existsSync(targetDir)) {
  console.error(
    `❌ Error: Project with name '${name}' already exists at ${targetDir}`,
  );
  process.exit(1);
}

console.log(`🔨 Creating project '${name}'...`);

try {
  // 1. Create folder structure
  fs.ensureDirSync(path.join(targetDir, "src"));

  // 2. Copy TEMPLATE content to new project
  // (.vscode, .github, sn-config.json, etc)
  const templatesDir = path.join(__dirname, "templates");
  if (fs.existsSync(templatesDir)) {
    fs.copySync(templatesDir, targetDir);
    console.log("   ✅ Default structure (Templates) copied.");
  } else {
    console.warn(
      "   ⚠️ _tool/templates folder not found. Only basic structure created.",
    );
    // Fallback: create empty sn-config if none exists
    fs.outputJSONSync(
      path.join(targetDir, "sn-config.json"),
      { mapping: {} },
      { spaces: 4 },
    );
  }

  // 3. Create .env file (instance specific)
  let envContent = `SN_INSTANCE=${instance}\n`;

  const resolvedMode =
    authMode || (clientId && clientSecret ? "oauth" : "basic");

  if (resolvedMode === "oauth") {
    envContent += `SN_CLIENT_ID=${clientId}\n`;
    envContent += `SN_CLIENT_SECRET=${clientSecret}\n`;
    envContent += `# Authentication: OAuth (Browser)\n`;
  } else {
    envContent += `SN_USER=${user}\n`;
    envContent += `SN_PASSWORD=${pass}\n`;
    envContent += `# Authentication: Basic Auth\n`;
  }

  fs.writeFileSync(path.join(targetDir, ".env"), envContent);
  console.log("   ✅ .env file generated.");

  syncVSCodeProjectPicker(rootDir, projectsDir, name);

  console.log(`\n🎉 Project '${name}' created successfully!`);
  console.log(`   📂 Location: ${targetDir}`);
  console.log(`   👉 To use: Select this project in VS Code Tasks.`);
} catch (e) {
  console.error(`❌ Failed to create project: ${e.message}`);
  process.exit(1);
}
