#!/bin/bash
# One-time setup of snsync + ServiceNow SDK for a teammate's Mac.
#
#   bash team/setup.sh --bundle <snsync-team-bundle.txt> [--pass-file <file>] [--force]
#
# Safe to re-run: existing .env files, memories and shell lines are kept.
# Prints paths and status only, never secret values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE=""
UNPACK_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) BUNDLE="$2"; shift 2 ;;
    --pass-file) UNPACK_ARGS+=(--pass-file "$2"); shift 2 ;;
    --force) UNPACK_ARGS+=(--force); shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "== 1/5 Node"
if ! command -v node >/dev/null; then
  echo "❌ Node is not installed. Install Node 20+ from https://nodejs.org (LTS .pkg), then re-run."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node $(node -v) is too old. Install Node 20+ from https://nodejs.org, then re-run."
  exit 1
fi
echo "✅ node $(node -v)"

echo "== 2/5 snsync dependencies"
(cd "$ROOT/_tool" && npm install --no-fund --no-audit --loglevel=error)
echo "✅ _tool/node_modules ready"

echo "== 3/5 Environments and memories"
if [ -n "$BUNDLE" ]; then
  node "$ROOT/team/unpack-bundle.cjs" --bundle "$BUNDLE" ${UNPACK_ARGS[@]+"${UNPACK_ARGS[@]}"}
else
  echo "⏭️  No --bundle given; skipping .env files and memories."
fi

echo "== 4/5 Shell settings (~/.zshrc)"
ZSHRC="$HOME/.zshrc"
touch "$ZSHRC"
if ! grep -q 'SN_ENC_SECRET=' "$ZSHRC"; then
  printf '\n# snsync: encrypts OAuth tokens at rest (.token_cache.json)\nexport SN_ENC_SECRET="%s"\n' \
    "$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')" >> "$ZSHRC"
  echo "✅ Added SN_ENC_SECRET to ~/.zshrc"
else
  echo "✔️  SN_ENC_SECRET already in ~/.zshrc"
fi
# Zscaler re-signs TLS; Node ignores the Keychain, so point it at the root CA.
if security find-certificate -c "Zscaler Root CA" /Library/Keychains/System.keychain >/dev/null 2>&1; then
  mkdir -p "$HOME/.certs"
  if [ ! -s "$HOME/.certs/zscaler.pem" ]; then
    security find-certificate -a -c "Zscaler Root CA" -p /Library/Keychains/System.keychain > "$HOME/.certs/zscaler.pem"
    echo "✅ Exported Zscaler root CA to ~/.certs/zscaler.pem"
  fi
  if ! grep -q 'NODE_EXTRA_CA_CERTS=' "$ZSHRC"; then
    printf '\n# Node behind Zscaler (snsync, now-sdk)\nexport NODE_EXTRA_CA_CERTS="$HOME/.certs/zscaler.pem"\n' >> "$ZSHRC"
    echo "✅ Added NODE_EXTRA_CA_CERTS to ~/.zshrc"
  else
    echo "✔️  NODE_EXTRA_CA_CERTS already in ~/.zshrc"
  fi
else
  echo "⏭️  No Zscaler root CA in the System keychain; skipping."
fi

echo "== 5/5 ServiceNow SDK (now-sdk)"
if command -v now-sdk >/dev/null; then
  echo "✅ now-sdk $(now-sdk --version 2>/dev/null | tail -1)"
elif [ -w "$(npm prefix -g)/lib" ]; then
  npm install -g @servicenow/sdk@4.14.2 --no-fund --no-audit --loglevel=error
  echo "✅ Installed now-sdk"
else
  echo "⚠️  now-sdk not installed and the global npm folder needs admin rights. Run in your terminal:"
  echo "      sudo npm install -g @servicenow/sdk@4.14.2"
fi

cat <<'EOF'

== Next steps (need your browser / your login) ==
1. Open a NEW terminal (or restart Claude Code) so ~/.zshrc is loaded.
2. now-sdk logins (each opens the browser; use your own account):
     now-sdk auth --add https://levidev.service-now.com --type oauth --alias levidev
     now-sdk auth --use levidev
   Optional, agile/change records only:
     now-sdk auth --add https://levi.service-now.com --type oauth --alias leviprod
3. First snsync pull (opens the browser for the levidev OAuth login):
     node snsync --pull --table sys_script_include --query "nameSTARTSWITHLevi" --project projects/levidev --context-action skip
EOF
