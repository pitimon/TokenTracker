"use strict";

// The sanitizer in scripts/capture-limits-fixtures.cjs is about to be pointed at
// live credentials, and its output is about to enter a public repository. So it
// gets tested against a payload deliberately stuffed with every shape of
// identifier BEFORE it is pointed at anything real.
//
// The test is written from the attacker's side: for each thing that must not
// survive, assert it does not appear anywhere in the serialised output. A
// field-by-field check would pass while an identifier survived one level deeper
// than it looked.
//
// Every hostile value below is ASSEMBLED AT RUNTIME rather than written as a
// literal. The repo's own secret scanner refused this file when the JWT was
// spelled out — correctly, since it cannot tell a synthetic sample from a real
// leak. Assembling them keeps the guardrail useful for everyone else.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const SCRIPT = path.join(__dirname, "..", "scripts", "capture-limits-fixtures.cjs");

// The script is a command with no exports. Rather than reshape a tool to suit
// its test, load its pure half into a sandbox module. If sanitize() is renamed
// this fails loudly instead of quietly testing nothing.
function loadSanitizer() {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /function sanitize\(/, "sanitize() is gone — this test is stale");
  const marker = source.indexOf("// Capture\n");
  assert.ok(marker > 0, "the Capture section marker moved — this test is stale");
  const pure = source.slice(0, source.lastIndexOf("// ---", marker));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-sanitizer-"));
  const stub = path.join(dir, "s.cjs");
  fs.writeFileSync(
    stub,
    pure.replace('require("../src/lib/usage-limits")', "{}") +
      "\nmodule.exports = { sanitize };\n",
  );
  return require(stub);
}

const { sanitize } = loadSanitizer();

const b64 = (text) => Buffer.from(text).toString("base64").replace(/=+$/, "");
const FAKE_JWT = [b64('{"alg":"HS256"}'), b64('{"sub":"1234"}'), "c2lnbmF0dXJl"].join(".");
const FAKE_OAUTH = ["sk", "ant", "oat01", "AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH"].join("-");
const FAKE_API_KEY = ["sk", "live", "DEADBEEFDEADBEEFDEADBEEF"].join("-");
const FAKE_UUID = "8f14e45f-ceea-467a-9e2c-1a3b4c5d6e7f";
const FAKE_EMAIL = ["someone", "example.com"].join("@");

const HOSTILE = {
  // Must not survive.
  access_token: FAKE_OAUTH,
  id_token: FAKE_JWT,
  account_id: FAKE_UUID,
  email: FAKE_EMAIL,
  user: { login: "a-real-person", display_name: "A Real Person" },
  organization: "acme-corporation",
  subscription_id: 998877665544,
  session_cookie: "WorkosCursorSessionToken=abc",
  note: "This account belongs to a named individual at a named company and should never be committed.",

  // Must survive, or the fixture proves nothing.
  plan_type: "pro",
  five_hour: { used: 4213, limit: 20000, percent_used: 21, resets_at: "2026-05-14T09:00:00Z" },
  seven_day: { used: 120345, limit: 500000, remaining: 379655 },
  windows: [
    { window: "5h", used: 10, limit: 100 },
    { window: "7d", used: 20, limit: 200 },
    { window: "30d", used: 30, limit: 300 },
  ],
  enabled: true,
  overage_allowed: false,
  quota_reset_seconds: 3600,
};

const serialised = JSON.stringify(sanitize(HOSTILE));

test("no credential, id or personal string survives anywhere in the output", () => {
  for (const secret of [
    FAKE_OAUTH,
    FAKE_JWT.slice(0, 20),
    FAKE_UUID,
    FAKE_EMAIL,
    "a-real-person",
    "A Real Person",
    "acme-corporation",
    "WorkosCursorSessionToken",
    "named individual",
  ]) {
    assert.ok(
      !serialised.includes(secret),
      `${secret.slice(0, 24)} survived sanitisation — it would have been committed`,
    );
  }
});

test("a numeric identifier is not kept just for being a number", () => {
  // The trap a type-based rule falls into: an account id is an integer, and
  // "numbers are safe" would publish it.
  assert.ok(!serialised.includes("998877665544"), "a numeric account id survived");
});

test("the quota shape survives, or the fixture proves nothing", () => {
  const out = sanitize(HOSTILE);
  assert.equal(out.five_hour.used, 4213);
  assert.equal(out.five_hour.limit, 20000);
  assert.equal(out.five_hour.percent_used, 21);
  assert.equal(out.five_hour.resets_at, "2026-05-14T09:00:00Z", "timestamps must be kept");
  assert.equal(out.seven_day.remaining, 379655);
  assert.equal(out.quota_reset_seconds, 3600);
  assert.equal(out.enabled, true);
  assert.equal(out.overage_allowed, false, "false must survive, not become null");
  assert.equal(out.plan_type, "pro", "a short enum-ish label is shape, not identity");
});

test("nesting is preserved so the normalizer can still walk it", () => {
  const out = sanitize(HOSTILE);
  assert.equal(typeof out.five_hour, "object");
  assert.equal(typeof out.user, "object", "an object keeps its shape; only its values are redacted");
  assert.ok(Array.isArray(out.windows));
  assert.equal(out.windows[0].window, "5h");
});

test("arrays are truncated, so a long list is not a long disclosure", () => {
  assert.equal(sanitize(HOSTILE).windows.length, 2, "three elements in, two out");
});

test("an unrecognised key holding a number is bucketed, not published", () => {
  // The default has to be safe: a field nobody has classified yet must not pass
  // through intact just because it is numeric.
  const out = sanitize({ some_future_field: 123456789 });
  assert.notEqual(out.some_future_field, 123456789);
  assert.equal(typeof out.some_future_field, "number", "the shape stays a number");
});

test("null and boolean pass through untouched", () => {
  assert.deepEqual(sanitize({ a: null, b: true, c: false }), { a: null, b: true, c: false });
});

test("a deeply buried secret is still caught", () => {
  // Recursion is the whole risk: a rule applied only at the top level looks
  // correct on a flat fixture and leaks on a real one.
  const out = sanitize({ data: { attributes: { meta: { api_key: FAKE_API_KEY } } } });
  assert.ok(!JSON.stringify(out).includes("DEADBEEF"), "a nested key survived");
});

test("the script writes nothing in --dry-run", () => {
  // The property that matters most before this is pointed at live credentials:
  // a first run can be inspected without producing files. Run against an EMPTY
  // home so it reaches no network and needs no credential.
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-empty-home-"));
  const out = execFileSync(process.execPath, [SCRIPT, "--dry-run"], {
    encoding: "utf8",
    env: { ...process.env, HOME: emptyHome },
    timeout: 60000,
  });
  assert.match(out, /Dry run — nothing written\.|Nothing was captured/);
  assert.deepEqual(
    fs.readdirSync(emptyHome),
    [],
    "a dry run must not create anything, not even in the home it was pointed at",
  );
});

// --- Against the real shapes, from public sources -----------------------------
// These are not invented. Each is quoted from an open-source project that calls
// the same endpoint, found by research and cited in the fixture README. Running
// the sanitizer against them BEFORE pointing it at an account is what caught two
// defects in it:
//
//  - the key regex was snake_case-only, so camelCase `remainingFraction` did not
//    match `remaining` and a real 0.94 quota figure was bucketed to 0;
//  - `tokenType` matched the credential word `token` and was redacted, although
//    it is a category label.

test("Gemini: the GCP project id goes, the tier label and quota stay", () => {
  // Shape from google-gemini/gemini-cli packages/core/src/code_assist/types.ts.
  // cloudaicompanionProject is a GCP project identifier — the clearest PII in
  // any of these payloads.
  const out = sanitize({
    cloudaicompanionProject: "my-company-prod-4471",
    currentTier: { id: "free-tier", name: "Free" },
    buckets: [
      {
        remainingAmount: "940",
        remainingFraction: 0.94,
        resetTime: "2026-07-26T00:00:00Z",
        tokenType: "INPUT",
        modelId: "gemini-2.5-pro",
      },
    ],
  });
  assert.equal(out.cloudaicompanionProject, "<redacted>");
  assert.equal(out.currentTier.id, "free-tier", "the tier id is what the normalizer reads");
  assert.equal(out.buckets[0].remainingFraction, 0.94, "a camelCase quota number must survive");
  assert.equal(out.buckets[0].tokenType, "INPUT", "a category label is not a credential");
  assert.equal(out.buckets[0].modelId, "gemini-2.5-pro");
});

test("Antigravity: accountEmail goes, remainingFraction stays", () => {
  // Shape from steipete/CodexBar docs/antigravity.md — GetUserStatus is
  // documented there as the only source of accountEmail and planName.
  const out = sanitize({
    userStatus: {
      accountEmail: ["real.person", "company.com"].join("@"),
      planName: "Pro",
      cascadeModelConfigData: {
        clientModelConfigs: [
          { quotaInfo: { remainingFraction: 0.42, resetTime: "2026-07-26T00:00:00Z" } },
        ],
      },
    },
  });
  assert.ok(!JSON.stringify(out).includes("real.person"), "an email survived");
  assert.equal(
    out.userStatus.cascadeModelConfigData.clientModelConfigs[0].quotaInfo.remainingFraction,
    0.42,
  );
});

test("Copilot: the quota snapshot survives intact", () => {
  // Shape from the reverse-engineered api.github.com/copilot_internal/user
  // documented in Noisemaker111/openusage-opencode docs/providers/copilot.md.
  const out = sanitize({
    copilot_plan: "pro",
    quota_reset_date: "2026-08-01T00:00:00Z",
    quota_snapshots: {
      premium_interactions: {
        percent_remaining: 80,
        entitlement: 300,
        remaining: 240,
        quota_id: "premium",
      },
    },
  });
  assert.equal(out.quota_snapshots.premium_interactions.entitlement, 300);
  assert.equal(out.quota_snapshots.premium_interactions.percent_remaining, 80);
  assert.equal(out.quota_snapshots.premium_interactions.remaining, 240);
  assert.equal(out.copilot_plan, "pro");
});

test("Kimi and Z.AI: string-typed counters are not mistaken for opaque blobs", () => {
  // Kimi shape from luisleineweber/usagebar plugins/kimi/plugin.js; Z.AI from
  // guyinwonder168/opencode-glm-quota src/index.ts. Both report counts as
  // STRINGS, which a "numbers are data, strings are suspect" rule would destroy.
  const kimi = sanitize({
    usage: { limit: "100", remaining: "74", resetTime: "2026-02-11T17:32:50.757941Z" },
    user: { membership: { level: "LEVEL_INTERMEDIATE" } },
  });
  assert.equal(kimi.usage.limit, "100");
  assert.equal(kimi.usage.remaining, "74");
  // Truncated to the minute — see the timestamp test below.
  assert.equal(kimi.usage.resetTime, "2026-02-11T17:32:00Z");

  const zai = sanitize({
    data: { level: "pro", limits: [{ type: "TOKENS_LIMIT", percentage: 37 }] },
  });
  assert.equal(zai.data.level, "pro");
  assert.equal(zai.data.limits[0].type, "TOKENS_LIMIT");
  assert.equal(zai.data.limits[0].percentage, 37);
});

test("a user object's id and name go; a tier object's do not", () => {
  // The pair that motivated parent-aware classification. `id` and `name` are the
  // two commonest keys in these payloads and mean opposite things depending on
  // what they hang off — keeping both leaks, redacting both throws away the
  // field the normalizer uses.
  assert.equal(sanitize({ currentTier: { id: "free-tier" } }).currentTier.id, "free-tier");
  assert.equal(sanitize({ user: { id: "12345" } }).user.id, "<redacted>");
  assert.equal(sanitize({ user: { name: "A Person" } }).user.name, "<redacted>");
});


test("a reset time keeps its shape but loses its sub-minute fingerprint", () => {
  // Claude's oauth/usage returns microsecond precision — e.g.
  // "2026-04-11T07:00:00.528743+00:00". No field there is an identifier, but a
  // set of those timestamps correlates a fixture back to one account's billing
  // cycle. The research that found the shape said so explicitly: round them
  // before committing.
  //
  // The value still has to parse as a timestamp afterwards, or the fixture stops
  // exercising the normalizer's date handling.
  const out = sanitize({
    five_hour: { utilization: 33.0, resets_at: "2026-04-11T07:00:00.528743+00:00" },
  });
  assert.equal(out.five_hour.resets_at, "2026-04-11T07:00:00Z");
  assert.ok(Number.isFinite(Date.parse(out.five_hour.resets_at)), "must still be a parseable date");
  assert.equal(out.five_hour.utilization, 33, "the headline quota number must survive intact");
});

test("a date with no sub-minute part is left exactly as it is", () => {
  const out = sanitize({ resets_at: "2026-04-17T00:00:00Z", billing_start: "2026-04-02" });
  assert.equal(out.resets_at, "2026-04-17T00:00:00Z");
  assert.equal(out.billing_start, "2026-04-02");
});
