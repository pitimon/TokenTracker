"use strict";

// #141: the two-minute quota cache had no in-flight state, so "cache is cold"
// was a race, not a lock. Two tabs, a route mount and a scheduled revalidation
// arriving together each launched a full sweep of every configured provider's
// private endpoint. These tests pin the coalescing at the level a user's
// concurrent requests actually hit — `getUsageLimits` itself — while
// single-flight.test.js covers the failure branches this surface cannot reach.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const MODULE_PATH = require.resolve("../src/lib/usage-limits");

// The module memoises in module scope — both the completed cache and the
// in-flight slot. Every scenario needs its own instance or it inherits the
// previous one's state.
function freshModule() {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

// Enough credentials that at least one provider gets past its gate and really
// calls out. Without this the sweep short-circuits, the invocation counter stays
// at zero, and "both runs made the same number of calls" would pass while
// proving nothing.
function credentialedHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-coalesce-"));
  const write = (rel, body) => {
    const full = path.join(home, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof body === "string" ? body : JSON.stringify(body));
  };
  write(".codex/auth.json", {
    tokens: { access_token: "test-token", refresh_token: "test-refresh", account_id: "acct" },
    last_refresh: new Date().toISOString(),
  });
  write(".gemini/oauth_creds.json", {
    access_token: "test-token",
    refresh_token: "test-refresh",
    expiry_date: Date.now() + 3_600_000,
  });
  return home;
}

// One counter across every injected boundary the sweep can reach, so "did a
// second sweep run?" is answered by arithmetic rather than by timing.
function createProbe() {
  const home = credentialedHome();
  const counts = { total: 0 };
  const bump = () => {
    counts.total += 1;
  };
  const options = {
    home,
    env: { HOME: home, ZAI_API_KEY: "test-key" },
    platform: "linux",
    securityRunner: () => {
      bump();
      throw new Error("no keychain on this platform");
    },
    fetchImpl: async () => {
      bump();
      throw new Error("network unavailable in test");
    },
    commandRunner: async () => {
      bump();
      return { code: 127, stdout: "", stderr: "not found" };
    },
    requestFn: async () => {
      bump();
      throw new Error("antigravity unreachable");
    },
    providerTimeoutMs: 3000,
  };
  return { counts, options };
}

test("concurrent cold callers share one provider fan-out", async () => {
  const { getUsageLimits } = freshModule();
  const { counts, options } = createProbe();

  // Started in the same tick, before any of them can populate the cache.
  const [a, b, c] = await Promise.all([
    getUsageLimits(options),
    getUsageLimits(options),
    getUsageLimits(options),
  ]);
  const concurrent = counts.total;

  assert.ok(concurrent > 0, "no provider boundary was touched — the counter cannot discriminate");
  assert.equal(a, b, "second caller got a different object — it ran its own sweep");
  assert.equal(a, c, "third caller got a different object — it ran its own sweep");

  // What one sweep costs, measured on the same fixture rather than assumed.
  const { getUsageLimits: getAgain } = freshModule();
  const solo = createProbe();
  await getAgain(solo.options);

  assert.equal(
    concurrent,
    solo.counts.total,
    `three concurrent callers cost ${concurrent} provider calls; one caller costs ${solo.counts.total}`,
  );
});

test("a cache reset mid-flight joins the live fan-out instead of starting a second", async () => {
  const { getUsageLimits, resetUsageLimitsCache } = freshModule();
  const { counts, options } = createProbe();

  const inFlight = getUsageLimits(options);
  // Exactly what a forced refresh does before calling in: clear the completed
  // cache. The sweep already running must absorb it, not be duplicated by it.
  resetUsageLimitsCache();
  const forced = getUsageLimits(options);

  const [first, second] = await Promise.all([inFlight, forced]);
  const both = counts.total;

  assert.equal(first, second, "the forced caller ran a parallel sweep");

  const { getUsageLimits: getAgain } = freshModule();
  const solo = createProbe();
  await getAgain(solo.options);
  assert.equal(both, solo.counts.total, "the reset launched a second fan-out");
});

test("a completed result is reused for the TTL without touching any provider", async () => {
  const { getUsageLimits } = freshModule();
  const { counts, options } = createProbe();

  const first = await getUsageLimits(options);
  const afterFirst = counts.total;
  const second = await getUsageLimits(options);

  assert.equal(second, first, "the cached result was not reused");
  assert.equal(counts.total, afterFirst, "a cached read still called a provider");
});

test("a force against a completed cache does start a new fan-out", async () => {
  const { getUsageLimits, resetUsageLimitsCache } = freshModule();
  const { counts, options } = createProbe();

  const first = await getUsageLimits(options);
  const afterFirst = counts.total;

  // Nothing is in flight now, so this is the case that MUST re-fetch —
  // coalescing that swallowed it would turn every forced refresh into a no-op.
  resetUsageLimitsCache();
  const second = await getUsageLimits(options);

  assert.notEqual(second, first, "the force returned the previous result object");
  assert.ok(
    counts.total > afterFirst,
    "the force made no provider calls — the cache was served through it",
  );
});
