// Public pricing API. Replaces the hard-coded MODEL_PRICING table that used
// to live in src/lib/local-api.js. Keeps the same synchronous shape so all
// existing callers (computeRowCost, /functions/* handlers, tests) work
// unchanged after `await ensurePricingLoaded()` is awaited once at startup.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const curatedOverrides = require("./curated-overrides.json");
const {
  lookupPricing,
  buildLitellmPerMillionMap,
} = require("./matcher");
const { loadLitellmData } = require("./litellm-fetcher");

const ZERO_PRICING = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
const SEED_SNAPSHOT_PATH = path.resolve(__dirname, "seed-snapshot.json");

// Sync seed load. Done at require-time so callers that haven't awaited
// ensurePricingLoaded() (e.g. tests, vite mock startup, edge functions) still
// get LiteLLM-backed pricing instead of all-zero. ensurePricingLoaded() will
// later upgrade this to fresh disk cache or upstream data.
function loadSeedSync() {
  try {
    const raw = fs.readFileSync(SEED_SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    delete parsed._meta;
    return parsed;
  } catch (e) {
    return {};
  }
}

const seedRaw = loadSeedSync();

// How long a loaded snapshot is trusted before a lookup is allowed to trigger a
// background refresh. Mirrors the fetcher's disk-cache TTL: before this change
// that TTL only chose which snapshot to load *at startup*, so a dashboard that
// stayed up (the LaunchAgent stays up for days) never saw a new model or a
// price change — claude-opus-5 billed $0 for 21 hours that way. Issue #90.
const RELOAD_AFTER_MS = 24 * 60 * 60 * 1000;

// Floor between background refreshes, so a permanently-unknown model cannot
// turn every request into an upstream fetch.
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000;

// Resolution tiers that mean "we guessed": the model matched a substring or a
// curated fuzzy rule rather than an exact id, so the price is plausible but may
// belong to a different model. Worth surfacing — a wrong price never looks
// wrong, unlike a $0 one.
const FUZZY_SOURCES = new Set(["curated:fuzzy", "litellm:fuzzy", "litellm:prefix-strip"]);

// Placeholder ids that stand in for "this row has no model", so they resolve to
// the "unattributed" tier instead of being looked up and recorded as a miss.
// Closed set on purpose: a real model id must never be silently un-priced here.
const UNATTRIBUTED_MODEL_IDS = new Set(["unknown"]);

// These ids are logical routes that deliberately select a physical child model
// per request. Their names can include one tier name, but that is not evidence
// that every request used that tier. Do not run them through fuzzy pricing: a
// route-level estimate would silently charge every request at the wrong child
// rate. They stay visible as unpriced until per-request resolved-model or
// authoritative cost data is persisted.
const UNRESOLVED_LOGICAL_ROUTE_IDS = new Set([
  "claude-auto-pilot-fable-v1-canary",
]);
const UNPRICED_TIERS = new Set(["miss", "routed-unresolved"]);

// `last_refresh_error` is served over HTTP to the dashboard, so it is built
// from CLOSED sets, never from an arbitrary value. A previous version accepted
// anything symbol-shaped, which a QA pass broke immediately: a 32-character
// token like `sk_live_AAAA…` is symbol-shaped. There is no pattern that
// separates "a short error symbol" from "a short secret" — only an allowlist.
const KNOWN_ERROR_CODES = new Set([
  // fs
  "ENOENT", "EACCES", "EPERM", "EEXIST", "ENOSPC", "EROFS", "EISDIR", "ENOTDIR", "EMFILE", "EBUSY",
  // network
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
  "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT",
  // error classes
  "AbortError", "TypeError", "SyntaxError", "RangeError", "FetchError", "Error",
]);

// Whatever loadLitellmData can report as the origin of the data it returned.
const KNOWN_SOURCES = new Set(["upstream", "disk-cache", "stale-cache", "seed-snapshot"]);

function labelFrom(allowed, candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && allowed.has(candidate)) return candidate;
  }
  return "unknown";
}

const state = {
  loaded: false,
  loadingPromise: null,
  loadedAt: 0,
  reloadPromise: null,
  lastReloadAt: 0,
  lastReloadError: null,
  litellmRawMap: seedRaw, // raw per-token; field shape from LiteLLM JSON
  litellmPerMillionMap: buildLitellmPerMillionMap(seedRaw), // USD/MTok
  source: Object.keys(seedRaw).length ? "seed-snapshot:sync" : null,
  // negativeCache prevents re-walking the LiteLLM map for models we've already
  // determined are unknown. Cleared on every reload.
  negativeCache: new Set(),
  // model -> resolution tier, for the diagnostics surface. Cleared on reload.
  tiers: new Map(),
  // Models already warned about, so a hot path logs once, not once per row.
  warned: new Set(),
  reloadOptions: {},
};

function defaultCachePath() {
  return path.join(os.homedir(), ".tokentracker", "cache", "pricing.json");
}

// `requireUpstream` guards the background path. loadLitellmData falls back on
// its own (upstream → stale disk cache → bundled seed), so a refresh that fails
// to reach upstream would otherwise REPLACE good in-memory data with the older
// seed — re-introducing exactly the "new model bills $0" bug this reload exists
// to fix. Verified: with the disk cache deleted and upstream down, a model
// priced at $5/$25 dropped to $0 after a failed refresh.
async function loadInto(opts, { requireUpstream = false } = {}) {
  const cachePath = opts.cachePath || defaultCachePath();
  const { data, source } = await loadLitellmData({ ...opts, cachePath });
  if (requireUpstream && source !== "upstream") {
    state.lastReloadError = `refresh-fell-back-to-${labelFrom(KNOWN_SOURCES, [source])}`;
    return;
  }
  state.litellmRawMap = data || {};
  state.litellmPerMillionMap = buildLitellmPerMillionMap(state.litellmRawMap);
  state.source = source;
  state.loaded = true;
  state.loadedAt = Date.now();
  state.negativeCache.clear();
  state.tiers.clear();
}

async function ensurePricingLoaded(opts = {}) {
  if (state.loaded) return state;
  if (state.loadingPromise) return state.loadingPromise;

  // Remembered so a later background reload can reach the same cache path and
  // fetch options without the caller having to plumb them through again.
  state.reloadOptions = opts;

  state.loadingPromise = (async () => {
    try {
      await loadInto(opts);
      return state;
    } finally {
      state.loadingPromise = null;
    }
  })();

  return state.loadingPromise;
}

// Fire-and-forget refresh. Single-flight, never awaited by a lookup: the caller
// keeps whatever price it already has for this request and the next request
// benefits. A failed reload leaves the existing snapshot in place.
//
// The cooldown matters because a model that is genuinely absent upstream (a
// local or unlisted model) misses on every row it appears in. Without it, each
// of those rows would queue another upstream fetch the moment the previous one
// finished.
function scheduleReload(nowMs = Date.now()) {
  if (!state.loaded || state.reloadPromise) return state.reloadPromise;
  if (nowMs - state.lastReloadAt < RELOAD_COOLDOWN_MS) return null;
  state.lastReloadAt = nowMs;
  state.reloadPromise = (async () => {
    try {
      // forceRefresh skips the disk cache; without it a reload would just
      // re-read the same stale snapshot we already hold.
      state.lastReloadError = null;
      // forceRefresh skips the disk cache; without it a reload would just
      // re-read the same stale snapshot we already hold.
      await loadInto({ ...state.reloadOptions, forceRefresh: true }, { requireUpstream: true });
    } catch (e) {
      // Reached when loadLitellmData itself throws rather than falling back —
      // statSafe rethrows a non-ENOENT stat error, so an unusable cache path
      // lands here (QA probe: refresh-failed:TypeError). Only
      // the error CODE is kept: messages from fs/fetch carry absolute paths and
      // this string is served over HTTP to the dashboard.
      state.lastReloadError = `refresh-failed:${labelFrom(KNOWN_ERROR_CODES, [e?.code, e?.name])}`;
    } finally {
      state.reloadPromise = null;
    }
  })();
  return state.reloadPromise;
}

function isSnapshotStale(nowMs = Date.now()) {
  return state.loaded && nowMs - state.loadedAt > RELOAD_AFTER_MS;
}

// For tests: drop loaded state so a fresh call can re-load. Seeds with the
// bundled snapshot so getModelPricing() still works without ensurePricingLoaded.
function resetPricingForTests() {
  state.loaded = false;
  state.loadingPromise = null;
  state.loadedAt = 0;
  state.reloadPromise = null;
  state.lastReloadAt = 0;
  state.lastReloadError = null;
  state.litellmRawMap = seedRaw;
  state.litellmPerMillionMap = buildLitellmPerMillionMap(seedRaw);
  state.source = Object.keys(seedRaw).length ? "seed-snapshot:sync" : null;
  state.negativeCache.clear();
  state.tiers.clear();
  state.warned.clear();
  state.reloadOptions = {};
}

function resolveLookupSource(opts) {
  if (typeof opts === "string") return opts.toLowerCase();
  if (opts && typeof opts.source === "string") return opts.source.toLowerCase();
  return null;
}

// A row whose model id could not be determined is stored and aggregated under
// the literal id "unknown" — persisted into the queue by src/commands/sync.js
// and src/lib/claude-categorizer.js, then coalesced to it again at read time by
// src/lib/local-api.js. That is a placeholder for "no model", not a model, so
// pricing it turned a missing *attribution* into a missing *price*: it recorded
// a permanent miss, listed "unknown" in unpriced_models as though a real model
// needed a curated price, and logged advice to add it to curated-overrides.json
// where it could never match anything.
// Returns the tier to report, or null when this is a real model id to look up.
function resolvePlaceholderTier(model) {
  if (!model) return "empty";
  const normalized = String(model).trim().toLowerCase();
  if (!normalized) return "empty";
  return UNATTRIBUTED_MODEL_IDS.has(normalized) ? "unattributed" : null;
}

// Returns the price AND how it was resolved. getModelPricing keeps the old
// bare-numbers contract for the many existing callers; anything that wants to
// show the user how much to trust the number uses this.
function getModelPricingMeta(model, opts = {}) {
  const placeholderTier = resolvePlaceholderTier(model);
  if (placeholderTier) return { pricing: ZERO_PRICING, tier: placeholderTier };

  const lookupSource = resolveLookupSource(opts);
  const cacheKey = lookupSource ? `${lookupSource}\0${model}` : model;

  if (UNRESOLVED_LOGICAL_ROUTE_IDS.has(String(model || "").trim())) {
    state.tiers.set(cacheKey, { model, source: lookupSource, tier: "routed-unresolved" });
    return { pricing: ZERO_PRICING, tier: "routed-unresolved" };
  }

  if (state.negativeCache.has(cacheKey)) {
    // Still unknown as of the current snapshot. If that snapshot has aged out,
    // a new model may have appeared upstream — refresh for the next caller.
    if (isSnapshotStale()) scheduleReload();
    return { pricing: ZERO_PRICING, tier: "miss" };
  }

  const result = lookupPricing(model, {
    curated: curatedOverrides,
    litellm: state.litellmPerMillionMap,
    source: lookupSource,
  });

  if (result.hit) {
    state.tiers.set(cacheKey, { model, source: lookupSource, tier: result.source });
    return { pricing: result.value, tier: result.source };
  }

  state.negativeCache.add(cacheKey);
  state.tiers.set(cacheKey, { model, source: lookupSource, tier: "miss" });

  // A miss is the strongest signal that our snapshot predates a model launch —
  // exactly the claude-opus-5 case. Refresh in the background so the next
  // request prices it, instead of waiting for a process restart.
  scheduleReload();

  if (!state.warned.has(cacheKey)) {
    state.warned.add(cacheKey);
    console.warn(
      `[pricing] no price for model "${model}"${lookupSource ? ` (source: ${lookupSource})` : ""}`
        + " — its cost is being counted as $0. Refreshing pricing data in the background;"
        + " if it stays unpriced, add it to src/lib/pricing/curated-overrides.json.",
    );
  }

  return { pricing: ZERO_PRICING, tier: "miss" };
}

function getModelPricing(model, opts = {}) {
  return getModelPricingMeta(model, opts).pricing;
}

// Snapshot of what the pricing layer knows it got wrong or guessed at, for the
// API to hand to the dashboard.
function getPricingDiagnostics() {
  // Keyed by source+model, matching the lookup itself: the same model id can
  // resolve differently per provider (Antigravity normalises names before the
  // lookup), so a model-only key would let one provider's exact hit hide
  // another's miss.
  const unpriced = new Set();
  const fuzzy = [];
  for (const entry of state.tiers.values()) {
    if (UNPRICED_TIERS.has(entry.tier)) unpriced.add(entry.model);
    else if (FUZZY_SOURCES.has(entry.tier)) fuzzy.push({ model: entry.model, tier: entry.tier });
  }
  return {
    source: state.source,
    loaded_at: state.loadedAt ? new Date(state.loadedAt).toISOString() : null,
    stale: isSnapshotStale(),
    refreshing: Boolean(state.reloadPromise),
    last_refresh_error: state.lastReloadError,
    unpriced_models: Array.from(unpriced).sort(),
    fuzzy_priced_models: fuzzy.sort((a, b) => a.model.localeCompare(b.model)),
  };
}

// Same formula and Codex/every-code reasoning-folding rule as the previous
// computeRowCost in src/lib/local-api.js. Moved here so vite mock + local
// server share one source of truth.
function computeRowCost(row) {
  const pricing = getModelPricing(row.model, { source: row.source });
  const reasoningIncludedInOutput = row.source === "codex" || row.source === "every-code";
  const reasoningCost = reasoningIncludedInOutput
    ? 0
    : (row.reasoning_output_tokens || 0) * (pricing.output || 0);
  return (
    ((row.input_tokens || 0) * (pricing.input || 0) +
      (row.output_tokens || 0) * (pricing.output || 0) +
      (row.cached_input_tokens || 0) * (pricing.cache_read || 0) +
      (row.cache_creation_input_tokens || 0) * (pricing.cache_write || 0) +
      reasoningCost) /
    1_000_000
  );
}

// Backwards-compatible MODEL_PRICING export. Test at
// test/model-breakdown.test.js:236 reads `localApi.MODEL_PRICING["kiro-agent"]`
// and expects { input, output, cache_read, cache_write } shape. We expose the
// CURATED.exact map (which contains the kiro entries by design); LiteLLM
// entries are NOT included here because they're keyed dynamically and the old
// table was authoritative for what is now CURATED.
const MODEL_PRICING = curatedOverrides.exact;

module.exports = {
  ensurePricingLoaded,
  getModelPricing,
  getModelPricingMeta,
  getPricingDiagnostics,
  computeRowCost,
  resetPricingForTests,
  MODEL_PRICING,
  ZERO_PRICING,
  // Internal hooks for tests.
  __getStateForTests: () => state,
  __labelFromForTests: labelFrom,
  __KNOWN_ERROR_CODES: KNOWN_ERROR_CODES,
};
