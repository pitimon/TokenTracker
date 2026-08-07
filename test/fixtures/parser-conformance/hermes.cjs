"use strict";

// Conformance fixture for parseHermesIncremental.
//
// This one was on the allowlist because Hermes reads a SQLite database across
// profile directories rather than a JSONL file, and the note said a fixture
// "needs a real schema, not a JSONL line". It does — so this builds one.
//
// The package supports Node 20, where `node:sqlite` is unavailable. Build the
// deterministic fixture through the sqlite3 CLI instead—the same primary reader
// used by production before its newer-runtime `node:sqlite` fallback. The
// minimum-Node CI job installs sqlite3 explicitly so this fixture cannot skip.
//
// Schema taken from the parser's own query (rollout.js:3216), not guessed:
//   SELECT id, model, started_at, ended_at, input_tokens, output_tokens,
//          cache_read_tokens, cache_write_tokens, reasoning_tokens, message_count
//   FROM sessions
//   WHERE (started_at >= <cursor> OR ended_at IS NULL) AND (any token > 0)
//
// `started_at` / `ended_at` are epoch SECONDS; the bucket comes from
// `ended_at ?? started_at`.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCHEMA = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    model TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    reasoning_tokens INTEGER,
    message_count INTEGER
  );
`;

// Fixed instants so the 30-minute bucket is deterministic rather than whatever
// the clock says when CI runs.
const STARTED = Math.floor(Date.parse("2026-05-14T09:12:30.000Z") / 1000);
const ENDED = Math.floor(Date.parse("2026-05-14T09:20:00.000Z") / 1000);

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite SQLite fixture value: ${value}`);
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function writeDb(dbPath, rows) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const columns = [
    "id",
    "model",
    "started_at",
    "ended_at",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "message_count",
  ];
  const inserts = rows.map((row) => (
    `INSERT INTO sessions (${columns.join(", ")}) VALUES (${columns.map((column) => sqlValue(row[column])).join(", ")});`
  ));
  const result = spawnSync("sqlite3", [dbPath], {
    input: `${SCHEMA}\n${inserts.join("\n")}\n`,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`sqlite3 fixture build failed: ${result.error?.message || result.stderr || `status ${result.status}`}`);
  }
}

module.exports = {
  source: "hermes",
  parser: "parseHermesIncremental",
  build(dir) {
    const hermesPath = path.join(dir, "hermes");

    writeDb(path.join(hermesPath, "state.db"), [
      {
        id: "hermes-session-finished",
        model: "claude-sonnet-5",
        started_at: STARTED,
        ended_at: ENDED,
        input_tokens: 4200,
        output_tokens: 810,
        cache_read_tokens: 15000,
        cache_write_tokens: 300,
        reasoning_tokens: 120,
        message_count: 14,
      },
      // A session with no cache or reasoning columns filled: the row must still
      // satisfy the column sum rather than be excused from it.
      {
        id: "hermes-session-plain",
        model: "claude-sonnet-5",
        started_at: STARTED,
        ended_at: ENDED,
        input_tokens: 90,
        output_tokens: 10,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        message_count: 2,
      },
    ]);

    // The profile directory walk is the part unique to this parser — a second
    // database under profiles/<name>/state.db has to be picked up too, and a
    // profile with no state.db must be skipped rather than throw.
    writeDb(path.join(hermesPath, "profiles", "work", "state.db"), [
      {
        id: "hermes-session-work-profile",
        model: "claude-opus-5",
        started_at: STARTED,
        ended_at: ENDED,
        input_tokens: 500,
        output_tokens: 60,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 40,
        message_count: 3,
      },
    ]);
    fs.mkdirSync(path.join(hermesPath, "profiles", "empty"), { recursive: true });

    return { hermesPath };
  },
};
