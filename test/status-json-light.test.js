/**
 * End-to-end test for `tracker status --json` / `--light` / `--diagnostics`.
 *
 * Boots the real CLI in a child process against the real ~/.tokentracker
 * state, then asserts the output shape. Designed to catch regressions where
 * a future refactor of status.js drops/renames a top-level summary key that
 * AI agents or CI scripts depend on.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TRACKER = path.resolve(__dirname, "..", "bin", "tracker.js");

function runStatus(args) {
  const res = spawnSync(process.execPath, [TRACKER, "status", ...args], {
    encoding: "utf-8",
    timeout: 30_000,
  });
  return res;
}

// Inverted, not deleted: base_url/device_token_set/queue.pending_bytes used
// to be required top-level summary fields. Cloud upload/pairing is gone, so
// this now pins that they are absent while local fields remain.
test("status --json emits a JSON object with required summary fields", () => {
  const res = runStatus(["--json"]);
  assert.equal(res.status, 0, `exit code: ${res.status} stderr=${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  for (const key of ["generated_at", "queue", "hooks", "providers", "copilot", "subscriptions"]) {
    assert.ok(key in parsed, `missing top-level key: ${key}`);
  }
  assert.ok(!("base_url" in parsed), "base_url must not be reported (cloud removed)");
  assert.ok(!("device_token_set" in parsed), "device_token_set must not be reported (cloud removed)");
  assert.ok("size_bytes" in parsed.queue);
  assert.ok(!("pending_bytes" in parsed.queue), "pending_bytes must not be reported (upload removed)");
  assert.ok("claude" in parsed.hooks);
});

test("status --light renders an ASCII table with key columns", () => {
  const res = runStatus(["--light"]);
  assert.equal(res.status, 0, `exit code: ${res.status} stderr=${res.stderr}`);
  // table separators show up at top, between header/body, and at bottom
  const sepCount = (res.stdout.match(/^\+-+\+-+\+$/gm) || []).length;
  assert.ok(sepCount >= 3, `expected ≥3 separator lines, got ${sepCount}`);
  // No ANSI / emoji / spinner artifacts
  assert.ok(!/\[/.test(res.stdout), "ANSI escapes leaked");
  assert.match(res.stdout, /^\| Key /m);
  assert.match(res.stdout, /^\| Queue size/m);
  assert.match(res.stdout, /^\| Hook · claude/m);
  assert.ok(!res.stdout.includes("Base URL"), "Base URL row must be removed");
  assert.ok(!res.stdout.includes("Device token"), "Device token row must be removed");
});

test("status --diagnostics still emits raw diagnostics JSON (back-compat)", () => {
  const res = runStatus(["--diagnostics"]);
  assert.equal(res.status, 0, `exit code: ${res.status} stderr=${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  // diagnostics has a different shape: `ok`, `version`, `env`, `paths`
  assert.ok("env" in parsed && "paths" in parsed, "diagnostics shape changed");
  assert.ok(!("hooks" in parsed), "summary keys must not leak into diagnostics");
});

test("status default (no flag) still prints the human-readable list", () => {
  const res = runStatus([]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /^Status:/);
  assert.match(res.stdout, /^- Queue: \d+ bytes$/m);
});

test("status --bogus rejects unknown flag", () => {
  const res = runStatus(["--bogus"]);
  assert.notEqual(res.status, 0, "unknown flag must be rejected");
  assert.match(res.stderr + res.stdout, /Unknown option: --bogus/);
});

test("status --json --no-spinner is accepted (no-spinner is a no-op for status)", () => {
  const res = runStatus(["--json", "--no-spinner"]);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok("queue" in parsed);
});
