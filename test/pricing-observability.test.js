const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, beforeEach } = require("node:test");

const pricing = require("../src/lib/pricing");

function tmpCachePath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tt-pricing-${name}-`));
  return path.join(dir, "pricing.json");
}

// Shape the fetcher expects from upstream: per-token costs.
function entry(input, output) {
  return { input_cost_per_token: input, output_cost_per_token: output };
}

// Drives ensurePricingLoaded with an injected upstream so the test never talks
// to the network. `payload` is mutable, which is the whole point: it stands in
// for LiteLLM publishing a model after we already loaded a snapshot.
async function loadWith(payload, cachePath) {
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: async () => payload.current,
  });
}

function captureWarnings(run) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    return { result: run(), lines };
  } finally {
    console.warn = original;
  }
}

// A miss schedules a background reload that most tests never await. Left
// in flight it would land in the middle of the *next* test and overwrite the
// snapshot it just set up, so drain it before resetting.
beforeEach(async () => {
  await pricing.__getStateForTests().reloadPromise;
  pricing.resetPricingForTests();
});

test("an exact hit reports its tier and the price", async () => {
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("exact"));

  const meta = pricing.getModelPricingMeta("acme-1");
  assert.equal(meta.tier, "litellm:exact");
  assert.equal(meta.pricing.input, 1);
  assert.equal(meta.pricing.output, 2);
  // The bare-numbers contract other callers rely on is unchanged.
  assert.deepEqual(pricing.getModelPricing("acme-1"), meta.pricing);
});

test("a substring match is reported as fuzzy, not passed off as exact", async () => {
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("fuzzy"));

  // "acme-1-turbo-preview" contains the key "acme-1" and resolves via the
  // reverse-substring tier — a plausible price for a model we never saw.
  const meta = pricing.getModelPricingMeta("acme-1-turbo-preview");
  assert.equal(meta.tier, "litellm:fuzzy");
  assert.equal(meta.pricing.input, 1);

  const diagnostics = pricing.getPricingDiagnostics();
  assert.deepEqual(
    diagnostics.fuzzy_priced_models,
    [{ model: "acme-1-turbo-preview", tier: "litellm:fuzzy" }],
  );
  assert.deepEqual(diagnostics.unpriced_models, []);
});

test("an unknown model is reported as a miss and listed in diagnostics", async () => {
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("miss"));

  const meta = pricing.getModelPricingMeta("totally-unknown-model");
  assert.equal(meta.tier, "miss");
  assert.deepEqual(meta.pricing, pricing.ZERO_PRICING);

  assert.deepEqual(pricing.getPricingDiagnostics().unpriced_models, ["totally-unknown-model"]);
});

test("an unknown model warns once per process, not once per row", async () => {
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("warn"));

  const { lines } = captureWarnings(() => {
    for (let i = 0; i < 25; i += 1) pricing.getModelPricing("totally-unknown-model");
  });

  assert.equal(lines.length, 1, `expected exactly one warning, got ${lines.length}`);
  assert.match(lines[0], /totally-unknown-model/);
  assert.match(lines[0], /\$0/);
});

test("a model published after startup is priced without restarting the process", async () => {
  // The claude-opus-5 incident, reproduced: load a snapshot that predates the
  // model, then let the background reload pick it up.
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("reload"));

  assert.deepEqual(pricing.getModelPricing("acme-2"), pricing.ZERO_PRICING);

  payload.current = { "acme-1": entry(1e-6, 2e-6), "acme-2": entry(5e-6, 25e-6) };
  await pricing.__getStateForTests().reloadPromise;

  const meta = pricing.getModelPricingMeta("acme-2");
  assert.equal(meta.tier, "litellm:exact", "the reload must clear the negative cache");
  assert.equal(meta.pricing.input, 5);
  assert.equal(meta.pricing.output, 25);
});

test("the reload is single-flight — concurrent misses do not stampede upstream", async () => {
  let fetches = 0;
  const cachePath = tmpCachePath("single-flight");
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: async () => {
      fetches += 1;
      return { "acme-1": entry(1e-6, 2e-6) };
    },
  });
  const afterLoad = fetches;

  for (const model of ["unknown-a", "unknown-b", "unknown-c"]) pricing.getModelPricing(model);
  await pricing.__getStateForTests().reloadPromise;

  assert.equal(fetches - afterLoad, 1, "three misses must share one refresh");
});

test("a permanently unknown model cannot refetch on every lookup", async () => {
  let fetches = 0;
  const cachePath = tmpCachePath("cooldown");
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: async () => {
      fetches += 1;
      return { "acme-1": entry(1e-6, 2e-6) };
    },
  });
  const afterLoad = fetches;

  // Each round completes its reload before the next lookup, so only the
  // cooldown stands between this and one upstream fetch per row.
  for (let i = 0; i < 5; i += 1) {
    pricing.getModelPricing("never-listed-model");
    await pricing.__getStateForTests().reloadPromise;
  }

  assert.equal(fetches - afterLoad, 1, "the cooldown must suppress repeat refreshes");
});

test("a failed reload cannot downgrade the prices already loaded", async () => {
  // The earlier version of this test left the disk cache in place, so the
  // fetcher's own fallback re-read the same data and the test passed without
  // proving anything. Delete the cache first: now the only fallback left is the
  // OLDER bundled seed, which does not know this model — exactly the shape that
  // re-introduced $0 for a newly published model.
  const cachePath = tmpCachePath("offline");
  let shouldFail = false;
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: async () => {
      if (shouldFail) throw new Error("offline");
      return { "brand-new-model": entry(5e-6, 25e-6) };
    },
  });
  assert.equal(pricing.getModelPricing("brand-new-model").input, 5);

  fs.rmSync(cachePath, { force: true });
  shouldFail = true;
  pricing.getModelPricing("some-other-unknown");
  await pricing.__getStateForTests().reloadPromise;

  assert.equal(
    pricing.getModelPricing("brand-new-model").input,
    5,
    "a failed refresh must not replace good data with the older seed",
  );

  const diagnostics = pricing.getPricingDiagnostics();
  assert.match(diagnostics.last_refresh_error, /^refresh-/);
  assert.equal(diagnostics.source, "upstream", "the snapshot in memory is still the upstream one");
});

test("a refresh that only reaches the bundled seed is reported, not applied", async () => {
  const cachePath = tmpCachePath("fallback");
  let serveUpstream = true;
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: async () => {
      if (!serveUpstream) throw new Error("offline");
      return { "brand-new-model": entry(5e-6, 25e-6) };
    },
  });

  fs.rmSync(cachePath, { force: true });
  serveUpstream = false;
  pricing.getModelPricing("still-unknown");
  await pricing.__getStateForTests().reloadPromise;

  const diagnostics = pricing.getPricingDiagnostics();
  assert.match(
    diagnostics.last_refresh_error,
    /^refresh-(failed|fell-back)/,
    "the dashboard must be able to see that the refresh did not reach upstream",
  );
});

test("a refresh error never carries a filesystem path into the HTTP response", async () => {
  const cachePath = tmpCachePath("nopath");
  let fail = false;
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: async () => {
      if (fail) {
        const e = new Error(`ENOENT: no such file or directory, open '${cachePath}'`);
        e.code = "ENOENT";
        throw e;
      }
      return { "acme-1": entry(1e-6, 2e-6) };
    },
  });

  fs.rmSync(cachePath, { force: true });
  fail = true;
  pricing.getModelPricing("unknown-model");
  await pricing.__getStateForTests().reloadPromise;

  const reported = pricing.getPricingDiagnostics().last_refresh_error;
  assert.ok(reported, "a failed refresh must still be reported");
  assert.equal(reported.includes("/"), false, `error must not leak a path: ${reported}`);
  assert.equal(reported.includes(os.tmpdir()), false);
});

test("diagnostics report the snapshot's age and source", async () => {
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("diag"));

  const diagnostics = pricing.getPricingDiagnostics();
  assert.equal(diagnostics.source, "upstream");
  assert.ok(Date.parse(diagnostics.loaded_at) > 0);
  assert.equal(diagnostics.stale, false);
});

test("lookups still work before ensurePricingLoaded, and report no reload state", () => {
  // The bundled seed answers synchronously at require-time; nothing should
  // throw or try to reload when no async load has happened yet.
  assert.equal(pricing.getModelPricingMeta("").tier, "empty");
  const diagnostics = pricing.getPricingDiagnostics();
  assert.equal(diagnostics.loaded_at, null);
  assert.equal(diagnostics.refreshing, false);
});

test("the reported error label comes from a closed set, not a pattern", () => {
  // The first attempt used a regex for "symbol-shaped". A QA pass broke it in
  // one line: a payment-provider key prefix plus 24 characters is symbol-shaped
  // too. No pattern separates a short error symbol from a short secret — only
  // an allowlist does.
  //
  // The look-alikes are assembled at runtime rather than written as literals:
  // a realistic-looking key in a source file trips GitHub push protection (it
  // did) and, more to the point, a repo should not carry strings that a scanner
  // has to be told to ignore.
  const fakeStripeKey = ["sk", "live", "A".repeat(24)].join("_");
  const fakeGithubToken = `ghp_${"0123456789abcdefghij"}`;
  const label = pricing.__labelFromForTests;
  const codes = pricing.__KNOWN_ERROR_CODES;

  assert.equal(label(codes, [fakeStripeKey]), "unknown");
  assert.equal(label(codes, ["/Users/alice/private/pricing.json"]), "unknown");
  assert.equal(label(codes, [undefined, fakeGithubToken]), "unknown");
  assert.equal(label(codes, [{ toString: () => "ENOENT" }]), "unknown");
  assert.equal(label(codes, []), "unknown");

  assert.equal(label(codes, ["ENOENT"]), "ENOENT");
  assert.equal(label(codes, [undefined, "AbortError"]), "AbortError");
});

// Every value this field can take, so a call site that stopped going through
// the allowlist would produce something outside this set.
const ALLOWED_REFRESH_ERRORS = new Set([
  ...["upstream", "disk-cache", "stale-cache", "seed-snapshot", "unknown"].map(
    (s) => `refresh-fell-back-to-${s}`,
  ),
  ...[...pricing.__KNOWN_ERROR_CODES, "unknown"].map((c) => `refresh-failed:${c}`),
]);

test("the fallback branch reports only an allowlisted label", async () => {
  const cachePath = tmpCachePath("nonerror");
  let fail = false;
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: async () => {
      if (fail) {
        // Same reasoning as above: built at runtime, not written as a literal.
        throw { code: "/Users/alice/private/pricing.json", name: ["sk", "live", "A".repeat(24)].join("_") };
      }
      return { "acme-1": entry(1e-6, 2e-6) };
    },
  });

  fs.rmSync(cachePath, { force: true });
  fail = true;
  pricing.getModelPricing("unknown-model");
  await pricing.__getStateForTests().reloadPromise;

  const reported = pricing.getPricingDiagnostics().last_refresh_error;
  assert.ok(
    ALLOWED_REFRESH_ERRORS.has(reported),
    `reported value must come from the allowlist, got ${JSON.stringify(reported)}`,
  );
});

// NOT TESTED end to end: scheduleReload's catch IS reachable — statSafe
// rethrows a non-ENOENT stat error, so an unusable cache path lands there and a
// QA probe observed refresh-failed:TypeError. An earlier attempt to drive it
// from a test made a real network call and asserted nothing, so the branch is
// left to the unit test of the allowlist above rather than covered by a test
// that cannot fail. Recorded as a real gap, not dismissed as unreachable.

test("one provider's exact hit cannot hide another provider's miss", async () => {
  // Antigravity normalises model names before the lookup, so the same id can
  // resolve differently per source. Keyed by model alone, the last write wins
  // and one of the two verdicts disappears from the diagnostics.
  const payload = { current: { "shared-name": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("two-source"));

  assert.equal(pricing.getModelPricingMeta("shared-name", { source: "claude" }).tier, "litellm:exact");
  assert.equal(
    pricing.getModelPricingMeta("unknown-only-here", { source: "antigravity" }).tier,
    "miss",
  );
  // Same id, two sources: the exact hit must not erase the miss.
  pricing.getModelPricingMeta("shared-name", { source: "antigravity" });

  const diagnostics = pricing.getPricingDiagnostics();
  assert.deepEqual(diagnostics.unpriced_models, ["unknown-only-here"]);
});

// --- the "unknown" placeholder is not a model -------------------------------
// Rows whose model id could not be determined are stored under the literal id
// "unknown" (src/commands/sync.js:1250,1675,1768) and coalesced to it again at
// read time (src/lib/local-api.js:210,434,1121,1355). Pricing it turned a
// missing *attribution* into a missing *price*, which is a different problem
// with a different fix — the live dashboard reported unpriced_models:
// ["unknown"] and advised adding it to curated-overrides.json, where it could
// never match anything.

test("the \"unknown\" placeholder resolves as unattributed, not as an unpriced model", async () => {
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("unattributed"));

  const { result: meta, lines } = captureWarnings(() =>
    pricing.getModelPricingMeta("unknown", { source: "claude" }),
  );

  assert.equal(meta.tier, "unattributed");
  assert.deepEqual(meta.pricing, pricing.ZERO_PRICING, "still costs nothing, as before");
  assert.deepEqual(lines, [], "no advice to add a placeholder to curated-overrides.json");

  const diagnostics = pricing.getPricingDiagnostics();
  assert.deepEqual(
    diagnostics.unpriced_models,
    [],
    "unpriced_models names models needing a curated price — a placeholder is not one",
  );
  assert.deepEqual(diagnostics.fuzzy_priced_models, []);
  assert.equal(
    pricing.__getStateForTests().reloadPromise,
    null,
    "a placeholder must not burn an upstream refresh looking for a price it can never have",
  );
});

test("a model id that is only whitespace is empty, not a placeholder-shaped miss", async () => {
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("blank"));

  // `!model` misses this, so before the trim it reached the lookup and leaked
  // into unpriced_models as "  " — the same defect wearing different characters.
  assert.equal(pricing.getModelPricingMeta("   ").tier, "empty");
  assert.deepEqual(pricing.getPricingDiagnostics().unpriced_models, []);
});

test("case and padding do not smuggle the placeholder past the check", async () => {
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("placeholder-variants"));

  for (const variant of ["UNKNOWN", " Unknown ", "unknown\n"]) {
    assert.equal(
      pricing.getModelPricingMeta(variant).tier,
      "unattributed",
      `${JSON.stringify(variant)} is the same placeholder`,
    );
  }
  assert.deepEqual(pricing.getPricingDiagnostics().unpriced_models, []);
});

test("a real model that merely contains \"unknown\" is still priced or missed normally", async () => {
  // The exemption is a closed set, not a substring rule: silently un-pricing a
  // real model would recreate the $0 bug this whole surface exists to expose.
  const payload = { current: { "unknown-labs-v2": entry(3e-6, 6e-6) } };
  await loadWith(payload, tmpCachePath("real-model"));

  assert.equal(pricing.getModelPricingMeta("unknown-labs-v2").tier, "litellm:exact");
  // Contains the priced key, so it resolves the same way any other model would.
  assert.equal(pricing.getModelPricingMeta("unknown-labs-v2-preview").tier, "litellm:fuzzy");
  assert.equal(pricing.getModelPricingMeta("mystery-model").tier, "miss");
  assert.deepEqual(pricing.getPricingDiagnostics().unpriced_models, ["mystery-model"]);
});

test("configured auto-router routes use their approved child-model weighted estimates", async () => {
  const payload = {
    current: {
      "claude-sonnet-5": {
        input_cost_per_token: 2e-6,
        output_cost_per_token: 10e-6,
        cache_read_input_token_cost: 0.2e-6,
        cache_creation_input_token_cost: 2.5e-6,
      },
      "claude-opus-5": {
        input_cost_per_token: 5e-6,
        output_cost_per_token: 25e-6,
        cache_read_input_token_cost: 0.5e-6,
        cache_creation_input_token_cost: 6.25e-6,
      },
      "gpt-5.6-terra": {
        input_cost_per_token: 2e-6,
        output_cost_per_token: 12e-6,
        cache_read_input_token_cost: 0.2e-6,
        cache_creation_input_token_cost: 2.5e-6,
      },
      "gpt-5.6-sol": {
        input_cost_per_token: 4e-6,
        output_cost_per_token: 20e-6,
        cache_read_input_token_cost: 0.4e-6,
        cache_creation_input_token_cost: 5e-6,
      },
    },
  };
  await loadWith(payload, tmpCachePath("composite-auto-router"));

  const claude = pricing.getModelPricingMeta("claude-auto-pilot-fable-v1-canary", { source: "hermes" });
  assert.equal(claude.tier, "routed-estimated");
  assert.deepEqual(claude.pricing, { input: 3.2, output: 16, cache_read: 0.32, cache_write: 4 });
  const gpt = pricing.getModelPricingMeta("gpt-5.6-auto-pilot-055-v2", { source: "hermes" });
  assert.equal(gpt.tier, "routed-estimated");
  assert.deepEqual(gpt.pricing, { input: 2.8, output: 15.2, cache_read: 0.28, cache_write: 3.5 });
  assert.deepEqual(
    pricing.getPricingDiagnostics().unpriced_models,
    [],
  );
  assert.deepEqual(
    pricing.getPricingDiagnostics().fuzzy_priced_models,
    [
      { model: "claude-auto-pilot-fable-v1-canary", tier: "routed-estimated" },
      { model: "gpt-5.6-auto-pilot-055-v2", tier: "routed-estimated" },
    ],
  );
});

test("a routed estimate fails closed when any child price is only a fuzzy hit", async () => {
  const payload = {
    current: {
      // The pricing policy asks for claude-sonnet-5. This shorter key would
      // fuzzy-match it, but is not strong enough evidence for a weighted route.
      "claude-sonnet": {
        input_cost_per_token: 99e-6,
        output_cost_per_token: 99e-6,
        cache_read_input_token_cost: 99e-6,
        cache_creation_input_token_cost: 99e-6,
      },
      "claude-opus-5": {
        input_cost_per_token: 5e-6,
        output_cost_per_token: 25e-6,
        cache_read_input_token_cost: 0.5e-6,
        cache_creation_input_token_cost: 6.25e-6,
      },
    },
  };
  await loadWith(payload, tmpCachePath("composite-child-fuzzy"));

  const meta = pricing.getModelPricingMeta("claude-auto-pilot-fable-v1-canary", { source: "hermes" });
  assert.equal(meta.tier, "routed-unresolved");
  assert.deepEqual(meta.pricing, pricing.ZERO_PRICING);
  assert.deepEqual(
    pricing.getPricingDiagnostics().unpriced_models,
    ["claude-auto-pilot-fable-v1-canary"],
  );
  assert.deepEqual(pricing.getPricingDiagnostics().fuzzy_priced_models, []);
});

test("cost for an unattributed row is unchanged by the exemption", async () => {
  const payload = { current: { "acme-1": entry(1e-6, 2e-6) } };
  await loadWith(payload, tmpCachePath("unattributed-cost"));

  // The row was already costing $0 (no price to apply). The fix changes how it
  // is *reported*, and must not quietly change anyone's total.
  const cost = pricing.computeRowCost({
    model: "unknown",
    source: "claude",
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
  });
  assert.equal(cost, 0);
  assert.deepEqual(pricing.getModelPricing("unknown"), pricing.ZERO_PRICING);
});
