# Security and Authentication Roadmap

This document records security improvement ideas and architectural decisions discussed during the development of the `sn-sync` tool.

## 1. Authentication Strategies

### Current: OAuth 2.0 Authorization Code (Browser Flow)
- **How it works:** The script opens the browser, the user logs into ServiceNow, and the token is returned to `localhost:3000`.
- **Pros:** No need to save passwords if entered manually; Uses browser session (MFA/SSO handled natively).
- **Cons:** Requires human interaction (popup window) when the Refresh Token becomes invalid.

### Future Idea: JWT Bearer Flow (Certificate Based)
ServiceNow supports **Inbound** authentication via signed JWT, ideal for "Headless" automation (CI/CD, Server Scripts).

- **Flow:**
    1. Generate RSA key pair (Private/Public).
    2. Register Public Key in ServiceNow (`x509_certificate` table or OAuth Profile).
    3. Node.js script signs a JWT using the local Private Key.
    4. Script sends the JWT to `/oauth_token.do`.
    5. ServiceNow validates the signature and returns the Access Token.
- **Advantage:** Zero human interaction.
- **Challenge:** Protecting the `.pem` file (Private Key) on the local machine becomes the new security focus (equivalent to protecting SSH `id_rsa`).

## 2. Secret Management

### Level 1: .env Files (Basic)
- **Risk:** Plain text. If leaked in Git, compromises everything.
- **Current Mitigation:** `.gitignore` and `.idignore`.

### Level 2: Shell Environment Variables (Intermediate - Current)
- **Technique:** `export SN_ENC_SECRET="..."` in `~/.zshrc` or `~/.bash_profile`.
- **Advantage:** The secret lives in terminal session memory, not project files.
- **Implemented:** AES-256 encryption of `.token_cache.json` using this key.

### Level 3: Native Keystores (Advanced)
- **Windows:** DPAPI / Credential Manager.
- **macOS:** Keychain Access (`security` CLI).
- **Linux:** GNOME Keyring / KWallet.
- **Difficulty:** Requires native Node.js modules (C++ compilation) or complex system calls. Difficult to maintain portability.

## 3. Threat Modeling for Personal Projects

### Where are the real risks?

1.  **Leak in Public Repository (The "Intern Error")**
    *   *Scenario:* Committing `.env` or `.vscode` folder with hardcoded tokens to public GitHub.
    *   *Consequence:* Bots scan GitHub in seconds and exploit credentials.
    *   *Defense:* `git-secrets`, strict `.gitignore`, pre-commit scanning.

2.  **Malicious Dependencies (Supply Chain)**
    *   *Scenario:* An npm package (e.g., `axios-fake`) captures environment variables.
    *   *Defense:* `npm audit`, minimal dependencies, lockfiles.
