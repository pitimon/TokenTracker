<div align="center">

# Token Tracker

### Know exactly what you're spending on AI — across every CLI

Auto-collect token usage from **20+ AI coding tools**, aggregate it locally, and read real cost trends in one dashboard. No account or API key required to start — just one command.

[![npm version](https://img.shields.io/npm/v/@ipv9/tokentracker-cli.svg?color=blue)](https://www.npmjs.com/package/@ipv9/tokentracker-cli)
[![npm downloads](https://img.shields.io/npm/dm/@ipv9/tokentracker-cli.svg?color=brightgreen)](https://www.npmjs.com/package/@ipv9/tokentracker-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![CLI](https://img.shields.io/badge/CLI-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-lightgrey.svg)](https://www.npmjs.com/package/@ipv9/tokentracker-cli)
[![GitHub stars](https://img.shields.io/github/stars/pitimon/TokenTracker?style=social)](https://github.com/pitimon/TokenTracker/stargazers)

<br/>

<img src="https://raw.githubusercontent.com/pitimon/TokenTracker/main/docs/screenshots/dashboard-dark.png" alt="Token Tracker dashboard" width="820" />

<br/><br/>

⭐ **If TokenTracker saves you time, please [star it on GitHub](https://github.com/pitimon/TokenTracker).**

</div>

---

## 🤔 Why not just read each provider's billing page?

You can — that is the honest alternative, and for a single tool it is enough. TokenTracker earns its place once you use more than one:

- **One number instead of six tabs.** Claude, Codex, Cursor, Gemini and Copilot each bill in their own dashboard, on their own reset schedule, in their own units. Nobody adds them up for you.
- **Subscriptions hide the number entirely.** A flat monthly plan shows you a quota bar, not what your usage would have cost. TokenTracker prices every token against public model rates, so you can see whether the plan is a bargain or a subsidy you have outgrown.
- **Per-project and per-model, not just per-account.** Billing pages answer "what do I owe this month". This answers "which repo, which model, and which hour" — the resolution you need to actually change something.
- **Quota chips before you hit the wall.** Live plan-limit usage sits on each provider's card, so a 5-hour window running out is something you see rather than something you discover.

If you only use one tool and never care about per-project cost, the provider's own page is genuinely fine. This is for the rest.

---

## ⚡ Quick Start

> **Requires** Node.js **20+**.

```bash
npx --yes @ipv9/tokentracker-cli
```

That's it. The first run installs hooks, syncs your data, and prints the dashboard URL, usually `http://127.0.0.1:7680`. Pass `--open` if you want TokenTracker to ask the OS to open your browser.

Prefer a global install for shorter commands:

```bash
npm install -g @ipv9/tokentracker-cli

tokentracker            # start the dashboard and print the URL
tokentracker serve --open
tokentracker sync       # sync now
tokentracker status     # check which tools are connected
tokentracker doctor     # health check
```

---

## 💻 Prefer an app? There's a desktop build

If you'd rather not keep a terminal open, both native apps are on the [Releases page](https://github.com/pitimon/TokenTracker/releases/latest):

| Platform | Download | What it adds |
|---|---|---|
| **macOS 12+** | `TokenTrackerBar.dmg` | A menu-bar app — live token count in the menu bar, launch at login, sync and update from a click, plus a desktop widget. |
| **Windows** | `TokenTracker-Setup.exe` | The same dashboard as a standalone app. |

<img src="https://raw.githubusercontent.com/pitimon/TokenTracker/main/docs/screenshots/menubar.gif" alt="TokenTracker in the macOS menu bar" width="420" />

Both bundle their own Node runtime, so there is nothing else to install. They share the same local data as the CLI — run either, or both. The desktop builds are cut less often than the npm package, so the latest release tag usually trails the npm version badge above.

---

## ✨ What you get

- 🔒 **Your usage data never leaves your machine.** Token counts and timestamps only — never prompts, responses, or file contents. No account, no telemetry, no analytics, no phone-home. TokenTracker does make a few outbound calls *on your behalf* (model prices, your own plan quotas); every one is named in [Privacy](#-privacy) below, and none of them carry your usage.
- 📊 **One calm web dashboard.** Your whole picture in the browser at a local URL, no login — light or dark, auto-refreshing while the tab is open. [What's on it ↓](#-the-dashboard)
- 📈 **Quota at a glance, on every card.** Live plan-quota usage (e.g. 5h + weekly) as color-coded chips right on each provider's card — see how close you are to your limits without leaving the overview. Where the provider reports countable units you get the actual number rather than a percentage to convert in your head: GitHub Copilot reads `158/300` premium requests. Full windows + reset countdowns on the Limits page. Covers Claude, Codex, Cursor, Gemini, Kimi, Z.AI, Kiro, Copilot, and Antigravity.
- 💰 **Cost you can trust — and a price tag when it can't.** 2,200+ models priced from [LiteLLM](https://github.com/BerriAI/litellm) (refreshed daily) with a bundled offline snapshot, so USD totals are right even without a network. A model too new to have a price is badged **pricing missing** rather than quietly counted as $0, and prices refresh in the background instead of waiting for a restart. Cross-provider records are de-duplicated to match each provider's own billing.
- 🔌 **20+ tools, zero config.** Claude Code, Codex, Cursor, Gemini, Copilot, Antigravity, OpenCode, Kiro, Zed, Goose, and more — auto-detected, hooks auto-install on first run. Zero to dashboard in ~30 seconds.
- 🧩 **Skills tab.** Syncs 250+ public skills across your tools.

---

## 📊 The dashboard

| Dark | Light |
|---|---|
| <img src="https://raw.githubusercontent.com/pitimon/TokenTracker/main/docs/screenshots/dashboard-dark.png" alt="Dashboard — dark" /> | <img src="https://raw.githubusercontent.com/pitimon/TokenTracker/main/docs/screenshots/dashboard-light.png" alt="Dashboard — light" /> |

**On one screen:**
- **Total tokens + cost** for the selected window (24h / day / 7d / 30d / total / custom), with a browser-timezone "Updated" stamp.
- **Usage Trend** — token volume over time, right beside the total.
- **Provider breakdown** — every tool's share and top models, with each provider's live quota chips (e.g. 5h + weekly — a count like `158/300` where the provider reports one, otherwise a percentage) on its card and a click-to-expand per-model drill-down.
- **Context breakdown** — where Claude's and Codex's tokens actually go (input / output / cache / reasoning), shown side by side.
- **Activity heatmap** — daily usage at a glance.
- **Project & daily tables** — per-project totals and a day-by-day breakdown with cost and $/MTok.

Auto-refresh runs only while the tab is visible (`Off` / `30s` / `60s` / `120s`, default `30s`).

---

## 🔌 Supported tools

Auto-detected on first run — no manual plugin or hook wiring:

> **Claude Code · Codex CLI · Cursor · Gemini CLI · GitHub Copilot · Antigravity · Kiro · OpenCode · OpenClaw · Every Code · Hermes · Kimi Code · CodeBuddy · Grok Build · Droid · oh-my-pi · pi · Craft Agents · Kilo CLI · Kilo Code · Roo Code · Zed Agent · Goose**

Each tool is connected one of three ways, all automatic: a **SessionEnd/notify hook** (Claude Code, Codex, Gemini, Every Code, CodeBuddy, Grok Build), a **bundled plugin** linked via the tool's own CLI (OpenCode, OpenClaw), or a **passive reader** that only reads files the tool already writes — SQLite, JSONL, OTEL exports (Cursor, Kiro, Copilot, Zed, Goose, and the rest).

Run `tokentracker status` to see each integration's state. Missing your tool? [Open an issue](https://github.com/pitimon/TokenTracker/issues/new) — a new provider is usually one parser file away.

Rate-limit providers are auto-detected where possible. For Z.AI / GLM Coding Plan quota windows, export `ZAI_API_KEY` or `ZHIPU_API_KEY` before starting the local server. If Claude-compatible tooling is pointed at Z.AI with `ANTHROPIC_BASE_URL=https://api.z.ai/...` and `ANTHROPIC_AUTH_TOKEN`, TokenTracker can reuse that auth token for the local limits endpoint.

---

## 🧩 How it works

```
AI CLI tools  →  hooks / passive readers  →  local queue file  →  dashboard
   (logs)         (token counts only)        (30-min buckets)     (your browser)
```

1. Your AI tools write logs during normal use.
2. Lightweight hooks (or passive file readers) pick up token counts locally — never prompt or response content. Some tools keep their logs in SQLite (Cursor, Kiro, Zed and friends); TokenTracker only ever *reads* those.
3. Counts are aggregated into 30-minute UTC buckets and appended to one plain-text file: `~/.tokentracker/tracker/queue.jsonl`.
4. The dashboard reads that file and renders it in your browser's timezone.

No account, no upload of your usage, and no server to sign in to.

---

## 🔐 Privacy

| Protection | What it means |
|---|---|
| **No content** | Only token counts and timestamps. Never prompts, responses, or files. |
| **Your usage stays local** | Every count TokenTracker collects is written to one file on your disk and read back by a server on your own machine. There is no endpoint it uploads usage to. |
| **Auditable in one command** | You don't have to take our word for it — the store is an append-only text file you can open yourself: `cat ~/.tokentracker/tracker/queue.jsonl`. It's numbers and timestamps. |
| **No telemetry** | No analytics, no crash reporting, no phone-home, no account. |

**Outbound calls, on your behalf only.** TokenTracker is local-first, not network-free. It talks to the internet in exactly these cases, and none of them carry your usage data:

| When | Where | Why |
|---|---|---|
| Pricing refresh (daily) | `raw.githubusercontent.com` | Downloads the public [LiteLLM](https://github.com/BerriAI/litellm) price list. Anonymous — no credentials, nothing sent. Works offline from a bundled snapshot. |
| Quota chips + Limits page | `api.anthropic.com`, `chatgpt.com`, `cursor.com`, `cloudcode-pa.googleapis.com`, `api.kimi.com`, `api.z.ai`, `api.github.com` | Asks *your* provider about *your* plan limits, using credentials already on your machine. Only for providers you actually use. |
| Token refresh | `auth.openai.com`, `oauth2.googleapis.com`, `auth.kimi.com` | Renews those same provider credentials when they expire. |
| Profile avatars | Allowlisted avatar CDNs | Fetched server-side so your browser doesn't contact them directly. |
| IP check page | `ip.net.coffee` | Only if you open that page. |
| `npx` startup | npm registry | How `npx` works — it downloads the package. A global install avoids it. |

---

## 📦 Configuration

Most users never touch this — defaults are sensible.

| Variable | Description | Default |
|---|---|---|
| `TOKENTRACKER_DEBUG` | Debug output (`1` to enable) | — |
| `TOKENTRACKER_HTTP_TIMEOUT_MS` | HTTP timeout (ms) | `20000` |
| `CODEX_HOME` | Override Codex CLI directory | `~/.codex` |
| `GEMINI_HOME` | Override Gemini CLI directory | `~/.gemini` |
| `TOKENTRACKER_GROK_HOME` | Override Grok Build directory | `~/.grok` |

To force a dashboard port, use your shell's environment-variable syntax (otherwise TokenTracker auto-picks the next free port from `7680`):

```bash
PORT=7700 npx --yes @ipv9/tokentracker-cli serve
```

```powershell
$env:PORT = 7700
npx --yes @ipv9/tokentracker-cli serve
```

Browser auto-open is opt-in: `tokentracker serve --open`. Background services and headless shells should use the default no-open behavior and open the printed URL manually.

---

## ⏰ Always-on, without a terminal (macOS)

If you want the dashboard up all the time but don't want the desktop app, the repo ships a launchd installer. It registers two LaunchAgents — the dashboard on port `7680`, and a periodic background sync — both pinned to a specific published version:

```bash
git clone https://github.com/pitimon/TokenTracker.git
cd TokenTracker
./scripts/install-local-service.sh          # remove later with ./scripts/uninstall-local-service.sh
```

macOS only; it uses `launchd` directly. On Linux, the same effect is a small systemd user unit running `tokentracker serve --sync --no-open`.

---

## 🧰 Development

```bash
git clone https://github.com/pitimon/TokenTracker.git
cd TokenTracker && npm install
npm run dashboard:build && node bin/tracker.js
npm run ci:local     # the full gate: build + tests + validators
```

Setup details, the test layout, and how to add a new tool integration are in [CONTRIBUTING.md](CONTRIBUTING.md). Source-backed engineering documentation starts at [`openwiki/README.md`](openwiki/README.md).

---

## 🔧 Troubleshooting

<details>
<summary><b>A tool isn't being detected</b></summary>

<br/>

```bash
tokentracker status      # see each integration's state
tokentracker doctor      # deeper health check
```

If a tool you use shows as not configured, run `tokentracker init` — it re-runs detection and installs anything missing. Still missing? [Open an issue](https://github.com/pitimon/TokenTracker/issues/new) with the `doctor` output.

</details>

<details>
<summary><b>Port 7680 is already in use</b></summary>

<br/>

The server auto-picks the next free port (`7681`, `7682`, …) and logs it on startup. To force one, use the Bash or PowerShell command in [Configuration](#-configuration). To see what's holding port `7680`:

```bash
lsof -i :7680
```

```powershell
Get-NetTCPConnection -LocalPort 7680 -ErrorAction SilentlyContinue
```

</details>

<details>
<summary><b>Linux: <code>spawn xdg-open ENOENT</code></b></summary>

<br/>

TokenTracker does not require `xdg-open` to run. The dashboard URL is printed on startup, so you can open it manually from another browser.

If you explicitly pass `--open` on a desktop Linux machine and see `spawn xdg-open ENOENT`, install the desktop opener package:

```bash
sudo apt update
sudo apt install -y xdg-utils
```

On servers, SSH sessions, CI, systemd units, and other headless environments, leave browser opening disabled and run:

```bash
tokentracker serve --sync --no-open
tokentracker doctor
```

</details>

<details>
<summary><b>Windows / PowerShell: start TokenTracker with npx</b></summary>

<br/>

For an interactive PowerShell session:

```powershell
npx --yes @ipv9/tokentracker-cli serve --open
```

For headless PowerShell, CI, or a background process, keep browser opening disabled:

```powershell
npx --yes @ipv9/tokentracker-cli serve --no-sync --no-open
```

TokenTracker never stops another process to free a port. When no port is specified it tries the next one up (`7681`, `7682`, …); an explicit `--port` or `$env:PORT` that is already in use fails startup and prints an alternative command to run.

</details>

<details>
<summary><b>Remove everything</b></summary>

<br/>

```bash
tokentracker uninstall
```

Removes every hook TokenTracker installed across all detected tools, plus local config and data. Safe to re-run.

One thing it does **not** touch: if you set up the always-on macOS service yourself with `scripts/install-local-service.sh`, that LaunchAgent is installed outside the CLI and keeps restarting the dashboard. Remove it first:

```bash
./scripts/uninstall-local-service.sh
```

(The CLI never installs a LaunchAgent, so if you have only ever run `npx`/`tokentracker`, there is nothing extra to clean up.)

</details>

---

## 🤝 Contributing & Support

- **Bugs / features** — [open an issue](https://github.com/pitimon/TokenTracker/issues/new)
- **Security** — see [SECURITY.md](SECURITY.md) (please don't file public issues for security reports)
- **Pull requests** — see [CONTRIBUTING.md](CONTRIBUTING.md)

## 🙏 Credits

The Clawd character design belongs to Anthropic. This is a community project with no official affiliation with Anthropic.

## License

[MIT](LICENSE)

---

<div align="center">

**Token Tracker** — quantify your AI output.

<a href="https://www.npmjs.com/package/@ipv9/tokentracker-cli">npm</a> · <a href="https://github.com/pitimon/TokenTracker">GitHub</a>

</div>
