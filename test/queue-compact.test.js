"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  queueRowKey,
  planCompaction,
  analyzeQueue,
  compactQueue,
  findRowViolations,
  expectedTotal,
} = require("../src/lib/queue-compact");

function tmpQueue(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-compact-"));
  const queuePath = path.join(dir, "queue.jsonl");
  fs.writeFileSync(
    queuePath,
    rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n",
  );
  return queuePath;
}

const row = (over = {}) => ({
  source: "claude",
  model: "claude-sonnet-5",
  hour_start: "2026-05-14T09:00:00.000Z",
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cached_input_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: 150,
  ...over,
});

// --- Compaction ---------------------------------------------------------------

test("compaction keeps the LAST row per key, which is what every reader computes", () => {
  const queuePath = tmpQueue([
    row({ input_tokens: 1, output_tokens: 0, total_tokens: 1 }),
    row({ input_tokens: 2, output_tokens: 0, total_tokens: 2 }),
    row({ input_tokens: 3, output_tokens: 0, total_tokens: 3 }),
  ]);
  const result = compactQueue(queuePath);
  assert.equal(result.changed, true);
  assert.equal(result.keptLines, 1);
  assert.equal(result.superseded, 2);
  const left = fs.readFileSync(queuePath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(left.length, 1);
  assert.equal(left[0].input_tokens, 3, "the surviving row must be the latest, not the first");
});

test("the surviving bytes are the ORIGINAL bytes, not a re-serialised row", () => {
  // This is what makes "byte-identical API responses" true by construction. A
  // re-serialised row could reorder keys, drop an unknown field a future reader
  // needs, or change number formatting.
  const original =
    '{"source":"claude","model":"m","hour_start":"2026-05-14T09:00:00.000Z","total_tokens":5,"input_tokens":5,"output_tokens":0,"an_unknown_future_field":{"z":1,"a":2}}';
  const queuePath = tmpQueue([JSON.stringify(row()), original]);
  compactQueue(queuePath);
  const lines = fs.readFileSync(queuePath, "utf8").trim().split("\n");
  assert.ok(lines.includes(original), "the exact original line must survive verbatim");
});

test("what the readers see is unchanged — the real test, not the line count", () => {
  // #103's definition of done. Reproduces readQueueData's dedup (same key,
  // keep-last) and asserts the result is identical before and after.
  const readerView = (queuePath) => {
    const seen = new Map();
    for (const line of fs.readFileSync(queuePath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      seen.set(queueRowKey(parsed), parsed);
    }
    return JSON.stringify([...seen.values()]);
  };

  const rows = [];
  for (let i = 1; i <= 40; i += 1) {
    rows.push(row({ input_tokens: i, total_tokens: i + 50 }));
    rows.push(
      row({
        source: "codex",
        model: "gpt-5.5",
        hour_start: "2026-05-14T09:30:00.000Z",
        input_tokens: i * 2,
        output_tokens: 10,
        reasoning_output_tokens: 4,
        total_tokens: i * 2 + 10,
      }),
    );
  }
  const queuePath = tmpQueue(rows);

  const before = readerView(queuePath);
  const result = compactQueue(queuePath);
  const after = readerView(queuePath);

  assert.equal(before, after, "compaction must not change a single byte of what readers compute");
  assert.equal(result.keptLines, 2, "80 rows across 2 keys collapse to 2");
});

test("an unparseable line is kept, not quietly destroyed", () => {
  // It is invisible to every reader already, so dropping it would change no API
  // response — but a partial write worth investigating should survive a routine
  // maintenance command.
  const queuePath = tmpQueue([row({ input_tokens: 1, total_tokens: 51 }), "{ truncated par", row()]);
  const result = compactQueue(queuePath);
  assert.equal(result.malformed, 1);
  assert.ok(
    fs.readFileSync(queuePath, "utf8").includes("{ truncated par"),
    "the unreadable bytes must still be there",
  );
});

test("compaction is a no-op when nothing is superseded", () => {
  const queuePath = tmpQueue([row(), row({ model: "other-model", total_tokens: 150 })]);
  const beforeBytes = fs.readFileSync(queuePath);
  const result = compactQueue(queuePath);
  assert.equal(result.changed, false);
  assert.deepEqual(fs.readFileSync(queuePath), beforeBytes, "the file must not be rewritten");
});

test("an interrupt between write and rename leaves the original intact", () => {
  // The reason this uses write-then-rename rather than writing in place. There
  // is no way to observe a half-written queue: the rename is atomic, so the file
  // is either entirely the old one or entirely the new one.
  const queuePath = tmpQueue([row({ input_tokens: 1, total_tokens: 51 }), row()]);
  const originalBytes = fs.readFileSync(queuePath);

  const realRename = fs.renameSync;
  fs.renameSync = () => {
    throw Object.assign(new Error("interrupted"), { code: "EIO" });
  };
  try {
    assert.throws(() => compactQueue(queuePath), /interrupted/);
  } finally {
    fs.renameSync = realRename;
  }

  assert.deepEqual(fs.readFileSync(queuePath), originalBytes, "the original must be untouched");
  const leftovers = fs.readdirSync(path.dirname(queuePath)).filter((f) => f.includes(".compact."));
  assert.deepEqual(leftovers, [], "the temp file must be cleaned up, not left behind");
});

test("analyze reports the ratio without touching the file", () => {
  const queuePath = tmpQueue([
    row({ input_tokens: 1, total_tokens: 51 }),
    row({ input_tokens: 2, total_tokens: 52 }),
    row({ model: "other", total_tokens: 150 }),
  ]);
  const bytes = fs.readFileSync(queuePath);
  const stats = analyzeQueue(queuePath);
  assert.equal(stats.parseable, 3);
  assert.equal(stats.uniqueKeys, 2);
  assert.equal(stats.superseded, 1);
  assert.ok(Math.abs(stats.ratio - 1 / 3) < 1e-9);
  assert.deepEqual(fs.readFileSync(queuePath), bytes);
});

test("a missing queue is not an error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-compact-"));
  const missing = path.join(dir, "queue.jsonl");
  assert.equal(analyzeQueue(missing).parseable, 0);
  assert.equal(compactQueue(missing).changed, false);
});

test("planCompaction and analyzeQueue cannot drift", () => {
  const raw = [row(), row({ input_tokens: 9, total_tokens: 59 })]
    .map((r) => JSON.stringify(r))
    .join("\n");
  const queuePath = tmpQueue([row(), row({ input_tokens: 9, total_tokens: 59 })]);
  assert.equal(planCompaction(raw).stats.superseded, analyzeQueue(queuePath).superseded);
});

// --- The row invariant ---------------------------------------------------------

test("the invariant flags a column-sum violation, a bad bucket and a negative count", () => {
  assert.deepEqual(findRowViolations([row()]), [], "a clean row produces no findings");

  const cases = {
    "total_tokens .* != expected": row({ total_tokens: 151 }),
    "is negative": row({ input_tokens: -5, total_tokens: 45 }),
    "not on a 30-minute UTC boundary": row({ hour_start: "2026-05-14T09:07:00.000Z" }),
    "is not a number": row({ output_tokens: "fifty" }),
  };
  for (const [pattern, bad] of Object.entries(cases)) {
    const findings = findRowViolations([bad]);
    assert.ok(
      findings.some((f) => new RegExp(pattern).test(f)),
      `expected a finding matching /${pattern}/, got ${JSON.stringify(findings)}`,
    );
  }
});

test("codex and every-code fold reasoning into output, and are not flagged for it", () => {
  // Found by running this check against a real 34,922-row queue: 8,236 rows
  // "violated" the invariant, every one source=codex, and in every case the
  // difference was exactly reasoning_output_tokens. The rows were right; the
  // check and the prose it came from were wrong. computeRowCost
  // (pricing/index.js:309) already made this distinction — it charges their
  // reasoning at zero for the same reason.
  const codexRow = row({
    source: "codex",
    model: "gpt-5.5",
    input_tokens: 100,
    output_tokens: 50,
    reasoning_output_tokens: 20,
    total_tokens: 150, // reasoning NOT added: it is already inside output_tokens
  });
  assert.deepEqual(findRowViolations([codexRow]), []);
  assert.equal(expectedTotal(codexRow), 150);

  // The same numbers from a source that does NOT fold must add up to 170, so the
  // exception is scoped and not a blanket loosening.
  const claudeRow = { ...codexRow, source: "claude" };
  assert.equal(expectedTotal(claudeRow), 170);
  assert.ok(findRowViolations([claudeRow]).some((f) => f.includes("!= expected 170")));
});
