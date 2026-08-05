/**
 * Goose (Block) parser test.
 *
 * Builds synthetic sessions.db SQLite fixtures and verifies:
 *   - model_name extracted from model_config_json
 *   - accumulated_*_tokens takes precedence over single-turn *_tokens
 *   - reasoning_output_tokens = total - (input + output) when total exceeds
 *   - cumulative-delta accounting across runs (idempotent + grows correctly)
 *   - created_at parsed across RFC3339, "YYYY-MM-DD HH:MM:SS", and date-only
 *   - Missing optional columns (older Goose schemas) tolerated
 *
 * Local machine has no Goose install, so we pass TOKENTRACKER_GOOSE_DB.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");

const {
  resolveGooseDbPath,
  parseGooseModelName,
  parseGooseCreatedAt,
  parseGooseIncremental,
} = require("../src/lib/rollout");

function makeGooseDb({ rows, withAccumulated = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goose-test-"));
  const dbPath = path.join(dir, "sessions.db");
  const accCols = withAccumulated
    ? ", accumulated_total_tokens INTEGER, accumulated_input_tokens INTEGER, accumulated_output_tokens INTEGER"
    : "";
  const schema = `CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    model_config_json TEXT,
    provider_name TEXT,
    created_at TEXT NOT NULL,
    total_tokens INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER
    ${accCols}
  );`;
  cp.execFileSync("sqlite3", [dbPath, schema], { stdio: ["ignore", "ignore", "pipe"] });

  for (const row of rows) {
    const cols = withAccumulated
      ? "id, model_config_json, provider_name, created_at, total_tokens, input_tokens, output_tokens, accumulated_total_tokens, accumulated_input_tokens, accumulated_output_tokens"
      : "id, model_config_json, provider_name, created_at, total_tokens, input_tokens, output_tokens";
    const cfg = (row.model_config_json || "").replace(/'/g, "''");
    const provider = row.provider_name || "";
    const v = withAccumulated
      ? `'${row.id}', '${cfg}', '${provider}', '${row.created_at}', ${row.total_tokens ?? "NULL"}, ${row.input_tokens ?? "NULL"}, ${row.output_tokens ?? "NULL"}, ${row.accumulated_total_tokens ?? "NULL"}, ${row.accumulated_input_tokens ?? "NULL"}, ${row.accumulated_output_tokens ?? "NULL"}`
      : `'${row.id}', '${cfg}', '${provider}', '${row.created_at}', ${row.total_tokens ?? "NULL"}, ${row.input_tokens ?? "NULL"}, ${row.output_tokens ?? "NULL"}`;
    cp.execFileSync("sqlite3", [dbPath, `INSERT INTO sessions (${cols}) VALUES (${v});`], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  }
  return { dir, dbPath };
}

test("resolveGooseDbPath honors TOKENTRACKER_GOOSE_DB and GOOSE_PATH_ROOT", () => {
  assert.equal(
    resolveGooseDbPath({ TOKENTRACKER_GOOSE_DB: "/x/y/z.db" }),
    "/x/y/z.db",
  );
  const p = resolveGooseDbPath({ GOOSE_PATH_ROOT: "/opt/goose" });
  assert.match(p, /\/opt\/goose\/data\/sessions\/sessions\.db$/);
});

test("parseGooseModelName extracts model from JSON", () => {
  assert.equal(parseGooseModelName('{"model_name":"claude-3-7-sonnet"}'), "claude-3-7-sonnet");
  assert.equal(parseGooseModelName('{"model_name":"  o3-mini  "}'), "o3-mini");
  assert.equal(parseGooseModelName(""), null);
  assert.equal(parseGooseModelName("not-json"), null);
  assert.equal(parseGooseModelName('{"other":1}'), null);
});

test("parseGooseCreatedAt parses three formats", () => {
  assert.match(parseGooseCreatedAt("2026-05-21T14:30:00Z"), /^2026-05-21T14:30:00/);
  assert.match(parseGooseCreatedAt("2026-05-21 14:30:00"), /^2026-05-21T14:30:00/);
  assert.match(parseGooseCreatedAt("2026-05-21"), /^2026-05-21T00:00:00/);
  assert.equal(parseGooseCreatedAt(""), null);
  assert.equal(parseGooseCreatedAt("garbage"), null);
});

test("parseGooseIncremental: accumulated_* preferred over single-turn", async () => {
  const { dir, dbPath } = makeGooseDb({
    rows: [
      {
        id: "sess-1",
        model_config_json: '{"model_name":"claude-3-7-sonnet"}',
        provider_name: "anthropic",
        created_at: "2026-05-21T14:00:00Z",
        total_tokens: 100, // single-turn (latest) — should be ignored
        input_tokens: 80,
        output_tokens: 20,
        accumulated_total_tokens: 5000, // cumulative — wins
        accumulated_input_tokens: 4000,
        accumulated_output_tokens: 800,
      },
    ],
  });
  const queuePath = path.join(dir, "queue.jsonl");
  const cursors = {};
  const res = await parseGooseIncremental({ dbPath, cursors, queuePath });
  assert.equal(res.eventsAggregated, 1);
  const rows = fs
    .readFileSync(queuePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse)
    .filter((r) => r.source === "goose");
  assert.equal(rows[0].input_tokens, 4000);
  assert.equal(rows[0].output_tokens, 800);
  // total 5000 - (4000+800) = 200 → reasoning
  assert.equal(rows[0].reasoning_output_tokens, 200);
  assert.equal(rows[0].total_tokens, 5000);
  assert.equal(rows[0].model, "claude-3-7-sonnet");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseGooseIncremental: cumulative-delta across runs (no double-count)", async () => {
  const { dir, dbPath } = makeGooseDb({
    rows: [
      {
        id: "sess-grow",
        model_config_json: '{"model_name":"gpt-4o"}',
        provider_name: "openai",
        created_at: "2026-05-21T14:00:00Z",
        accumulated_total_tokens: 1000,
        accumulated_input_tokens: 800,
        accumulated_output_tokens: 200,
      },
    ],
  });
  const queuePath = path.join(dir, "queue.jsonl");
  const cursors = {};

  const res1 = await parseGooseIncremental({ dbPath, cursors, queuePath });
  assert.equal(res1.eventsAggregated, 1);

  const res2 = await parseGooseIncremental({ dbPath, cursors, queuePath });
  assert.equal(res2.eventsAggregated, 0, "second run is a no-op (cumulative unchanged)");

  // Now grow the session
  cp.execFileSync("sqlite3", [
    dbPath,
    "UPDATE sessions SET accumulated_total_tokens=3000, accumulated_input_tokens=2300, accumulated_output_tokens=700 WHERE id='sess-grow';",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const res3 = await parseGooseIncremental({ dbPath, cursors, queuePath });
  assert.equal(res3.eventsAggregated, 1);

  // The queue stores one append per bucket-write; the *latest* row per
  // (source, model, hour_start) wins downstream. After the growth, the last
  // row for this bucket reflects the full cumulative (1000 + 2000 = 3000).
  const rows = fs
    .readFileSync(queuePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse)
    .filter((r) => r.source === "goose");
  const latestByBucket = new Map();
  for (const r of rows) {
    latestByBucket.set(`${r.source}|${r.model}|${r.hour_start}`, r);
  }
  const finalTotal = Array.from(latestByBucket.values()).reduce((s, r) => s + r.total_tokens, 0);
  assert.equal(finalTotal, 3000, "latest-per-bucket equals final cumulative");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseGooseIncremental: later cumulative deltas use the observation bucket across midnight", async () => {
  const { dir, dbPath } = makeGooseDb({
    rows: [
      {
        id: "sess-cross-day",
        model_config_json: '{"model_name":"gpt-5.6-sol"}',
        provider_name: "openai",
        created_at: "2026-05-21T23:55:00Z",
        accumulated_total_tokens: 1000,
        accumulated_input_tokens: 800,
        accumulated_output_tokens: 150,
      },
    ],
  });
  const queuePath = path.join(dir, "queue.jsonl");
  const cursors = {};

  await parseGooseIncremental({
    dbPath,
    cursors,
    queuePath,
    now: () => new Date("2026-05-21T23:59:00Z"),
  });

  cp.execFileSync("sqlite3", [
    dbPath,
    "UPDATE sessions SET accumulated_total_tokens=3000, accumulated_input_tokens=2300, accumulated_output_tokens=600 WHERE id='sess-cross-day';",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  await parseGooseIncremental({
    dbPath,
    cursors,
    queuePath,
    now: () => new Date("2026-05-22T00:05:00Z"),
  });

  const rows = fs
    .readFileSync(queuePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse)
    .filter((row) => row.source === "goose" && row.model === "gpt-5.6-sol");
  const latestByBucket = new Map(rows.map((row) => [row.hour_start, row]));
  const columns = (row) => ({
    input: row?.input_tokens,
    output: row?.output_tokens,
    reasoning: row?.reasoning_output_tokens,
    total: row?.total_tokens,
    conversations: row?.conversation_count,
  });

  assert.deepEqual(columns(latestByBucket.get("2026-05-21T23:30:00.000Z")), {
    input: 800,
    output: 150,
    reasoning: 50,
    total: 1000,
    conversations: 1,
  });
  assert.deepEqual(columns(latestByBucket.get("2026-05-22T00:00:00.000Z")), {
    input: 1500,
    output: 450,
    reasoning: 50,
    total: 2000,
    conversations: 1,
  });

  const conserved = [...latestByBucket.values()].reduce(
    (totals, row) => {
      const values = columns(row);
      for (const key of Object.keys(totals)) totals[key] += values[key];
      return totals;
    },
    { input: 0, output: 0, reasoning: 0, total: 0, conversations: 0 },
  );
  assert.deepEqual(conserved, {
    input: 2300,
    output: 600,
    reasoning: 100,
    total: 3000,
    conversations: 2,
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseGooseIncremental: WAL-only database growth invalidates the change fingerprint", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goose-wal-test-"));
  const dbPath = path.join(dir, "sessions.db");
  const queuePath = path.join(dir, "queue.jsonl");
  const db = cp.spawn("sqlite3", [dbPath], { stdio: ["pipe", "pipe", "pipe"] });
  const lineReader = require("node:readline").createInterface({ input: db.stdout });
  const pending = new Map();
  let commandId = 0;
  let dbStderr = "";
  lineReader.on("line", (line) => {
    const resolve = pending.get(line);
    if (!resolve) return;
    pending.delete(line);
    resolve();
  });
  db.stderr.on("data", (chunk) => { dbStderr += chunk; });
  const failPending = (error) => {
    for (const [, resolve] of pending) resolve(error);
    pending.clear();
  };
  db.on("exit", (code) => {
    failPending(new Error(`sqlite3 exited ${code}: ${dbStderr}`));
  });
  db.on("error", failPending);
  db.stdin.on("error", failPending);
  const execInOpenDb = (sql) => new Promise((resolve, reject) => {
    const marker = `goose-wal-ready-${++commandId}`;
    pending.set(marker, (error) => (error ? reject(error) : resolve()));
    db.stdin.write(`${sql.trim()}\n.print ${marker}\n`);
  });

  try {
    await execInOpenDb(`
      .bail on
      PRAGMA journal_mode=WAL;
      PRAGMA wal_autocheckpoint=0;
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        model_config_json TEXT,
        provider_name TEXT,
        created_at TEXT NOT NULL,
        total_tokens INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        accumulated_total_tokens INTEGER,
        accumulated_input_tokens INTEGER,
        accumulated_output_tokens INTEGER
      );
      INSERT INTO sessions (
        id, model_config_json, provider_name, created_at,
        accumulated_total_tokens, accumulated_input_tokens, accumulated_output_tokens
      ) VALUES (
        'sess-wal', '{"model_name":"gpt-5.6-sol"}', 'openai', '2026-05-21T23:55:00Z',
        1000, 800, 150
      );
    `);

    const cursors = {};
    await parseGooseIncremental({
      dbPath,
      cursors,
      queuePath,
      now: () => new Date("2026-05-21T23:59:00Z"),
    });

    assert.equal(db.exitCode, null, `sqlite3 writer exited early: ${dbStderr}`);
    const mainMtimeBefore = fs.statSync(dbPath).mtimeMs;
    const walBefore = fs.statSync(`${dbPath}-wal`);
    await execInOpenDb(
      "UPDATE sessions SET accumulated_total_tokens=3000, accumulated_input_tokens=2300, accumulated_output_tokens=600 WHERE id='sess-wal';",
    );
    const mainMtimeAfter = fs.statSync(dbPath).mtimeMs;
    const walAfter = fs.statSync(`${dbPath}-wal`);

    assert.equal(mainMtimeAfter, mainMtimeBefore, "fixture must isolate the update in the WAL");
    assert.ok(
      walAfter.mtimeMs !== walBefore.mtimeMs || walAfter.size !== walBefore.size,
      "WAL fingerprint must change after the committed update",
    );

    const originalCopyFileSync = fs.copyFileSync;
    let failedSnapshotResult;
    try {
      fs.copyFileSync = (source, destination, ...args) => {
        if (source === `${dbPath}-wal`) {
          const error = new Error("simulated WAL copy failure");
          error.code = "EACCES";
          throw error;
        }
        return originalCopyFileSync(source, destination, ...args);
      };
      failedSnapshotResult = await parseGooseIncremental({
        dbPath,
        cursors,
        queuePath,
        now: () => new Date("2026-05-22T00:04:00Z"),
      });
    } finally {
      fs.copyFileSync = originalCopyFileSync;
    }
    assert.equal(failedSnapshotResult.eventsAggregated, 0, "incomplete snapshot must not emit");
    assert.equal(
      cursors.goose.lastDbFingerprint,
      null,
      "incomplete snapshot must invalidate the fast-path fingerprint",
    );

    const result = await parseGooseIncremental({
      dbPath,
      cursors,
      queuePath,
      now: () => new Date("2026-05-22T00:05:00Z"),
    });
    assert.equal(result.eventsAggregated, 1, "WAL-only growth must not be skipped");

    const rows = fs
      .readFileSync(queuePath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
      .filter((row) => row.source === "goose" && row.model === "gpt-5.6-sol");
    const latestByBucket = new Map(rows.map((row) => [row.hour_start, row]));
    assert.equal(latestByBucket.get("2026-05-21T23:30:00.000Z")?.total_tokens, 1000);
    assert.equal(latestByBucket.get("2026-05-22T00:00:00.000Z")?.total_tokens, 2000);
  } finally {
    if (db.exitCode == null && db.stdin.writable) {
      await new Promise((resolve) => {
        db.once("exit", resolve);
        db.stdin.end(".exit\n");
      });
    }
    lineReader.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseGooseIncremental: falls back to single-turn when accumulated_* absent (older schema)", async () => {
  const { dir, dbPath } = makeGooseDb({
    withAccumulated: false,
    rows: [
      {
        id: "old-sess",
        model_config_json: '{"model_name":"claude-3-haiku"}',
        provider_name: "anthropic",
        created_at: "2026-04-01T12:00:00Z",
        total_tokens: 500,
        input_tokens: 400,
        output_tokens: 100,
      },
    ],
  });
  const queuePath = path.join(dir, "queue.jsonl");
  const res = await parseGooseIncremental({ dbPath, cursors: {}, queuePath });
  assert.equal(res.eventsAggregated, 1, "older schema without accumulated_* still parses");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseGooseIncremental: skips rows with empty model_config_json", async () => {
  const { dir, dbPath } = makeGooseDb({
    rows: [
      {
        id: "sess-no-model",
        model_config_json: "",
        provider_name: "anthropic",
        created_at: "2026-05-01T00:00:00Z",
        accumulated_total_tokens: 1234,
      },
    ],
  });
  const queuePath = path.join(dir, "queue.jsonl");
  const res = await parseGooseIncremental({ dbPath, cursors: {}, queuePath });
  // Query filter `WHERE model_config_json IS NOT NULL AND TRIM(...) != ''`
  // already excludes empty model_config_json rows — recordsProcessed is 0
  assert.equal(res.recordsProcessed, 0);
  assert.equal(res.eventsAggregated, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseGooseIncremental: missing DB is a no-op", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goose-empty-"));
  const queuePath = path.join(dir, "queue.jsonl");
  const res = await parseGooseIncremental({
    dbPath: path.join(dir, "no-db.db"),
    cursors: {},
    queuePath,
  });
  assert.deepEqual(res, { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  fs.rmSync(dir, { recursive: true, force: true });
});
