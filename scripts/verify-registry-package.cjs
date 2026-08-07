#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function verifyInstalledPackage(packageDir, expectedVersion) {
  const packageJsonPath = path.join(packageDir, "package.json");
  const binPath = path.join(packageDir, "bin", "tracker.js");
  const indexPath = path.join(packageDir, "dashboard", "dist", "index.html");
  const assetsDir = path.join(packageDir, "dashboard", "dist", "assets");
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (pkg.version !== expectedVersion) {
    throw new Error(`registry package version ${pkg.version} does not match ${expectedVersion}`);
  }
  for (const required of [binPath, indexPath]) {
    if (!fs.statSync(required).isFile()) throw new Error(`missing required package file: ${path.relative(packageDir, required)}`);
  }
  const assets = fs.readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(assetsDir, name));
  if (assets.length === 0) throw new Error("published package has no dashboard JavaScript assets");
  const targetPresent = assets.some((file) => fs.readFileSync(file, "utf8").includes(expectedVersion));
  if (!targetPresent) throw new Error(`dashboard assets do not contain target version ${expectedVersion}`);
  return { version: pkg.version, assetCount: assets.length, binPath };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function installWithRetry(packageName, version, prefix, attempts = 5) {
  let lastStatus = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    fs.rmSync(prefix, { recursive: true, force: true });
    fs.mkdirSync(prefix, { recursive: true });
    const result = spawnSync(
      "npm",
      ["install", "--prefix", prefix, "--ignore-scripts", `${packageName}@${version}`],
      { encoding: "utf8" }
    );
    lastStatus = result.status;
    if (result.status === 0) return attempt;
    if (attempt < attempts) await sleep(attempt * 2000);
  }
  throw new Error(`registry install failed after ${attempts} attempts (status ${lastStatus})`);
}

async function main(argv) {
  const version = argv[0];
  const packageName = argv[1] || "@ipv9/tokentracker-cli";
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
    throw new Error("usage: verify-registry-package.cjs <version> [package-name]");
  }
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-registry-smoke-"));
  try {
    const installAttempt = await installWithRetry(packageName, version, prefix);
    const packageDir = path.join(prefix, "node_modules", ...packageName.split("/"));
    const receipt = verifyInstalledPackage(packageDir, version);
    const help = spawnSync(process.execPath, [receipt.binPath, "--help"], { encoding: "utf8" });
    if (help.status !== 0 || !help.stdout.includes("Usage:")) {
      throw new Error(`published CLI help smoke failed (status ${help.status})`);
    }
    process.stdout.write(`${JSON.stringify({
      package: packageName,
      version,
      dashboardAssets: receipt.assetCount,
      cliHelp: "ok",
      installAttempt,
    })}\n`);
  } finally {
    fs.rmSync(prefix, { recursive: true, force: true });
  }
}

module.exports = { verifyInstalledPackage };

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
