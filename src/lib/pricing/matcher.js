// Pure pricing-lookup logic. No I/O, no async. Tested in isolation.
//
// Resolve order:
//   1. CURATED exact match (self-defined aliases like kiro-*, hy3-*)
//   2. LiteLLM exact match (mainstream claude/gpt-5/gemini)
//   3. CURATED alias (e.g. "auto" -> "composer-1")
//   4. CURATED fuzzy substring (e.g. "kiro-future-xyz" matches via "kiro")
//   5. LiteLLM suffix-strip (gpt-5-codex-high-fast -> gpt-5-codex)
//   5b. LiteLLM provider-prefix strip (mimo-v2.5-pro -> openrouter/xiaomi/mimo-v2.5-pro)
//   6. LiteLLM reverse substring (longest-key first)
//   7. null  (caller decides what to do — typically zero-pricing + negative cache)

const SUFFIX_STRIP_PATTERNS = [
  /-xhigh-fast$/,
  /-high-fast$/,
  /-medium-fast$/,
  /-low-fast$/,
  /-xhigh$/,
  /-high$/,
  /-medium$/,
  /-low$/,
  /-fast$/,
];

function stripReasoningSuffix(model) {
  for (const re of SUFFIX_STRIP_PATTERNS) {
    if (re.test(model)) return model.replace(re, "");
  }
  return model;
}

function normalizeAntigravityModel(model) {
  if (!model || typeof model !== "string") return model;
  let lower = model
    .trim()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(thinking|xhigh|high|medium|low|fast)\b/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  lower = stripReasoningSuffix(lower);

  if (lower.startsWith("gemini-claude-") || lower.startsWith("gemini-gpt-")) {
    lower = lower.substring(7);
  }

  if (/^gemini-3\.\d+-flash-lite/.test(lower)) return "gemini-2.5-flash-lite";
  if (/^gemini-3\.\d+-flash/.test(lower)) return "gemini-2.5-flash";
  if (/^gemini-3\.\d+-pro/.test(lower)) return "gemini-2.5-pro";
  if (/^claude-(sonnet|opus|haiku)-4\.\d+/.test(lower)) {
    return lower.replace(/^claude-(sonnet|opus|haiku)-4\.(\d+)/, "claude-$1-4-$2");
  }
  if (lower.startsWith("gpt-oss-120b")) return "antigravity-gpt-oss-120b";

  return lower;
}

function shouldNormalizeAntigravity(source) {
  return typeof source === "string" && source.toLowerCase() === "antigravity";
}

// Memoise the sorted-by-length LiteLLM key list. Reverse-substring scan walks
// this once per uncached model; ~2k keys × negligible per-iteration cost, but
// computing the sort on every call would add up across a sync.
const sortedKeysCache = new WeakMap();
function getSortedKeys(litellm) {
  let cached = sortedKeysCache.get(litellm);
  if (!cached) {
    cached = Object.keys(litellm).sort((a, b) => b.length - a.length);
    sortedKeysCache.set(litellm, cached);
  }
  return cached;
}

function buildDotRestoredModel(model) {
  if (typeof model !== "string") return "";
  const lower = model.toLowerCase();
  const restored = lower.replace(/(\d+)-(\d+)/g, "$1.$2");
  return restored === lower ? "" : restored;
}

function lookupExactCaseInsensitive(table, model) {
  if (!table || !model) return null;
  if (table[model]) return table[model];
  const lower = model.toLowerCase();
  for (const key of Object.keys(table)) {
    if (key.toLowerCase() === lower) return table[key];
  }
  return null;
}

function lookupContainedExactCaseInsensitive(table, model) {
  if (!table || !model) return null;
  const lower = model.toLowerCase();
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key.toLowerCase())) return table[key];
  }
  return null;
}

// Strips known "vendor build-label" noise so an already-priced model hiding
// under an auto-pilot/canary wrapper name can still resolve without a
// hand-added curated entry for every wrapped variant (issue #193). Scoped to
// the exact shapes seen in production: an "-auto-pilot-" infix used as a
// build-label separator, and a trailing "-vN-canary" / "-canary" release
// marker. Deliberately does NOT touch "-preview"/"-beta"/reasoning-effort
// suffixes (handled separately by stripReasoningSuffix) since those can carry
// real pricing distinctions.
const AUTO_PILOT_INFIX = /-auto-pilot-/g;
const CANARY_SUFFIX = /-v\d+-canary$|-canary$/;

function stripVendorRenameNoise(model) {
  if (typeof model !== "string" || !model) return "";
  let stripped = model.replace(AUTO_PILOT_INFIX, "-");
  stripped = stripped.replace(CANARY_SUFFIX, "");
  return stripped;
}

function lookupPricing(model, opts = {}) {
  const { curated, litellm, source, _denoised = false } = opts;
  if (!model || typeof model !== "string") {
    return { hit: false, source: "empty", value: null };
  }
  const lookupModel = shouldNormalizeAntigravity(source)
    ? normalizeAntigravityModel(model)
    : model;
  const lower = lookupModel.toLowerCase();
  const dotForm = buildDotRestoredModel(lookupModel);

  // 1. CURATED exact
  if (curated.exact && curated.exact[lookupModel]) {
    return { hit: true, source: "curated:exact", value: curated.exact[lookupModel] };
  }
  const curatedDotExact = lookupExactCaseInsensitive(curated.exact, dotForm);
  if (curatedDotExact) {
    return { hit: true, source: "curated:exact-dot", value: curatedDotExact };
  }
  const curatedDotContainedExact = lookupContainedExactCaseInsensitive(curated.exact, dotForm);
  if (curatedDotContainedExact) {
    return { hit: true, source: "curated:exact-dot", value: curatedDotContainedExact };
  }

  // 2. LiteLLM exact
  if (litellm && litellm[lookupModel]) {
    return { hit: true, source: "litellm:exact", value: litellm[lookupModel] };
  }
  const litellmDotExact = lookupExactCaseInsensitive(litellm, dotForm);
  if (litellmDotExact) {
    return { hit: true, source: "litellm:exact-dot", value: litellmDotExact };
  }

  // 3. CURATED alias (literal mapping like "auto" -> "composer-1")
  if (curated.alias && curated.alias[lookupModel] && curated.exact[curated.alias[lookupModel]]) {
    return {
      hit: true,
      source: "curated:alias",
      value: curated.exact[curated.alias[lookupModel]],
    };
  }

  // 4. CURATED fuzzy substring. Also try a dot-restored variant of the input
  // (digits separated by `-` rejoined as `.`) so providers that dash-normalize
  // numeric segments — Droid emits `glm-5-1-0` for upstream `GLM-5.1` — still
  // resolve against dot-keyed curated entries like `glm-5.1`, `glm-4.6`, etc.
  // The regex only fires on digit-dash-digit, so `claude-3-7-sonnet`,
  // `gpt-5-codex`, `gemini-2-5-pro` are unaffected (no digit-pair to rejoin or
  // no matching curated key).
  if (Array.isArray(curated.fuzzy)) {
    for (const { match, ref } of curated.fuzzy) {
      if (!match || !ref) continue;
      const needle = match.toLowerCase();
      if (!curated.exact[ref]) continue;
      if (lower.includes(needle)) {
        return { hit: true, source: "curated:fuzzy", value: curated.exact[ref] };
      }
      if (dotForm && dotForm.includes(needle)) {
        return { hit: true, source: "curated:fuzzy", value: curated.exact[ref] };
      }
    }
  }

  // 5. LiteLLM suffix-strip
  if (litellm) {
    const stripped = stripReasoningSuffix(lookupModel);
    if (stripped !== lookupModel && litellm[stripped]) {
      return { hit: true, source: "litellm:strip", value: litellm[stripped] };
    }
  }

  // 5b. LiteLLM provider-prefix strip. Queue rows store the bare model name
  // (e.g. "mimo-v2.5-pro"), but LiteLLM keys are provider-qualified (e.g.
  // "openrouter/xiaomi/mimo-v2.5-pro"), so the exact lookups above miss. Match
  // any key whose path suffix equals the bare model. When several providers
  // expose the same model, pick the lexicographically smallest key so the
  // resolved price is deterministic and independent of JSON ordering. Runs
  // AFTER curated alias/fuzzy so e.g. Cursor's "auto" still resolves to
  // composer-1 rather than a LiteLLM "*/auto" entry.
  if (litellm) {
    const suffix = "/" + lower;
    let best = null;
    for (const key of Object.keys(litellm)) {
      if (key.length > suffix.length && key.toLowerCase().endsWith(suffix)) {
        if (best === null || key < best) best = key;
      }
    }
    if (best) return { hit: true, source: "litellm:prefix-strip", value: litellm[best] };
  }

  // 6. LiteLLM reverse substring (longest-key first)
  if (litellm) {
    const sorted = getSortedKeys(litellm);
    for (const key of sorted) {
      const keyLower = key.toLowerCase();
      // Only accept if model is a superset of key (model contains key), to
      // avoid e.g. "gpt-5" matching "gpt-5-pro" in the wrong direction.
      if (lower.includes(keyLower) || (dotForm && dotForm.includes(keyLower))) {
        return { hit: true, source: "litellm:fuzzy", value: litellm[key] };
      }
    }
  }

  // 8. Vendor-rename denoise retry (issue #193). Runs LAST and only once (the
  // `_denoised` guard prevents re-entering this branch on the recursive
  // call), after every tier above has already had first crack at the raw
  // model id — so a real curated/LiteLLM entry that happens to already
  // contain "-auto-pilot-" or "-canary" is never shadowed by the stripped
  // retry. Only fires when stripping actually changed the string, so it
  // cannot loop or duplicate work for models with no vendor-rename noise.
  if (!_denoised) {
    const denoised = stripVendorRenameNoise(model);
    if (denoised && denoised !== model) {
      const retry = lookupPricing(denoised, { curated, litellm, source, _denoised: true });
      if (retry.hit) return retry;
    }
  }

  return { hit: false, source: "miss", value: null };
}

// Convert one LiteLLM entry (per-token) to internal per-million USD shape.
// Missing fields stay missing — callers default with `(pricing.x || 0)`.
//
// Why the round: floating-point math means 1e-7 * 1e6 = 0.09999999999999999.
// Rounding to 10 significant decimals ($0.0000000001 / MTok) is well below
// any realistic price step but cleans up the printed/asserted numbers.
function roundToTenDecimals(n) {
  return Math.round(n * 1e10) / 1e10;
}

function convertLitellmEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const out = {};
  if (typeof entry.input_cost_per_token === "number") {
    out.input = roundToTenDecimals(entry.input_cost_per_token * 1_000_000);
  }
  if (typeof entry.output_cost_per_token === "number") {
    out.output = roundToTenDecimals(entry.output_cost_per_token * 1_000_000);
  }
  if (typeof entry.cache_read_input_token_cost === "number") {
    out.cache_read = roundToTenDecimals(entry.cache_read_input_token_cost * 1_000_000);
  }
  if (typeof entry.cache_creation_input_token_cost === "number") {
    out.cache_write = roundToTenDecimals(entry.cache_creation_input_token_cost * 1_000_000);
  }
  return Object.keys(out).length ? out : null;
}

// Build a per-million-USD map from a LiteLLM raw map (or seed snapshot which
// uses the same field names). Skips meta keys starting with "_".
function buildLitellmPerMillionMap(rawData) {
  if (!rawData || typeof rawData !== "object") return {};
  const out = {};
  for (const [name, entry] of Object.entries(rawData)) {
    if (name.startsWith("_")) continue;
    const converted = convertLitellmEntry(entry);
    if (converted) out[name] = converted;
  }
  return out;
}

module.exports = {
  lookupPricing,
  stripReasoningSuffix,
  stripVendorRenameNoise,
  normalizeAntigravityModel,
  convertLitellmEntry,
  buildLitellmPerMillionMap,
};
