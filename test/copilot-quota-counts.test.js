const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  fetchCopilotLimits,
  normalizeCursorUsageSummary,
} = require("../src/lib/usage-limits");

// A home directory shaped like a real Copilot install, so readCopilotOauthToken
// finds a token without touching the developer's own ~/.config.
function copilotHome(entries = { "github.com": { oauth_token: "gho_test" } }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-copilot-"));
  const dir = path.join(home, ".config", "github-copilot");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "apps.json"), JSON.stringify(entries));
  return home;
}

function respondWith(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

describe("Copilot quota counts", () => {
  it("carries the premium-request counts through, not just the percentage", async () => {
    // The question users actually ask is "how many premium requests do I have
    // left". GitHub answers it; we were dividing it into a percentage and
    // dropping both numbers.
    const home = copilotHome();
    const result = await fetchCopilotLimits({
      home,
      env: { HOME: home },
      fetchImpl: respondWith({
        copilot_plan: "pro",
        quota_reset_date: "2026-08-01",
        quota_snapshots: {
          premium_interactions: { entitlement: 300, remaining: 142 },
          chat: { entitlement: 50, remaining: 50 },
        },
      }),
    });

    assert.equal(result.configured, true);
    assert.equal(result.error, null);
    assert.equal(result.plan_name, "Pro");
    assert.equal(result.primary_window.used, 158);
    assert.equal(result.primary_window.limit, 300);
    // The percentage is unchanged — this is additive, not a replacement.
    assert.ok(Math.abs(result.primary_window.used_percent - (158 / 300) * 100) < 1e-9);
    assert.equal(result.primary_window.reset_at, "2026-08-01T00:00:00.000Z");
    assert.equal(result.secondary_window.used, 0);
    assert.equal(result.secondary_window.limit, 50);
  });

  it("omits the counts when GitHub sends a percentage with no denominator", async () => {
    // percent_remaining alone is enough to draw the bar but names nothing to
    // count against — inventing a denominator would be worse than showing none.
    const home = copilotHome();
    const result = await fetchCopilotLimits({
      home,
      env: { HOME: home },
      fetchImpl: respondWith({
        quota_snapshots: { premium_interactions: { percent_remaining: 40 } },
      }),
    });

    assert.equal(result.primary_window.used_percent, 60);
    assert.equal("used" in result.primary_window, false);
    assert.equal("limit" in result.primary_window, false);
  });

  it("clamps an over-quota plan so the count cannot exceed the allowance", async () => {
    // Copilot keeps billing past the allowance, so `remaining` can go negative.
    // "312/300 used" reads as a bug even when it is the truth; the percentage
    // has always been clamped for the same reason.
    const home = copilotHome();
    const result = await fetchCopilotLimits({
      home,
      env: { HOME: home },
      fetchImpl: respondWith({
        quota_snapshots: { premium_interactions: { entitlement: 300, remaining: -12 } },
      }),
    });

    assert.equal(result.primary_window.used, 300);
    assert.equal(result.primary_window.limit, 300);
    assert.equal(result.primary_window.used_percent, 100);
  });

  it("reports no window at all when the snapshot is entirely zero", async () => {
    // Pre-existing guard in buildCopilotWindow that had no coverage: an
    // all-zero snapshot means "no quota of this kind", not "0% used".
    const home = copilotHome();
    const result = await fetchCopilotLimits({
      home,
      env: { HOME: home },
      fetchImpl: respondWith({
        quota_snapshots: {
          premium_interactions: { entitlement: 0, remaining: 0, percent_remaining: 0 },
        },
      }),
    });

    assert.equal(result.configured, true);
    assert.equal(result.primary_window, null);
    assert.equal(result.secondary_window, null);
  });

  it("is not configured when no Copilot token is on disk", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-copilot-none-"));
    let called = false;
    const result = await fetchCopilotLimits({
      home,
      env: { HOME: home },
      fetchImpl: async () => {
        called = true;
        throw new Error("must not reach the network without a token");
      },
    });

    assert.equal(result.configured, false);
    assert.equal(called, false, "no token means no request");
  });

  it("leaves other providers' window shape untouched", async () => {
    // buildWindow is shared. Providers that report no countable units must emit
    // exactly the keys they emitted before — the counts are opt-in per provider,
    // so nothing downstream has to learn a field it will never see.
    const cursor = normalizeCursorUsageSummary({
      billingCycleEnd: "2026-08-01T00:00:00.000Z",
      membershipType: "pro",
      individualUsage: {
        plan: { totalPercentUsed: 42.4, autoPercentUsed: 31.2, apiPercentUsed: 78.9 },
      },
    });
    const keys = ["primary_window", "secondary_window", "tertiary_window"];
    // Assert the windows exist before inspecting them: an input shape that
    // produces none would make the loop below pass without checking anything.
    for (const key of keys) assert.ok(cursor[key], `${key} missing — fixture no longer exercises this`);
    for (const key of keys) {
      assert.deepEqual(
        Object.keys(cursor[key]).sort(),
        ["reset_at", "used_percent"],
        `${key} gained an unexpected field`,
      );
    }
  });
});
