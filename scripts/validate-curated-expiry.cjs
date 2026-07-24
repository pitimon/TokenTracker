// Fails when a time-boxed pricing fact in curated-overrides.json has passed its
// expiry date.
//
// Why this exists: `_meta` used to carry expiry dates as free-text prose ("update
// this file before the cutover"). Nothing read them, so deepseek-v4-pro stayed
// pinned to a 75%-off launch promo for 55 days after the promo ended — every
// DeepSeek row on the dashboard billed at 25% of its true cost, with no signal.
// A stale price is worse than a missing one: a missing price shows $0 and looks
// broken, a stale price looks fine forever. See issue #87.
//
// This turns "remember to edit a JSON file in May" into "the next PR fails".

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OVERRIDES_PATH = path.join(ROOT, "src", "lib", "pricing", "curated-overrides.json");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Any YYYY-MM-DD appearing anywhere inside a free-text note.
const DATE_IN_TEXT_RE = /\d{4}-\d{2}-\d{2}/;
const REQUIRED_FIELDS = ["id", "expires_at", "what", "action"];

// An expiry is due at UTC midnight on its date, so an entry dated 2026-08-31
// fails from the first moment of 2026-08-31 onward.
function parseExpiryMs(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  // Reject dates that round-trip differently (e.g. 2026-02-31 → Mar 3).
  if (new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms;
}

// Walks a _meta value of any shape so a date cannot hide one level down.
function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Pure: takes the parsed `_meta` object and a timestamp, returns findings.
// Exported so tests can drive it without touching the clock or the real file.
function checkExpiries(meta, nowMs) {
  const errors = [];

  if (meta == null || typeof meta !== "object") {
    return { errors: ["_meta is missing or not an object"], checked: 0 };
  }

  // Guard against regressing to the pattern this check replaced. Matching on
  // the key name alone was too weak — `promo_cutover: "2026-08-31 — update the
  // price"` would sail straight past a `*_expiry` name check and expire in
  // silence, which is the exact failure being designed out. So scan the VALUES:
  // any date-looking string parked in _meta is a time-boxed fact that belongs
  // in `expiries`, whatever its key is called.
  for (const [key, value] of Object.entries(meta)) {
    if (key === "expiries") continue;
    for (const text of collectStrings(value)) {
      if (DATE_IN_TEXT_RE.test(text)) {
        errors.push(
          `_meta.${key}: contains a date ("${text.slice(0, 60).trim()}…") but nothing enforces it. `
            + "Move the fact into the _meta.expiries array, or drop the date from the note.",
        );
        break;
      }
    }
  }

  const entries = meta.expiries;
  if (entries === undefined) return { errors, checked: 0 };
  if (!Array.isArray(entries)) {
    errors.push("_meta.expiries must be an array");
    return { errors, checked: 0 };
  }

  const seenIds = new Set();

  entries.forEach((entry, index) => {
    const label = `_meta.expiries[${index}]`;

    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label}: must be an object`);
      return;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!isNonEmptyString(entry[field])) {
        errors.push(`${label}: '${field}' is required and must be a non-empty string`);
      }
    }

    if (isNonEmptyString(entry.id)) {
      if (seenIds.has(entry.id)) errors.push(`${label}: duplicate id '${entry.id}'`);
      seenIds.add(entry.id);
    }

    const expiresMs = parseExpiryMs(entry.expires_at);
    if (expiresMs === null) {
      errors.push(`${label}: 'expires_at' must be a real calendar date as YYYY-MM-DD`);
      return;
    }

    if (nowMs >= expiresMs) {
      const daysPast = Math.floor((nowMs - expiresMs) / 86400000);
      errors.push(
        `${label} '${entry.id}' EXPIRED ${entry.expires_at} (${daysPast} day(s) ago)\n`
          + `    what:   ${entry.what}\n`
          + `    action: ${entry.action}\n`
          + "    Apply the action above, then remove or advance this entry.",
      );
    }
  });

  return { errors, checked: entries.length };
}

function main() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
  } catch (e) {
    console.error(`Curated expiry errors:\n- cannot read ${OVERRIDES_PATH}: ${e.message}`);
    process.exit(1);
  }

  const { errors, checked } = checkExpiries(parsed._meta, Date.now());

  if (errors.length) {
    console.error("Curated expiry errors:");
    errors.forEach((line) => console.error(`- ${line}`));
    process.exit(1);
  }

  console.log(`Curated expiry ok: ${checked} time-boxed entr${checked === 1 ? "y" : "ies"} still valid.`);
}

if (require.main === module) main();

module.exports = { checkExpiries, parseExpiryMs };
