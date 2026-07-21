"use strict";

const { formatSummaryLine, renderBox, underline } = require("./cli-ui");

const DIVIDER = "----------------------------------------------";

function renderLocalReport({ summary, isDryRun }) {
  const header = isDryRun
    ? "Dry run complete. Preview only; no changes were applied."
    : "Local configuration complete.";
  const lines = [header, "", "Integration Status:"];
  for (const item of summary || []) lines.push(formatSummaryLine(item));
  process.stdout.write(`${lines.join("\n")}\n`);
}

function renderAuthTransition({ authUrl, canAutoOpen }) {
  const lines = ["", DIVIDER, "", "Next: Registering device..."];
  if (canAutoOpen) {
    lines.push("Opening your browser to link account...");
    if (authUrl) lines.push(`If it does not open, visit: ${underline(authUrl)}`);
  } else {
    lines.push("Open the link below to sign in.");
    if (authUrl) lines.push(`Visit: ${underline(authUrl)}`);
  }
  lines.push("");
  process.stdout.write(`${lines.join("\n")}\n`);
}

function renderSuccessBox({ configPath, dashboardUrl }) {
  // Local-only: there is no account and no remote dashboard. `dashboardUrl` is
  // null on a clean install now that the cloud default is gone, so fall back to
  // the address `serve` actually listens on — otherwise setup finishes without
  // telling the user where to look.
  const lines = ["You are all set!", "", `Config saved to: ${configPath}`, ""];
  lines.push(`View your stats at: ${dashboardUrl || "http://localhost:7680"}`);
  lines.push("You can close this terminal window.");
  process.stdout.write(`${renderBox(lines)}\n`);
}

module.exports = {
  DIVIDER,
  renderLocalReport,
  renderAuthTransition,
  renderSuccessBox,
};
