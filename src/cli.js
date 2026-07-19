const { cmdInit } = require("./commands/init");
const { cmdSync } = require("./commands/sync");
const { cmdStatus } = require("./commands/status");
const { cmdDiagnostics } = require("./commands/diagnostics");
const { cmdDoctor } = require("./commands/doctor");
const { cmdUninstall } = require("./commands/uninstall");
const { cmdServe } = require("./commands/serve");
const { cmdWrapped } = require("./commands/wrapped");

async function run(argv) {
  const [command, ...rest] = argv;

  // No args → launch dashboard
  if (!command) {
    await cmdServe(["--sync"]);
    return;
  }

  if (command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  switch (command) {
    case "serve":
      await cmdServe(rest);
      return;
    case "init":
      await cmdInit(rest);
      return;
    case "sync":
      await cmdSync(rest);
      return;
    case "status":
      await cmdStatus(rest);
      return;
    case "diagnostics":
      await cmdDiagnostics(rest);
      return;
    case "doctor":
      await cmdDoctor(rest);
      return;
    case "uninstall":
      await cmdUninstall(rest);
      return;
    case "wrapped":
      await cmdWrapped(rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp() {
  // Keep this short; npx users want quick guidance.
  process.stdout.write(
    [
      "tokentracker",
      "",
      "Usage:",
      "  npx --yes @ipv9/tokentracker-cli                                         Start local dashboard",
      "  npx --yes @ipv9/tokentracker-cli [--debug] serve [--port 7680] [--open] [--no-open] [--sync]",
      "  npx --yes @ipv9/tokentracker-cli [--debug] init [--yes] [--dry-run] [--no-open] [--link-code <code>]",
      "  npx --yes @ipv9/tokentracker-cli [--debug] sync [--auto] [--drain] [--from-openclaw]",
      "  npx --yes @ipv9/tokentracker-cli [--debug] status [--probe-keychain] [--probe-keychain-details]",
      "  npx --yes @ipv9/tokentracker-cli [--debug] diagnostics [--out diagnostics.json]",
      "  npx --yes @ipv9/tokentracker-cli [--debug] doctor [--json] [--out doctor.json] [--base-url <url>]",
      "  npx --yes @ipv9/tokentracker-cli [--debug] uninstall [--purge]",
      "  npx --yes @ipv9/tokentracker-cli [--debug] wrapped [--year 2026] [--json]",
      "",
      "Notes:",
      "  - init: consent first, then local setup. This build is local-only.",
      "  - --yes skips the consent menu (non-interactive safe).",
      "  - --dry-run previews changes without writing files.",
      "  - Every Code notify installs when ~/.code/config.toml exists.",
      "  - OpenClaw hook auto-links when OpenClaw is installed (requires gateway restart).",
      "  - serve prints the local dashboard URL; pass --open to ask the OS to open a browser.",
      "  - sync parses ~/.codex/sessions/**/rollout-*.jsonl and ~/.code/sessions/**/rollout-*.jsonl into the local queue. Nothing is uploaded.",
      "  - --from-openclaw marks sync runs triggered by OpenClaw hooks.",
      "  - --debug shows original backend errors.",
      "",
    ].join("\n"),
  );
}

module.exports = { run };
