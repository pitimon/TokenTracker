"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("runtime contract pins the patched undici line and its true Node floor", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.dependencies.undici, "^7.29.0");
  assert.equal(pkg.engines.node, ">=20.18.1");
  assert.equal(lock.packages[""].dependencies.undici, "^7.29.0");
  assert.equal(lock.packages[""].engines.node, ">=20.18.1");
  const installed = lock.packages["node_modules/undici"];
  assert.equal(installed.version, "7.29.0");
  assert.equal(installed.engines.node, ">=20.18.1");
  assert.match(read("CLAUDE.md"), /Node ≥20\.18\.1/);
  assert.match(read("CONTRIBUTING.md"), /Node 20\.18\.1\+/);
});

test("CI continuously runs the root suite at the exact minimum Node version", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /node20-contract:/);
  assert.match(workflow, /node-version:\s*20\.18\.1/);
  assert.match(workflow, /run:\s*npm test/);
});

test("parser conformance fixture does not require node:sqlite at module load", () => {
  const fixture = read("test/fixtures/parser-conformance/hermes.cjs");
  assert.doesNotMatch(fixture, /require\(["']node:sqlite["']\)/);
  assert.match(fixture, /sqlite3/);
});
