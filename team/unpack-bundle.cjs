#!/usr/bin/env node
// Decrypts the team bundle and writes each file to its place. Prints paths only,
// never file contents, so Claude can run it without seeing any secret.
//
//   node team/unpack-bundle.cjs --bundle <file> [--pass-file <file>] [--force] [--dry-run]
//
// Passphrase: --pass-file, else $SNSYNC_BUNDLE_PASS, else a hidden prompt.
// Existing .env / sn-config.json files are kept unless --force (then backed up).
// Memories go to this repo's Claude memory folder; existing ones are never overwritten.

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { decrypt, claudeMemoryDir } = require("./bundle-lib.cjs");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const FORCE = args.includes("--force");
const DRY = args.includes("--dry-run");

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

function write(dest, content, mode) {
  if (DRY) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, { mode });
  fs.chmodSync(dest, mode);
}

(async () => {
  const bundlePath = opt("--bundle");
  if (!bundlePath || !fs.existsSync(bundlePath)) {
    console.error("❌ Pass --bundle <path to snsync-team-bundle.txt>");
    process.exit(1);
  }
  const passFile = opt("--pass-file");
  const passphrase = passFile
    ? fs.readFileSync(passFile, "utf8").trim()
    : process.env.SNSYNC_BUNDLE_PASS || (await askHidden("🔑 Bundle passphrase: "));

  let bundle;
  try {
    bundle = decrypt(fs.readFileSync(bundlePath, "utf8"), passphrase);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  console.log(`📦 Bundle from ${bundle.created} (${bundle.files.length} files)${DRY ? " [dry run]" : ""}`);

  const memDir = claudeMemoryDir(ROOT);
  let indexLines = [];

  for (const f of bundle.files) {
    if (f.path === "memory/MEMORY.md") {
      indexLines = f.content.split("\n").filter(Boolean);
      continue;
    }
    if (f.path.startsWith("memory/")) {
      const dest = path.join(memDir, path.basename(f.path));
      if (fs.existsSync(dest)) {
        console.log(`   ⏭️  memory kept: ${path.basename(f.path)}`);
      } else {
        write(dest, f.content, f.mode);
        console.log(`   🧠 memory: ${path.basename(f.path)}`);
      }
      continue;
    }
    if (!/^projects\/[A-Za-z0-9_.-]+\/(\.env|sn-config\.json)$/.test(f.path)) {
      console.log(`   ⚠️  skipped unexpected path: ${f.path}`);
      continue;
    }
    const dest = path.join(ROOT, f.path);
    if (fs.existsSync(dest)) {
      if (fs.readFileSync(dest, "utf8") === f.content) {
        console.log(`   ✔️  unchanged: ${f.path}`);
        continue;
      }
      if (!FORCE) {
        console.log(`   ⏭️  kept existing: ${f.path} (use --force to replace)`);
        continue;
      }
      const backup = `${dest}.bak-${Date.now()}`;
      if (!DRY) fs.copyFileSync(dest, backup);
      console.log(`   💾 backup: ${path.relative(ROOT, backup)}`);
    }
    write(dest, f.content, f.mode);
    console.log(`   ✅ wrote: ${f.path}`);
  }

  // Merge the memory index: add lines whose file isn't referenced yet.
  if (indexLines.length) {
    const indexFile = path.join(memDir, "MEMORY.md");
    const current = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, "utf8") : "";
    const add = indexLines.filter((l) => {
      const m = l.match(/\]\(([^)]+\.md)\)/);
      return m && !current.includes(`(${m[1]})`);
    });
    if (add.length) {
      write(indexFile, (current && !current.endsWith("\n") ? current + "\n" : current) + add.join("\n") + "\n", 0o644);
    }
    console.log(`   🗂️  memory index: +${add.length} lines → ${indexFile}`);
  }
  console.log("✅ Unpack done.");
})();
