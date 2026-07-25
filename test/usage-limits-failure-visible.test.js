"use strict";

// A quota chip exists so someone notices they are near a limit. A chip that
// silently DISAPPEARS when its fetcher breaks is worse than no chip, because the
// user has been trained to look there and now reads absence as "plenty left".
//
// The rendering rule is in dashboard/src/ui/dashboard/components/limitDisplay.jsx:
//
//     if (!data || !data.configured) return null;      // the chip VANISHES
//     if (data.error) { ...status line... }            // the chip is VISIBLE
//
// So `configured: false` after a genuine fetch failure is the defect. After a
// MISSING CREDENTIAL it is correct — there is nothing to show and nothing broke.
//
// #105 asked whether every fetcher gets this right, and recorded it as unknown:
// "what is untested is whether every fetcher's failure path actually sets
// `error` rather than returning an unconfigured-looking object."
//
// It does. This file is what makes that stay true. usage-limits.js talks to nine
// providers' undocumented private endpoints and any of them can change without
// notice; the failure shows up per-user at runtime and never in CI. This does
// not detect upstream drift — nothing short of live credentials does — but it
// does stop OUR refactors from turning a visible error into a vanished chip.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const MODULE_PATH = require.resolve("../src/lib/usage-limits");

// getUsageLimits memoises for CACHE_TTL_MS, so each scenario needs a fresh
// module instance or the second call returns the first one's answer.
function freshModule() {
  delete require.cache[MODULE_PATH];
  return require("../src/lib/usage-limits");
}

// A home that gets every reachable provider PAST its credential gate, so the
// failure being tested is the network call rather than "not signed in".
function credentialedHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-limits-"));
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
  write(".config/github-copilot/apps.json", {
    "github.com": { oauth_token: "test-token", user: "someone" },
  });
  // Kimi gates on config.toml existing, then reads credentials/kimi-code.json.
  write(".kimi-code/config.toml", "[auth]\n");
  write(".kimi-code/credentials/kimi-code.json", {
    access_token: "test-token",
    refresh_token: "test-refresh",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  return home;
}

// spawnSync's contract: it RETURNS { error, status, stdout }, it does not throw.
// A commandRunner that throws is not a valid stand-in — an early version of this
// probe did that and produced a crash that looked like a product defect.
const missingBinary = () => ({
  error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
  status: null,
  stdout: "",
  stderr: "",
});

const FAILURES = {
  "HTTP 500": async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    headers: { get: () => null },
    text: async () => "upstream exploded",
    json: async () => ({}),
  }),
  "network unreachable": async () => {
    throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
  },
  "401 expired token": async () => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    headers: { get: () => null },
    text: async () => "unauthorized",
    json: async () => ({}),
  }),
  "a body that is not JSON": async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html" },
    text: async () => "<html>captive portal</html>",
    json: async () => {
      throw new Error("Unexpected token < in JSON at position 0");
    },
  }),
};

async function limitsUnder(fetchImpl, overrides = {}) {
  const { getUsageLimits } = freshModule();
  const home = credentialedHome();
  return getUsageLimits({
    home,
    env: { HOME: home, ZAI_API_KEY: "test-key" },
    platform: "linux",
    securityRunner: () => {
      throw new Error("no keychain on this platform");
    },
    fetchImpl,
    commandRunner: missingBinary,
    requestFn: async () => {
      throw new Error("antigravity unreachable");
    },
    providerTimeoutMs: 3000,
    ...overrides,
  });
}

// Reachable here means: the fixture above gets past the credential gate, so a
// failure is genuinely a failed FETCH. Cursor is absent because its gate needs a
// real Cursor install plus a SQLite state DB holding a JWT; kiro and antigravity
// gate on a binary and a running process, and returning `configured: false` when
// neither exists is correct, not a vanished chip.
const REACHABLE = ["codex", "zai", "gemini", "copilot"];

for (const [label, fetchImpl] of Object.entries(FAILURES)) {
  test(`${label}: every reachable provider stays VISIBLE with a labelled error`, async () => {
    const limits = await limitsUnder(fetchImpl);
    for (const provider of REACHABLE) {
      const entry = limits?.[provider];
      assert.ok(entry, `${provider}: no entry at all`);
      assert.equal(
        entry.configured,
        true,
        `${provider} went to configured:false after a fetch failure — the chip vanishes and` +
          ` the user reads that as "plenty left". Entry: ${JSON.stringify(entry)}`,
      );
      // Visible has two forms, and the chip renders both in the same subtle
      // line: `error` for "this broke", `notice` for "nothing to report for
      // this sign-in". What must never happen is neither — that is the state
      // that renders nothing at all.
      const visible =
        (typeof entry.error === "string" && entry.error.trim()) ||
        (typeof entry.notice === "string" && entry.notice.trim());
      assert.ok(
        visible,
        `${provider}: configured, but neither error nor notice — the chip renders no numbers` +
          ` and no reason, so it disappears. Entry: ${JSON.stringify(entry)}`,
      );
    }
  });
}

test("a 4xx is a NOTICE, not an error — neutral wording, still on screen", async () => {
  // The distinction #52 asked for. A stale or free-tier sign-in is not a fault,
  // so it must not read as one; but the earlier attempt at "not an error" was
  // "no state at all", and the chip vanished.
  const limits = await limitsUnder(FAILURES["401 expired token"]);
  const codex = limits?.codex;
  assert.equal(codex.configured, true);
  assert.equal(codex.error, null, "a 4xx must not be reported as a failure");
  assert.match(codex.notice, /sign in/i, `expected an actionable notice, got ${codex.notice}`);
});

test("a provider that times out is visible, not absent", async () => {
  // withProviderTimeout rejects with "<label> usage request timed out." The
  // question is whether that rejection reaches the user or disappears.
  const neverResolves = () => new Promise(() => {});
  const limits = await limitsUnder(neverResolves, { providerTimeoutMs: 50 });
  for (const provider of REACHABLE) {
    const entry = limits?.[provider];
    assert.equal(entry?.configured, true, `${provider} vanished on timeout`);
    assert.match(entry.error, /timed out|failed|error/i, `${provider}: ${entry.error}`);
  }
});

test("a MISSING credential still hides the chip, which is the correct behaviour", async () => {
  // The complement, and the reason this cannot simply be "always configured:
  // true". An empty home means the user never signed in to anything: there is no
  // quota to report and nothing has broken, so a status line would be noise.
  const { getUsageLimits } = freshModule();
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-limits-empty-"));
  const limits = await getUsageLimits({
    home: emptyHome,
    env: { HOME: emptyHome },
    platform: "linux",
    securityRunner: () => {
      throw new Error("no keychain");
    },
    fetchImpl: async () => {
      throw new Error("should not be called — there are no credentials to use");
    },
    commandRunner: missingBinary,
    requestFn: async () => {
      throw new Error("unreachable");
    },
    providerTimeoutMs: 1000,
  });
  for (const provider of [...REACHABLE, "claude", "cursor", "kiro", "antigravity"]) {
    const entry = limits?.[provider];
    if (!entry) continue;
    assert.equal(
      entry.configured,
      false,
      `${provider}: an unconfigured provider must not claim to be configured — that would put a` +
        ` permanent error line under a tool the user does not even use. Entry: ${JSON.stringify(entry)}`,
    );
  }
});

test("the chip's own rule is what these assertions are written against", () => {
  // Pinning the coupling. If limitDisplay.jsx ever stops treating
  // `!configured` as "render nothing", every assertion above is testing the
  // wrong property and would keep passing while the UI regressed.
  const chip = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "src", "ui", "dashboard", "components", "limitDisplay.jsx"),
    "utf8",
  );
  assert.match(
    chip,
    /if\s*\(!data\s*\|\|\s*!data\.configured\)\s*return null;/,
    "limitDisplay.jsx no longer hides on !configured — re-read this test file's premise",
  );
  assert.match(
    chip,
    /if\s*\(data\.error\)\s*\{/,
    "limitDisplay.jsx no longer renders a status line on data.error",
  );
});
