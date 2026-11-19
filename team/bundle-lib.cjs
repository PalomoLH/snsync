// Shared helpers for the team bundle: encryption format and Claude memory paths.
//
// Bundle file (text):
//   # comment lines
//   SNSYNC-BUNDLE-V1
//   <base64: salt(16) | iv(12) | authTag(16) | AES-256-GCM ciphertext>
// The plaintext is JSON: { version, created, files: [{ path, mode, content }] }.

const crypto = require("crypto");
const os = require("os");
const path = require("path");

const MAGIC = "SNSYNC-BUNDLE-V1";
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT);
}

function encrypt(obj, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  const blob = Buffer.concat([salt, iv, cipher.getAuthTag(), body]).toString("base64");
  return [
    "# snsync team bundle (encrypted). Do not open or paste this file into a chat.",
    "# Unpack: bash team/setup.sh --bundle <this file> --pass-file <passphrase file>",
    MAGIC,
    blob.replace(/(.{76})/g, "$1\n"),
    "",
  ].join("\n");
}

function decrypt(text, passphrase) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  if (lines[0] !== MAGIC) throw new Error("Not an snsync team bundle (missing header).");
  const raw = Buffer.from(lines.slice(1).join(""), "base64");
  const salt = raw.subarray(0, 16);
  const iv = raw.subarray(16, 28);
  const tag = raw.subarray(28, 44);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(raw.subarray(44)), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch (_) {
    throw new Error("Wrong passphrase or damaged bundle.");
  }
}

// Claude Code keeps per-project memory in ~/.claude/projects/<path with non-alphanumerics as "-">/memory
function claudeMemoryDir(repoRoot) {
  return path.join(os.homedir(), ".claude", "projects", repoRoot.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
}

module.exports = { encrypt, decrypt, claudeMemoryDir };
