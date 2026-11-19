# Team onboarding: snsync + ServiceNow SDK + Claude Code

This setup gives you the same Claude Code setup the team lead uses: the snsync CLI, the ServiceNow SDK (`now-sdk`), the project rules (`CLAUDE.md`), the skills (`.claude/skills`), a guard hook that keeps production read-only, every environment's `.env`, and the team's shared Claude memories.

## What you get from the team lead (private channels only)

1. **`snsync-team-bundle.txt`**: one encrypted text file with every `projects/<env>/.env`, `sn-config.json`, and the shared memories. Opening it shows only encrypted text.
2. **The passphrase**, sent separately (different channel from the bundle). Save it to a file, e.g. `~/Downloads/snsync-pass.txt`.

Never commit either file, and never paste them into a chat. This repo is public.

## Before you start (manual, 10 minutes)

- **Claude desktop app** (Code tab) or Claude Code CLI, signed in with your company Claude account.
- **Node 20+** from https://nodejs.org (LTS .pkg) and **git**.
- **Connectors** (claude.ai → Settings → Connectors, per person; they can't be shared as files): Microsoft 365 (Outlook/Teams/SharePoint read), plus Figma or Airtable if you use them.
- **Claude in Chrome** extension. Company SSO blocks the app's built-in browser for ServiceNow, so Claude uses your Chrome.
- Clone the repo:
  ```bash
  git clone https://github.com/PalomoLH/snsync.git ~/workspace/snsync
  ```

## The prompt to paste into Claude

Open the `~/workspace/snsync` folder in Claude Code, fix the two paths, and paste:

```text
Set up this snsync repo for me using the team kit.

Bundle: ~/Downloads/snsync-team-bundle.txt
Passphrase file: ~/Downloads/snsync-pass.txt

Rules:
- Never open, cat, grep or print the bundle, the passphrase, any projects/*/.env or .token_cache.json. Only run the scripts, which print paths, not values.
- Read CLAUDE.md and team/ONBOARDING.md first and follow them.

Steps:
1. Run: bash team/setup.sh --bundle <bundle> --pass-file <passphrase file>
   If it says now-sdk needs sudo, give me the exact command to run in my own terminal and wait.
2. Tell me which projects/<env> folders now have a .env, and which ones use the shared read-only integration user.
3. Walk me through the now-sdk logins (levidev as default; leviprod only if I want agile/change records). They open my browser, so give me each command and wait for me.
4. Do a first read-only pull from levidev to test the OAuth login, e.g. script includes starting with "Levi".
5. Confirm the guard hook is active: explain what it blocks, without trying a real push to leviprod.
6. Check which connectors I have (Microsoft 365, Chrome) and tell me what is missing.
7. Delete the bundle and passphrase files from Downloads once everything works, after asking me.
Finish with a short summary of what works and what is still on me.
```

## How it behaves afterwards

- **levidev** is the default target for every change. Pushes need an Update Set, and Claude asks which one.
- **leviprod** is pull-only through snsync, and the hook blocks writes. The only writes allowed are agile/change records (`rm_story`, `rm_scrum_task`, `change_request`, `change_task`) through your own `now-sdk` `leviprod` login, with your yes each time.
- **Shared integration user** (`leviprod`, `levistaging`): read-only. Claude says so in chat every time it uses it. To use your own account instead, replace `SN_USER`/`SN_PASSWORD` in `projects/<env>/.env` yourself. The notice and lock stop automatically (leviprod stays pull-only).
- **Memories**: the shared memories land in your Claude memory for this folder. They describe the team lead's past work ("the user" = the team lead). Treat open items in them as background, not your tasks.

## Updating

- Code, skills, rules: `git pull`.
- New credentials or memories: the team lead runs `node team/build-bundle.cjs` and sends a new bundle. Re-run `team/setup.sh`. Your existing `.env` files are kept unless you add `--force` (then they're backed up first).
