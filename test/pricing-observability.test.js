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

test("the reported error code is sanitized, not interpolated", () => {
  // Unit-tested directly: loadLitellmData recovers from a failed fetch on its
  // own, so driving this through the reload only ever exercises the
  // "fell-back" branch — a test that asserts "no slash" there would pass
  // without touching the sanitizer at all.
  const sanitize = pricing.__sanitizeErrorCodeForTests;

  // A rejected promise can carry any object; nothing guarantees a short symbol.
  assert.equal(sanitize(["/Users/alice/private/pricing.json"]), "unknown");
  assert.equal(sanitize([undefined, "/etc/passwd"]), "unknown");
  assert.equal(sanitize(["ENOENT: no such file, open '/Users/alice/x'"]), "unknown");
  assert.equal(sanitize([{ toString: () => "/tmp/x" }]), "unknown");
  assert.equal(sanitize([]), "unknown");

  // Real codes and source labels still come through unchanged.
  assert.equal(sanitize(["ENOENT"]), "ENOENT");
  assert.equal(sanitize([undefined, "AbortError"]), "AbortError");
  assert.equal(sanitize(["seed-snapshot"]), "seed-snapshot");
  assert.equal(sanitize([null, "disk-cache"]), "disk-cache");
});

test("no failure path puts a path into the HTTP-exposed error field", async () => {
  const cachePath = tmpCachePath("nonerror");
  let fail = false;
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: async () => {
      if (fail) throw { code: "/Users/alice/private/pricing.json", name: "/etc/passwd" };
      return { "acme-1": entry(1e-6, 2e-6) };
    },
  });

  fs.rmSync(cachePath, { force: true });
  fail = true;
  pricing.getModelPricing("unknown-model");
  await pricing.__getStateForTests().reloadPromise;

  const reported = pricing.getPricingDiagnostics().last_refresh_error;
  assert.ok(reported, "a refresh that did not reach upstream must be reported");
  assert.equal(reported.includes("/"), false, `must not leak a path: ${reported}`);
  assert.equal(reported.includes("alice"), false);
});

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
