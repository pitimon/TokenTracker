# Security Policy

## Supported Versions

Only the **latest minor release** is supported with security fixes. This is a small project — please run a recent version.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security reports.**

Instead, use one of these private channels:

- **GitHub Private Vulnerability Reporting**: [Report a vulnerability](https://github.com/pitimon/TokenTracker/security/advisories/new)
- **Email**: open a GitHub issue asking the maintainer to enable an alternative private channel if you can't use GitHub Security Advisories

When reporting, please include:

- A clear description of the issue
- Steps to reproduce
- Affected version(s)
- Your assessment of impact (data exposure, privilege escalation, etc.)
- Any suggested mitigation, if you have one

You can expect an initial response within a few days. Once a fix is ready, it will ship in the next release with a credit to you (or anonymously if you prefer).

## Scope

TokenTracker is a local web tool: a browser dashboard served by a CLI HTTP backend bound to loopback. It reads AI CLI tool logs from the user's home directory. There is no hosted/cloud service or supported native app. The most sensitive areas to consider when reviewing security:

- **`src/lib/rollout.js`** — parses logs from 8 different AI CLI tools. Privacy rule: usage metadata only — source, model, token and conversation counts, timestamps, and derived cost; never prompts, responses, message bodies, or private user-code paths.
- **`src/lib/cursor-config.js`** — reads Cursor's local SQLite to extract auth tokens for the Cursor usage API. Credentials may be sent only to declared Cursor authentication or quota hosts and must never enter TokenTracker queues, logs, diagnostics, or API responses.
- **`src/lib/local-api.js`** — local HTTP server bound to `127.0.0.1`. Should not accept connections from other hosts.
- **Archived native source** — `archive/native-apps/TokenTrackerBar/` and `archive/native-apps/TokenTrackerWin/` are unsupported historical code and outside the active security-support boundary unless explicitly reactivated.

## Out of Scope

- Issues only reproducible with arbitrary modifications to the user's local files outside the documented data paths
- Vulnerabilities in dependencies that have already been disclosed and patched upstream — please report those upstream first
- Social engineering, phishing, or other non-technical attack vectors

## Privacy Commitment

TokenTracker's foundational privacy rule: **usage metadata only — source, model, token and conversation counts, timestamps, and derived cost; never prompts, responses, message bodies, or private user-code paths**. Credentials are used only for declared provider authentication or quota flows and their credential files; never place them in TokenTracker queues, logs, fixtures, diagnostics, API responses, or unrelated outbound payloads. Any change that risks violating this is treated as a security issue.
