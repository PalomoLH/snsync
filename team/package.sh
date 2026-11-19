#!/bin/bash
# Builds one zip a teammate's Claude can unzip and set up from:
#   snsync/                      the repo at HEAD (no node_modules, no projects data)
#   snsync/START-HERE.md         the prompt to paste into Claude
#   snsync/team-private/snsync-team-bundle.txt   encrypted envs + memories (git-ignored)
#
#   bash team/package.sh [--no-bundle]
#
# The passphrase is NOT put in the zip: send team-private/PASSPHRASE.txt separately.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WITH_BUNDLE=1
[ "${1:-}" = "--no-bundle" ] && WITH_BUNDLE=0

if [ "$WITH_BUNDLE" = 1 ]; then
  node team/build-bundle.cjs
fi

STAMP="$(date +%Y-%m-%d)"
OUT="$ROOT/team-private/snsync-team-kit-$STAMP.zip"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git archive --format=tar --prefix=snsync/ HEAD | tar -x -C "$WORK"
mkdir -p "$WORK/snsync/team-private"
if [ "$WITH_BUNDLE" = 1 ]; then
  cp team-private/snsync-team-bundle.txt "$WORK/snsync/team-private/"
fi

cat > "$WORK/snsync/START-HERE.md" <<'EOF'
# START HERE

1. Move this `snsync` folder to `~/workspace/snsync` (any path works, keep it stable).
2. Save the passphrase you received separately to `~/Downloads/snsync-pass.txt`.
3. Open the `snsync` folder in Claude Code (desktop app → Code tab, or `claude` in a terminal) and paste:

```text
Set up this snsync repo for me using the team kit.

Bundle: team-private/snsync-team-bundle.txt
Passphrase file: ~/Downloads/snsync-pass.txt

Rules:
- Never open, cat, grep or print the bundle, the passphrase, any projects/*/.env or .token_cache.json. Only run the scripts, which print paths, not values.
- Read CLAUDE.md and team/ONBOARDING.md first and follow them.

Steps:
1. Run: bash team/setup.sh --bundle team-private/snsync-team-bundle.txt --pass-file ~/Downloads/snsync-pass.txt
   If it says now-sdk needs sudo, give me the exact command to run in my own terminal and wait.
2. Tell me which projects/<env> folders now have a .env, and which ones use the shared read-only integration user.
3. Walk me through the now-sdk logins (levidev as default; leviprod only if I want agile/change records). They open my browser, so give me each command and wait for me.
4. Do a first read-only pull from levidev to test the OAuth login, e.g. script includes starting with "Levi".
5. Confirm the guard hook is active: explain what it blocks, without trying a real push to leviprod.
6. Check which connectors I have (Microsoft 365, Chrome) and tell me what is missing.
7. Delete the passphrase file and team-private/snsync-team-bundle.txt once everything works, after asking me.
Finish with a short summary of what works and what is still on me.
```

Manual prerequisites (Node 20+, Claude in Chrome, connectors) are in `team/ONBOARDING.md`.
EOF

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$WORK" && zip -qr -X "$OUT" snsync)
echo "✅ Zip: ${OUT#$ROOT/} ($(du -h "$OUT" | cut -f1 | tr -d ' '))$([ "$WITH_BUNDLE" = 0 ] && echo ' [no bundle]')"
echo "   Send the zip and team-private/PASSPHRASE.txt through two different private channels."
