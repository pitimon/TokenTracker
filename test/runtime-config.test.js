const assert = require("node:assert/strict");
const { test } = require("node:test");

const { resolveRuntimeConfig } = require("../src/lib/runtime-config");

// Rewritten, not deleted: baseUrl and deviceToken are gone with the cloud, but
// the precedence rule (cli > config > env > default) and the refusal to read
// non-TOKENTRACKER env vars are still real guarantees worth pinning.
test("resolveRuntimeConfig prefers CLI over config over env", () => {
  const result = resolveRuntimeConfig({
    cli: { httpTimeoutMs: 4000 },
    config: { httpTimeoutMs: 3000 },
    env: { TOKENTRACKER_HTTP_TIMEOUT_MS: "2000" },
  });
  assert.equal(result.httpTimeoutMs, 4000);
  assert.equal(result.sources.httpTimeoutMs, "cli");

  const fromConfig = resolveRuntimeConfig({
    config: { httpTimeoutMs: 3000 },
    env: { TOKENTRACKER_HTTP_TIMEOUT_MS: "2000" },
  });
  assert.equal(fromConfig.httpTimeoutMs, 3000);
  assert.equal(fromConfig.sources.httpTimeoutMs, "config");
});

test("resolveRuntimeConfig reads TOKENTRACKER env when cli and config are absent", () => {
  // Without this the env rung is unpinned: deleting it from the pick chain
  // entirely left the other two tests green.
  const result = resolveRuntimeConfig({
    env: { TOKENTRACKER_HTTP_TIMEOUT_MS: "2000" },
  });
  assert.equal(result.httpTimeoutMs, 2000);
  assert.equal(result.sources.httpTimeoutMs, "env");
});

test("resolveRuntimeConfig ignores non-TOKENTRACKER env inputs", () => {
  const result = resolveRuntimeConfig({
    env: { LEGACY_HTTP_TIMEOUT_MS: "9999", HTTP_TIMEOUT_MS: "9999" },
  });
  assert.equal(result.sources.httpTimeoutMs, "default");
});

test("resolveRuntimeConfig normalizes timeout and flags", () => {
  const result = resolveRuntimeConfig({
    env: {
      TOKENTRACKER_HTTP_TIMEOUT_MS: "500",
      TOKENTRACKER_DEBUG: "1",
    },
  });

  assert.equal(result.httpTimeoutMs, 1000);
  assert.equal(result.debug, true);
  // autoRetryNoSpawn is gone: it opted out of a background spawn that no
  // longer exists once cloud upload was removed.
});
