<div align="center">

# Token Tracker

### Know exactly what you're spending on AI — across every CLI

Auto-collect token usage from **22 AI coding tools**, aggregate it locally, and read real cost trends in one dashboard. No account or API key required to start — just one command.

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

## ✨ What you get

- 🏠 **100% local.** Token counts and timestamps only — never prompts, responses, or file contents. No account, no required API keys, no phone-home.
- 🚀 **Zero config.** Hooks auto-install on the first run. Zero to dashboard in about 30 seconds.
- 🔌 **22 tools out of the box.** Claude Code, Codex, Cursor, Gemini, Copilot, Antigravity, OpenCode, Kiro, Zed, Goose, and more — auto-detected.
- 💰 **Accurate cost.** 2,200+ models priced from [LiteLLM](https://github.com/BerriAI/litellm) (refreshed daily) with a bundled offline snapshot, so USD totals are right even without a network. Cross-provider records are de-duplicated so your numbers match each provider's own billing.
- 📈 **Rate-limit tracking.** Live quota windows with reset countdowns for Claude, Codex, Cursor, Gemini, Kimi, Z.AI, Kiro, Copilot, and Antigravity.
- 🧩 **Optional extras.** A worldwide leaderboard (opt-in) and a Skills tab that syncs 250+ public skills across your tools.

---

## 📊 The dashboard

A calm, single-screen readout — a hero total paired with a usage-trend chart, a provider breakdown stacked above a per-provider context breakdown, and a GitHub-style activity heatmap.

| Dark | Light |
|---|---|
| <img src="https://raw.githubusercontent.com/pitimon/TokenTracker/main/docs/screenshots/dashboard-dark.png" alt="Dashboard — dark" /> | <img src="https://raw.githubusercontent.com/pitimon/TokenTracker/main/docs/screenshots/dashboard-light.png" alt="Dashboard — light" /> |

**On one screen:**
- **Total tokens + cost** for the selected window (24h / day / 7d / 30d / total / custom), with a browser-timezone "Updated" stamp.
- **Usage Trend** — token volume over time, right beside the total.
- **Provider breakdown** — every tool's share and top models, with a click-to-expand per-model drill-down.
- **Context breakdown** — where Claude's and Codex's tokens actually go (input / output / cache / reasoning), shown side by side.
- **Activity heatmap** — daily usage at a glance.
- **Project & daily tables** — per-project totals and a day-by-day breakdown with cost and $/MTok.

Auto-refresh runs only while the tab is visible (`Off` / `30s` / `60s` / `120s`, default `30s`).

---

## 🔌 Supported tools

Auto-detected on first run — no manual plugin or hook wiring:

> **Claude Code · Codex CLI · Cursor · Gemini CLI · GitHub Copilot · Antigravity · Kiro · OpenCode · OpenClaw · Every Code · Hermes · Kimi Code · CodeBuddy · Grok Build · oh-my-pi · pi · Craft Agents · Kilo CLI · Kilo Code · Roo Code · Zed Agent · Goose**

Each tool is connected one of three ways, all automatic: a **SessionEnd/notify hook** (Claude Code, Codex, Gemini, Every Code, CodeBuddy, Grok Build), a **bundled plugin** linked via the tool's own CLI (OpenCode, OpenClaw), or a **passive reader** that only reads files the tool already writes — SQLite, JSONL, OTEL exports (Cursor, Kiro, Copilot, Zed, Goose, and the rest).

Run `tokentracker status` to see each integration's state. Missing your tool? [Open an issue](https://github.com/pitimon/TokenTracker/issues/new) — a new provider is usually one parser file away.

Rate-limit providers are auto-detected where possible. For Z.AI / GLM Coding Plan quota windows, export `ZAI_API_KEY` or `ZHIPU_API_KEY` before starting the local server. If Claude-compatible tooling is pointed at Z.AI with `ANTHROPIC_BASE_URL=https://api.z.ai/...` and `ANTHROPIC_AUTH_TOKEN`, TokenTracker can reuse that auth token for the local limits endpoint.

---

## 🏗️ How it works

```
AI CLI tools  →  hooks / passive readers  →  local SQLite  →  dashboard
   (logs)         (token counts only)       (30-min buckets)   (your browser)
```

1. Your AI tools write logs during normal use.
2. Lightweight hooks (or passive file readers) pick up token counts locally — never prompt or response content.
3. Counts are aggregated into 30-minute UTC buckets in a local SQLite snapshot.
4. The dashboard reads that snapshot and renders it in your browser's timezone.

The leaderboard is the only feature that ever leaves your machine, and only when you opt in.

---

## 🛡️ Privacy

| Protection | What it means |
|---|---|
| **No content** | Only token counts and timestamps. Never prompts, responses, or files. |
| **Local by default** | All data stays on your machine. The leaderboard is fully opt-in. |
| **Auditable** | Open source — read [`src/lib/rollout.js`](src/lib/rollout.js); it's just numbers and timestamps. |
| **No telemetry** | No analytics, no crash reporting, no phone-home. |

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

To force a dashboard port: `PORT=7700 tokentracker serve` (otherwise it auto-picks the next free port from `7680`).

Browser auto-open is opt-in: `tokentracker serve --open`. Background services and headless shells should use the default no-open behavior and open the printed URL manually.

---

## 🛠️ Development

```bash
git clone https://github.com/pitimon/TokenTracker.git
cd TokenTracker
npm install

# build the dashboard, then run the CLI
npm run dashboard:build
node bin/tracker.js

npm test          # root tests
npm run ci:local  # full local gate (build + tests + validators)
```

---

## 🔧 Troubleshooting

<details>
<summary><b>A tool isn't being detected</b></summary>

<br/>

```bash
tokentracker status      # see each integration's state
tokentracker doctor      # deeper health check
```

If a tool you use shows as not configured, run `tokentracker activate-if-needed` to re-run detection. Still missing? [Open an issue](https://github.com/pitimon/TokenTracker/issues/new) with the `doctor` output.

</details>

<details>
<summary><b>Port 7680 is already in use</b></summary>

<br/>

The server auto-picks the next free port (`7681`, `7682`, …) and logs it on startup. To force one: `PORT=7700 tokentracker serve`. To see what's holding the port: `lsof -i :7680`.

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
<summary><b>Windows / PowerShell service starts but no browser opens</b></summary>

<br/>

This is expected for background tasks. Scheduled tasks and the Windows tray app run:

```powershell
tokentracker serve --no-sync --no-open
```

Open the printed local URL in your browser or use the tray app WebView. For an interactive PowerShell session, use `tokentracker serve --open`; TokenTracker uses the Windows shell opener instead of `xdg-open`.

</details>

<details>
<summary><b>Remove everything</b></summary>

<br/>

```bash
tokentracker uninstall
```

Removes every hook TokenTracker installed across all detected tools, plus local config and data. Safe to re-run.

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
