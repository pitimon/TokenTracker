const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.join(__dirname, "..");
const hookFiles = [
  "dashboard/src/hooks/use-usage-data.ts",
  "dashboard/src/hooks/use-usage-model-breakdown.ts",
  "dashboard/src/hooks/use-trend-data.ts",
  "dashboard/src/hooks/use-activity-heatmap.ts",
];

async function readHookSource(relativePath) {
  const absPath = path.join(repoRoot, relativePath);
  return fs.readFile(absPath, "utf8");
}

// Inverted deliberately. These hooks used to refuse to fetch without a cloud
// access token. TokenTracker is local-only now: they read from the CLI's own
// server on localhost, so gating them on a token that can never arrive would
// leave the dashboard permanently empty. Asserting the guard is GONE is what
// protects that, and it is why this file was inverted rather than deleted.
function assertNoTokenGate(source, file) {
  assert.equal(
    /resolvedToken/.test(source),
    false,
    `${file} must not gate local fetches on a cloud access token`,
  );
  assert.equal(
    /auth-token/.test(source),
    false,
    `${file} must not import the removed auth-token helper`,
  );
}

test("hooks fetch local data without requiring an access token", async () => {
  for (const file of hookFiles) {
    const source = await readHookSource(file);
    assertNoTokenGate(source, file);
  }
});
