#!/usr/bin/env node

// Lightweight bridge so editors can call a single command (`snsync`)
// regardless of where the repo lives on disk.
const { spawn } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliEntry = path.join(repoRoot, '_tool', 'sn-sync.js');
const args = process.argv.slice(2);

const child = spawn(process.execPath, [cliEntry, ...args], {
  cwd: repoRoot,
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
