#!/usr/bin/env node
"use strict";

// Captures ONE REAL RESPONSE per usage-limits provider, sanitizes it, and writes
// it where a fixture test can read it.
//
// Why this exists, rather than a set of hand-written fixtures: usage-limits.js
// talks to nine providers' undocumented private endpoints. A fixture written
// from reading our own normalizer only encodes our reading of it — it is green
// whether or not the provider ever sends those fields. The lesson that named
// this is blunt about it: "a mock payload proves render logic, never
// data-source presence."
//
// Only the person with the credentials can produce the real thing, so this is
// the tool that lets them, in one command, without hand-editing JSON.
//
//   node scripts/capture-limits-fixtures.cjs           # capture + sanitize + write
//   node scripts/capture-limits-fixtures.cjs --dry-run # print, write nothing
//
// SANITISATION IS ALLOWLIST-SHAPED, NOT BLOCKLIST-SHAPED. Anything that is not
// provably safe to keep is replaced. A blocklist would leak the first field
// nobody thought of, and these payloads are about to enter a public repository.
//
// It does not commit anything. It prints what it wrote and what it redacted so
// the output can be read before `git add` — the review is the point.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { getUsageLimits } = require("../src/lib/usage-limits");

const OUT_DIR = path.resolve(__dirname, "..", "test", "fixtures", "usage-limits");
const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------

// Keys whose value is kept verbatim regardless of type. Everything here is a
// quota shape — counts, limits, window boundaries, resource labels. None of it
// identifies a person.
// Key matching is SEGMENT-WISE, and the segments come from both naming
// conventions. These APIs mix them: Gemini and Kimi are camelCase
// (`remainingFraction`, `resetTime`), the ChatGPT one is snake_case
// (`limit_window_seconds`).
//
// A snake_case-only regex quietly got this wrong: `remainingFraction` did not
// match `remaining`, so a real 0.94 quota figure was bucketed to 0, and
// `tokenType` matched the credential word `token` and was redacted although it
// is a category label. Both were found by running the researched real shapes
// through it before pointing it at an account.
function keySegments(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Words that make a key a quota shape — counts, limits, window boundaries,
// resource labels. None of them identifies a person.
const SAFE_WORDS = new Set([
  "used", "usage", "usages", "utilization", "utilisation", "limit", "limits",
  "remaining", "quota", "percent",
  "percentage", "total", "totals", "count", "max", "min", "window", "windows",
  "reset", "resets", "expires", "expiry", "start", "starts", "end", "ends",
  "seconds", "minutes", "hours", "days", "time", "unit", "units", "type", "kind",
  "status", "state", "enabled", "active", "allowed", "exceeded", "overage",
  "tier", "level", "interval", "period", "granted", "consumed", "balance",
  "credits", "requests", "tokens", "messages", "fraction", "ratio", "amount",
  "entitlement", "entitlements", "snapshot", "snapshots", "group", "groups",
  "bucket", "buckets", "detail", "details", "duration", "model", "models", "plan",
]);

// Words that make a key identifying, whatever it contains.
const IDENTIFYING_WORDS = new Set([
  "token", "secret", "key", "password", "credential", "credentials", "auth",
  "cookie", "session", "bearer", "jwt", "email", "mail", "phone", "address",
  "user", "users", "account", "customer", "owner", "member", "membership",
  "org", "organisation", "organization", "team", "workspace", "project",
  "tenant", "subscription", "invoice", "billing", "payment", "card", "login",
  "handle", "nickname", "avatar", "url", "uri", "endpoint", "host", "ip", "id",
  // `name` is here and `tier`/`plan` are in SAFE_WORDS, so the qualification
  // rule below keeps `currentTier.name` (a tier label) while redacting
  // `display_name` (a person). Dropping `name` from this list to save the first
  // one let the second one through — caught by the hostile-payload test.
  "name",
]);

// `tokenType` is a category; `accessToken` is a credential. The difference is
// whether a SAFE word qualifies the identifying one, so a key counts as safe
// when any segment is safe and no segment is identifying-without-qualification.
// `parentKey` matters for the bare `id` and `name` cases, which are the two most
// common keys in these payloads and mean opposite things depending on what they
// hang off. `currentTier.id` is the tier label gemini-cli reads; `user.id` is an
// account identifier. Without the parent, keeping both leaks and redacting both
// throws away the field the normalizer actually uses.
function classifyKey(key, parentKey = "") {
  const segments = keySegments(key);
  if (segments.length === 1 && (segments[0] === "id" || segments[0] === "name")) {
    const parent = keySegments(parentKey);
    if (parent.some((w) => SAFE_WORDS.has(w)) && !parent.some((w) => IDENTIFYING_WORDS.has(w))) {
      return "safe";
    }
    return "identifying";
  }
  const identifying = segments.filter((w) => IDENTIFYING_WORDS.has(w));
  const safe = segments.filter((w) => SAFE_WORDS.has(w));
  if (identifying.length === 0) return safe.length > 0 ? "safe" : "unknown";
  // A single identifying word next to a safe one is a label (`tokenType`,
  // `usageLimit`). Two or more, or one on its own, is an identifier
  // (`accountId`, `userEmail`, `token`).
  if (identifying.length === 1 && safe.length > 0) return "safe";
  return "identifying";
}

// Keys that are identifying by name, whatever they contain.

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const JWT = /^ey[A-Za-z0-9_-]{8,}\./;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_OPAQUE = /^[A-Za-z0-9_\-+/=]{24,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/;

// A reset time is quota shape and has to survive. Its SUB-MINUTE PRECISION does
// not: `2026-04-11T07:00:00.528743+00:00` is unique to one account's billing
// cycle, so a set of these correlates a fixture back to whoever produced it even
// though no field is an identifier. Truncating to the minute keeps everything a
// normalizer parses and drops the fingerprint.
function roundTimestamp(value, keyPath) {
  const rounded = value.replace(
    /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}):[\d.]+(.*)$/,
    (_m, head, tail) => `${head}:00${tail ? "Z" : ""}`,
  );
  if (rounded !== value) note(keyPath, "timestamp truncated to the minute");
  return rounded;
}

const redactions = [];

function note(pathStr, why) {
  redactions.push({ path: pathStr, why });
}

// A string is kept only when it is recognisably NOT an identifier: a timestamp,
// or a short lowercase enum-ish token like "pro", "five_hour", "active".
function sanitizeString(value, keyPath, keyName, parentKey) {
  if (classifyKey(keyName, parentKey) === "identifying") {
    note(keyPath, `key name looks identifying (${keyName})`);
    return "<redacted>";
  }
  if (EMAIL.test(value)) {
    note(keyPath, "value looks like an email address");
    return "<redacted-email>";
  }
  if (JWT.test(value)) {
    note(keyPath, "value looks like a JWT");
    return "<redacted-jwt>";
  }
  if (UUID.test(value)) {
    note(keyPath, "value looks like a UUID");
    return "<redacted-uuid>";
  }
  if (ISO_DATE.test(value)) return roundTimestamp(value, keyPath);
  if (LONG_OPAQUE.test(value)) {
    note(keyPath, `value is a long opaque string (${value.length} chars)`);
    return "<redacted-opaque>";
  }
  if (value.length > 64) {
    note(keyPath, `value is long free text (${value.length} chars)`);
    return "<redacted-text>";
  }
  return value;
}

// Numbers are kept only under a quota-shaped key. A bare number under an
// identifying or unrecognised key can be an account id, so it is bucketed to a
// magnitude rather than kept or dropped — the shape survives, the value does not.
function sanitizeNumber(value, keyPath, keyName, parentKey) {
  const kind = classifyKey(keyName, parentKey);
  if (kind === "safe") return value;
  if (kind === "identifying") {
    note(keyPath, `numeric value under an identifying key (${keyName})`);
    return 0;
  }
  note(keyPath, `numeric value under an unrecognised key (${keyName}) — bucketed`);
  return Number.isInteger(value) ? Math.sign(value) * String(Math.abs(value)).length : 0;
}

function sanitize(value, keyPath = "$", keyName = "", parentKey = "") {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return sanitizeNumber(value, keyPath, keyName, parentKey);
  if (typeof value === "string") return sanitizeString(value, keyPath, keyName, parentKey);
  if (Array.isArray(value)) {
    // Two elements are enough to show it is a list and that the elements share a
    // shape. Keeping all of them multiplies the disclosure surface for nothing.
    return value.slice(0, 2).map((item, i) => sanitize(item, `${keyPath}[${i}]`, keyName, parentKey));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = sanitize(inner, `${keyPath}.${key}`, key, keyName);
    }
    return out;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

const captured = [];

function recordingFetch(realFetch) {
  return async function capturingFetch(input, init) {
    const url = typeof input === "string" ? input : String(input?.url || input);
    const response = await realFetch(input, init);
    // Read the body from a CLONE so the caller still gets an unconsumed stream.
    let body = null;
    let parseError = null;
    try {
      body = await response.clone().json();
    } catch (e) {
      parseError = e?.message || String(e);
    }
    captured.push({ url, status: response.status, body, parseError });
    return response;
  };
}

// Only commands that ARE a provider quota query. Discovery commands are run too
// — `ps -ax` to find the Antigravity process, `lsof` to find its port, `which` to
// test for a binary — and their output is the machine's process list and open
// files: absolute paths, project names, every other tool the user is running.
//
// The first version of this captured all of them. The ps output survived only
// because an email address happened to appear in it and took the whole string
// with it. A capture tool for a privacy-first product must not be one lucky
// regex away from committing a process list.
const CAPTURABLE_COMMAND = /(^|\/)kiro(-cli)?$/;

function recordingCommandRunner(realRunner) {
  return function capturingRunner(command, args, options) {
    const result = realRunner(command, args, options);
    if (CAPTURABLE_COMMAND.test(String(command))) {
      captured.push({
        url: `command:${command} ${(args || []).join(" ")}`,
        status: result?.status ?? null,
        text: typeof result?.stdout === "string" ? result.stdout : null,
      });
    }
    return result;
  };
}

// A URL identifies its provider by host, which is the only mapping that does not
// have to be kept in step with the internals of getUsageLimits.
const PROVIDER_BY_HOST = [
  [/(^|\.)anthropic\.com$/, "claude"],
  [/(^|\.)chatgpt\.com$/, "codex"],
  [/(^|\.)cursor\.com$/, "cursor"],
  [/(^|\.)kimi\.com$/, "kimi"],
  [/(^|\.)z\.ai$/, "zai"],
  [/(^|\.)googleapis\.com$/, "gemini"],
  [/(^|\.)github\.com$/, "copilot"],
];

function providerFor(entry) {
  if (entry.url.startsWith("command:")) {
    if (entry.url.includes("kiro")) return "kiro";
    return "command";
  }
  let host = "";
  try {
    host = new URL(entry.url).hostname;
  } catch {
    return "unknown";
  }
  for (const [pattern, provider] of PROVIDER_BY_HOST) {
    if (pattern.test(host)) return provider;
  }
  return host.replace(/[^a-z0-9]+/gi, "-");
}

async function main() {
  const cp = require("node:child_process");
  const realFetch = globalThis.fetch;

  process.stdout.write("Capturing one real response per provider…\n\n");

  await getUsageLimits({
    home: os.homedir(),
    env: process.env,
    fetchImpl: recordingFetch(realFetch),
    commandRunner: recordingCommandRunner(cp.spawnSync),
    providerTimeoutMs: 15000,
  });

  if (captured.length === 0) {
    process.stdout.write(
      "Nothing was captured. Every provider was skipped for want of a credential,\n" +
        "so there is nothing to sanitize — sign in to at least one and re-run.\n",
    );
    return;
  }

  const byProvider = new Map();
  for (const entry of captured) {
    const provider = providerFor(entry);
    // First response per provider is enough; later ones are refreshes.
    if (!byProvider.has(provider)) byProvider.set(provider, entry);
  }

  if (!DRY_RUN) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [provider, entry] of [...byProvider].sort()) {
    redactions.length = 0;
    const fixture = {
      _README:
        "Captured from a live account and sanitized by scripts/capture-limits-fixtures.cjs. " +
        "Values are redacted allowlist-style: anything not provably a quota shape was replaced. " +
        "This proves the normalizer's reading of a REAL payload, not upstream drift — the provider " +
        "can change this shape without notice and nothing here will notice.",
      _captured_at: new Date().toISOString().slice(0, 10),
      _source: entry.url.startsWith("command:") ? entry.url : new URL(entry.url).origin + new URL(entry.url).pathname,
      _status: entry.status,
      response:
        entry.text != null
          ? { _kind: "text", text: sanitizeString(entry.text, "$.text", "text") }
          : entry.body != null
            ? sanitize(entry.body)
            : { _kind: "unparseable", error: entry.parseError },
    };

    const file = path.join(OUT_DIR, `${provider}.json`);
    const json = JSON.stringify(fixture, null, 2) + "\n";

    process.stdout.write(`── ${provider}  (${entry.status ?? "no status"})\n`);
    process.stdout.write(`   ${fixture._source}\n`);
    process.stdout.write(`   ${redactions.length} value(s) redacted\n`);
    for (const r of redactions.slice(0, 8)) {
      process.stdout.write(`     ${r.path}  — ${r.why}\n`);
    }
    if (redactions.length > 8) {
      process.stdout.write(`     … and ${redactions.length - 8} more\n`);
    }
    if (DRY_RUN) {
      process.stdout.write(`${json}\n`);
    } else {
      fs.writeFileSync(file, json);
      process.stdout.write(`   wrote ${path.relative(process.cwd(), file)}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(
    DRY_RUN
      ? "Dry run — nothing written.\n"
      : "READ THESE FILES BEFORE COMMITTING THEM. The sanitizer is deliberately\n" +
          "aggressive, but it cannot know which field your provider decided to put an\n" +
          "account name in this week. Nothing has been staged.\n",
  );
}

main().catch((error) => {
  process.stderr.write(`capture failed: ${error?.stack || error}\n`);
  process.exitCode = 1;
});
