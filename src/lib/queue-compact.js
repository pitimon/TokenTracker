"use strict";

// Compaction for the append-only queue, and the row invariant that lived in
// prose.
//
// Measured on a real install: 34,492 lines, 5,595 unique keys, 28,897
// superseded (83.8%), 11 MB. Five sixths of the file is dead weight, and
// `readQueueData` in local-api.js re-reads and re-dedups ALL of it on every
// endpoint call — a dashboard refresh hits 6-8 endpoints, auto-refresh defaults
// to 30s. Nothing ever reclaims it; the only rewrite in the codebase is a
// one-off migration.
//
// The design risk here is close to zero for one reason: THE READERS ALREADY
// DEFINE THE OUTPUT. `readQueueData` keeps the last row per
// `source|model|hour_start`. Compaction only has to produce what every reader
// already computes, so it keeps the last RAW LINE per key — not a re-serialised
// row. Byte-identical API responses then follow by construction rather than by
// luck, because the surviving bytes are the exact bytes the reader would have
// kept.

const fs = require("node:fs");
const path = require("node:path");

// Must match readQueueData in src/lib/local-api.js. If that key ever changes,
// this one has to change with it — a test asserts they agree on real rows.
function queueRowKey(row) {
  return `${row.source || ""}|${row.model || ""}|${row.hour_start || ""}`;
}

const TOKEN_COLUMNS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cached_input_tokens",
  "reasoning_output_tokens",
];

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

// Codex and every-code report reasoning tokens that are ALREADY COUNTED inside
// output_tokens, so their total_tokens correctly excludes the reasoning column —
// adding it would count those tokens twice.
//
// This is not a special case invented here. `computeRowCost` in
// src/lib/pricing/index.js:309 makes exactly the same distinction, and charges
// reasoning at zero for these two sources for the same reason.
//
// Found by running this check against a real 34,922-row queue: 8,236 rows
// "violated" the invariant, every one of them source=codex, and in every case
// the difference was exactly reasoning_output_tokens. The rows were right, the
// check was wrong, and so was the prose it came from — CLAUDE.md said "sum of
// all columns" with no exception. Corrected there too.
const REASONING_FOLDED_INTO_OUTPUT = new Set(["codex", "every-code"]);

function expectedTotal(row) {
  const folded = REASONING_FOLDED_INTO_OUTPUT.has(String(row.source || "").toLowerCase());
  return TOKEN_COLUMNS.reduce((acc, column) => {
    if (folded && column === "reasoning_output_tokens") return acc;
    const value = Number(row[column] ?? 0);
    return acc + (Number.isFinite(value) ? value : 0);
  }, 0);
}

// Decides which lines survive, without touching the disk. Split out so the
// decision is testable on its own and so `analyze` and `compact` cannot drift.
//
// Malformed lines are KEPT. They are invisible to every reader already, so
// dropping them would not change a single API response — but it would destroy
// bytes nobody has looked at, and a partial write worth investigating is
// exactly the kind of thing that should survive a routine maintenance command.
function planCompaction(raw) {
  const lines = raw.split("\n");
  const keep = new Set();
  const lastForKey = new Map();
  let parseable = 0;
  let malformed = 0;

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      malformed += 1;
      keep.add(index);
      return;
    }
    parseable += 1;
    lastForKey.set(queueRowKey(row), index);
  });

  for (const index of lastForKey.values()) keep.add(index);

  const kept = [...keep].sort((a, b) => a - b);
  return {
    lines: kept.map((index) => lines[index]),
    stats: {
      totalLines: parseable + malformed,
      parseable,
      malformed,
      uniqueKeys: lastForKey.size,
      superseded: parseable - lastForKey.size,
      keptLines: kept.length,
    },
  };
}

function analyzeQueue(queuePath) {
  let raw;
  try {
    raw = fs.readFileSync(queuePath, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") {
      return { totalLines: 0, parseable: 0, malformed: 0, uniqueKeys: 0, superseded: 0, keptLines: 0, ratio: 0, bytes: 0 };
    }
    throw e;
  }
  const { stats } = planCompaction(raw);
  return {
    ...stats,
    ratio: stats.parseable > 0 ? stats.superseded / stats.parseable : 0,
    bytes: Buffer.byteLength(raw, "utf8"),
  };
}

// Writes to a temp file in the same directory and renames over the original.
// Same atomic-replace pattern the project-queue rewrite already uses. An
// interrupt between write and rename leaves the original untouched — the temp
// file is the only casualty.
//
// The CALLER holds the sync lock. This does not take it, because the lock is
// per-invocation state owned by the sync command, and a second acquisition
// inside would deadlock against the first.
function compactQueue(queuePath) {
  let raw;
  try {
    raw = fs.readFileSync(queuePath, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return { changed: false, reason: "no queue file" };
    throw e;
  }

  const before = Buffer.byteLength(raw, "utf8");
  const { lines, stats } = planCompaction(raw);
  if (stats.superseded === 0) {
    return { changed: false, reason: "nothing superseded", ...stats, bytesBefore: before, bytesAfter: before };
  }

  const out = lines.join("\n") + "\n";
  const tmp = path.join(
    path.dirname(queuePath),
    `${path.basename(queuePath)}.compact.${process.pid}.tmp`,
  );
  fs.writeFileSync(tmp, out, "utf8");
  try {
    fs.renameSync(tmp, queuePath);
  } catch (e) {
    fs.unlinkSync(tmp);
    throw e;
  }

  return {
    changed: true,
    ...stats,
    bytesBefore: before,
    bytesAfter: Buffer.byteLength(out, "utf8"),
  };
}

// CLAUDE.md states the column invariant in prose:
//
//   total = input + output + cache_creation + cache_read + reasoning
//
// Nothing enforced it at runtime. A miswritten or corrupt row was aggregated and
// rendered, not flagged — and a parser bug of exactly this shape is the class
// CLAUDE.md records at 1.6-7x magnitude. Same conversion as the curated-expiry
// and version-lockstep checks: a rule that lived in a document starts running.
//
// Returns one finding per violating row, capped by the caller.
function findRowViolations(rows) {
  const findings = [];
  rows.forEach((row, index) => {
    const where = `row ${index + 1} (${row.source || "?"}|${row.model || "?"}|${row.hour_start || "?"})`;

    for (const column of TOKEN_COLUMNS) {
      const value = Number(row[column] ?? 0);
      if (!Number.isFinite(value)) {
        findings.push(`${where}: ${column} is not a number (${JSON.stringify(row[column])})`);
      } else if (value < 0) {
        findings.push(`${where}: ${column} is negative (${value})`);
      }
    }

    const sum = expectedTotal(row);
    const total = Number(row.total_tokens ?? 0);
    if (Number.isFinite(total) && total !== sum) {
      findings.push(`${where}: total_tokens ${total} != expected ${sum}`);
    }

    const bucket = Date.parse(row.hour_start);
    if (!Number.isFinite(bucket)) {
      findings.push(`${where}: hour_start is not a timestamp`);
    } else if (bucket % THIRTY_MINUTES_MS !== 0) {
      findings.push(`${where}: hour_start is not on a 30-minute UTC boundary`);
    }
  });
  return findings;
}

module.exports = {
  queueRowKey,
  expectedTotal,
  REASONING_FOLDED_INTO_OUTPUT,
  planCompaction,
  analyzeQueue,
  compactQueue,
  findRowViolations,
  TOKEN_COLUMNS,
  THIRTY_MINUTES_MS,
};
