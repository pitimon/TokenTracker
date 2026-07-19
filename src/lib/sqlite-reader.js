const cp = require("node:child_process");
const fssync = require("node:fs");

const warnedSqliteReadFailures = new Set();

function isDebugEnabled(env = process.env) {
  const value = String((env && env.TOKENTRACKER_DEBUG) || "").toLowerCase();
  return value === "1" || value === "true";
}

function formatError(err) {
  if (!err) return "unknown error";
  return err && err.message ? err.message : String(err);
}

function warnSqliteUnavailable({ dbPath, label, cliError, nodeSqliteError, env, stderr }) {
  const key = `${label || "SQLite"}:${dbPath || ""}`;
  if (warnedSqliteReadFailures.has(key)) return;
  warnedSqliteReadFailures.add(key);

  const out = stderr && typeof stderr.write === "function" ? stderr : process.stderr;
  const displayLabel = label || "local";
  out.write(
    `[tokentracker] Cannot read ${displayLabel} SQLite database. Install sqlite3 CLI and add it to PATH, or use Node.js 22+ with node:sqlite support. Path: ${dbPath}\n`,
  );
  if (isDebugEnabled(env)) {
    out.write(`[tokentracker] sqlite3 CLI failed: ${formatError(cliError)}\n`);
    out.write(`[tokentracker] node:sqlite failed: ${formatError(nodeSqliteError)}\n`);
  }
}

function readSqliteRowsWithCli(dbPath, sql, { execFileSync, timeout, maxBuffer }) {
  const raw = execFileSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer,
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!raw || !raw.trim()) return [];
  const rows = JSON.parse(raw);
  return Array.isArray(rows) ? rows : [];
}

function isSqliteCliUnavailable(err) {
  const message = formatError(err).toLowerCase();
  return (
    err?.code === "ENOENT" ||
    message.includes("spawn sqlite3 enoent") ||
    message.includes("sqlite3 enoent") ||
    message.includes("not recognized as an internal or external command")
  );
}

function isNodeSqliteUnavailable(err) {
  const message = formatError(err).toLowerCase();
  return (
    message.includes("no such built-in module") ||
    message.includes("cannot find module 'node:sqlite'") ||
    message.includes('cannot find module "node:sqlite"') ||
    message.includes("node:sqlite databasesync is unavailable")
  );
}

function readSqliteRowsWithNode(dbPath, sql, { requireFn }) {
  const { DatabaseSync } = requireFn("node:sqlite");
  if (typeof DatabaseSync !== "function") {
    throw new Error("node:sqlite DatabaseSync is unavailable");
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(sql).all();
    return Array.isArray(rows) ? rows : [];
  } finally {
    db.close();
  }
}

// Why `rows` alone is not enough for some callers: an empty array is returned
// for five materially different situations — bad arguments, an unstattable
// path, an absent database, a database that read cleanly and is genuinely
// empty, and a database that exists but could not be read by either backend.
// A caller that only ADDS what it finds may treat all five alike, because the
// worst case is doing nothing. A caller that RECONCILES (applies the delta
// between what it finds and what it previously recorded) must not: "unreadable"
// would look like "everything was deleted" and subtract real data. `reason`
// exists so such a caller can bail out instead.
//
// `ok` is true only for READ_OK, i.e. only when `rows` faithfully represents
// the database contents.
// UNREADABLE and QUERY_FAILED are deliberately distinct even though every
// consumer today treats both as "do not reconcile": the module already
// separates them to decide whether to warn (a missing sqlite backend is
// actionable by the user; a failed query is not), and they call for different
// remedies — install sqlite3 vs. the upstream schema moved.
const SQLITE_READ_OK = "read";
const SQLITE_READ_MISSING = "missing";
const SQLITE_READ_UNREADABLE = "unreadable";
const SQLITE_READ_QUERY_FAILED = "query-failed";
const SQLITE_READ_INVALID_ARGS = "invalid-args";
const SQLITE_READ_STAT_FAILED = "stat-failed";

function sqliteReadResult(reason, rows = []) {
  return { ok: reason === SQLITE_READ_OK, reason, rows };
}

function readSqliteJsonRowsWithStatus(dbPath, sql, options = {}) {
  if (!dbPath || !sql) return sqliteReadResult(SQLITE_READ_INVALID_ARGS);
  try {
    if (!fssync.existsSync(dbPath)) return sqliteReadResult(SQLITE_READ_MISSING);
  } catch (_e) {
    return sqliteReadResult(SQLITE_READ_STAT_FAILED);
  }
  const execFileSync = options.execFileSync || cp.execFileSync;
  const requireFn = options.requireFn || require;
  const env = options.env || process.env;
  const timeout = Number.isFinite(options.timeout) ? options.timeout : 30_000;
  const maxBuffer = Number.isFinite(options.maxBuffer) ? options.maxBuffer : 50 * 1024 * 1024;
  const label = options.label || "local";

  let cliError = null;
  try {
    return sqliteReadResult(SQLITE_READ_OK, readSqliteRowsWithCli(dbPath, sql, { execFileSync, timeout, maxBuffer }));
  } catch (err) {
    cliError = err;
  }

  let nodeSqliteError = null;
  try {
    return sqliteReadResult(SQLITE_READ_OK, readSqliteRowsWithNode(dbPath, sql, { requireFn }));
  } catch (err) {
    nodeSqliteError = err;
  }

  if (isSqliteCliUnavailable(cliError) && isNodeSqliteUnavailable(nodeSqliteError)) {
    warnSqliteUnavailable({
      dbPath,
      label,
      cliError,
      nodeSqliteError,
      env,
      stderr: options.stderr,
    });
    return sqliteReadResult(SQLITE_READ_UNREADABLE);
  }
  return sqliteReadResult(SQLITE_READ_QUERY_FAILED);
}

// Unchanged contract: rows only, empty array on every failure. Every existing
// caller keeps this behavior; only callers that must distinguish the failure
// modes reach for `readSqliteJsonRowsWithStatus`.
function readSqliteJsonRows(dbPath, sql, options = {}) {
  return readSqliteJsonRowsWithStatus(dbPath, sql, options).rows;
}

function readSqliteFirstValue(dbPath, sql, column, options = {}) {
  const rows = readSqliteJsonRows(dbPath, sql, options);
  const row = rows[0];
  if (!row || typeof row !== "object") return null;
  const key = typeof column === "string" && column.length > 0 ? column : Object.keys(row)[0];
  const value = row[key];
  return typeof value === "string" ? value.trim() : value == null ? null : String(value).trim();
}

function resetSqliteReaderWarningsForTests() {
  warnedSqliteReadFailures.clear();
}

module.exports = {
  readSqliteJsonRows,
  readSqliteJsonRowsWithStatus,
  readSqliteFirstValue,
  resetSqliteReaderWarningsForTests,
  SQLITE_READ_OK,
  SQLITE_READ_MISSING,
  SQLITE_READ_UNREADABLE,
  SQLITE_READ_QUERY_FAILED,
  SQLITE_READ_INVALID_ARGS,
  SQLITE_READ_STAT_FAILED,
};
