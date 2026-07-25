"use strict";

// Parser conformance ratchet.
//
// Test coverage in this repo is inverted relative to risk. CLAUDE.md:169-172
// records the historical failure modes — dedup failures, cached-input
// semantics, snapshot-vs-cumulative confusion — as 1.6x to 7x magnitude errors
// in the numbers the whole product exists to report. That is the class with no
// gate: README:116 tells contributors "a new provider is usually one parser file
// away", and today that is true and unguarded.
//
// So this harness ENUMERATES THE PARSERS FROM SOURCE rather than from a
// hand-written list. A parser added without a fixture and without an allowlist
// entry fails here; it cannot be silently skipped. The allowlist is a ratchet
// that may only shrink, because an allowlist that can grow is a TODO list.
//
// What a fixture proves: the parser's OUTPUT satisfies the queue's column
// invariant, bucket alignment and non-negativity, and that parsing the same
// input twice does not double-count.
//
// What it does NOT prove, and this matters more than the list above: that the
// parser reads the provider's real format correctly. A parser that double-counts
// cache reads into input_tokens and inflates total_tokens to match is internally
// consistent — the column sum passes it while the number the user reads is
// several times too big. There is a test below that pins exactly that blind
// spot, so nobody reads this harness as covering more than it does. Only a real
// sample log with known-correct expected values catches it, which is what the
// per-tool tests are for. This is the floor under them, not a replacement.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const rollout = require("../src/lib/rollout");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "parser-conformance");
const ALLOWLIST = require("./fixtures/parser-conformance/allowlist.json");

// From source, not from Object.keys(rollout) — an export could be renamed or a
// parser could be defined and never exported, and either way the list has to
// reflect what is actually in the file.
function enumerateParsers() {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "rollout.js"), "utf8");
  return [...source.matchAll(/^(?:async\s+)?function\s+(parse\w*Incremental)\s*\(/gm)].map(
    (m) => m[1],
  );
}

function fixtureFor(parser) {
  for (const entry of fs.readdirSync(FIXTURE_DIR)) {
    if (!entry.endsWith(".cjs")) continue;
    const mod = require(path.join(FIXTURE_DIR, entry));
    if (mod.parser === parser) return mod;
  }
  return null;
}

function readQueue(queuePath) {
  if (!fs.existsSync(queuePath)) return [];
  return fs
    .readFileSync(queuePath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

const COLUMNS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cached_input_tokens",
  "reasoning_output_tokens",
];

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

function assertRowConforms(row, label) {
  for (const column of COLUMNS) {
    const value = Number(row[column] || 0);
    assert.ok(
      Number.isFinite(value) && value >= 0,
      `${label}: ${column} must be a non-negative number, got ${JSON.stringify(row[column])}`,
    );
  }
  // CLAUDE.md's "Token normalization" block, which lived in prose and nothing
  // enforced. A miswritten row was aggregated and rendered, not flagged.
  const sum = COLUMNS.reduce((acc, column) => acc + Number(row[column] || 0), 0);
  assert.equal(
    Number(row.total_tokens || 0),
    sum,
    `${label}: total_tokens must equal the sum of the columns`,
  );

  assert.ok(
    typeof row.model === "string" && row.model.trim().length > 0,
    `${label}: model must be present — "unknown" is the placeholder for "we did not record one" (#94)`,
  );

  const bucket = Date.parse(row.hour_start);
  assert.ok(Number.isFinite(bucket), `${label}: hour_start must be a timestamp`);
  assert.equal(
    bucket % THIRTY_MINUTES_MS,
    0,
    `${label}: hour_start must land on a 30-minute UTC boundary, got ${row.hour_start}`,
  );
}

const GOOD_ROW = {
  input_tokens: 600,
  output_tokens: 250,
  cache_creation_input_tokens: 100,
  cached_input_tokens: 2400,
  reasoning_output_tokens: 0,
  total_tokens: 3350,
  model: "claude-sonnet-5",
  hour_start: "2026-05-14T09:00:00.000Z",
};

test("the conformance check rejects the rows it exists to reject", () => {
  // A checker nothing has ever failed is a checker nobody has tested. Each case
  // below is one of the shapes CLAUDE.md records as having really happened.
  assert.doesNotThrow(() => assertRowConforms(GOOD_ROW, "control"));

  const rejects = {
    "column sum off — the invariant that lived only in prose": { total_tokens: 3351 },
    "a negative count": { input_tokens: -1, total_tokens: 2749 },
    "no model at all": { model: "" },
    "a bucket off the 30-minute boundary": { hour_start: "2026-05-14T09:07:00.000Z" },
  };
  for (const [label, override] of Object.entries(rejects)) {
    assert.throws(
      () => assertRowConforms({ ...GOOD_ROW, ...override }, label),
      assert.AssertionError,
      `the check must reject: ${label}`,
    );
  }
});

test("what the column invariant does NOT catch, stated rather than assumed", () => {
  // Worth pinning, because it is easy to read the invariant as covering more
  // than it does. A parser that double-counts cache reads into input_tokens AND
  // inflates total_tokens to match is internally consistent, so the column sum
  // passes it — while the number the user reads is 4x too big. That is the
  // cached-input-semantics class CLAUDE.md records at 1.6-7x magnitude.
  //
  // Nothing structural catches that. Only a real sample log with known-correct
  // expected values does, which is what the per-tool tests are for. This
  // harness is the floor under them, not a replacement.
  const doubleCounted = {
    ...GOOD_ROW,
    input_tokens: 3000, // should be 600: prompt_tokens minus the 2400 cache reads
    total_tokens: 5750, // inflated to match, so the sum still balances
  };
  assert.doesNotThrow(
    () => assertRowConforms(doubleCounted, "double-counted"),
    "if this ever throws, the harness got stronger and this note should be rewritten",
  );
});

const parsers = enumerateParsers();

test("the harness finds the parsers, so a rename cannot empty it", () => {
  assert.ok(parsers.length >= 20, `expected the full parser set, found ${parsers.length}`);
  assert.ok(parsers.includes("parseClaudeIncremental"));
});

test("every parser has a fixture or an allowlist entry — a new one cannot opt out", () => {
  const uncovered = parsers.filter(
    (parser) => !fixtureFor(parser) && !ALLOWLIST.parsers[parser],
  );
  assert.deepEqual(
    uncovered,
    [],
    `these parsers have neither a conformance fixture nor a recorded reason: ${uncovered.join(", ")}.` +
      ` Add test/fixtures/parser-conformance/<tool>.cjs, or add an entry to allowlist.json saying why not.`,
  );
});

test("the allowlist may only shrink", () => {
  const size = Object.keys(ALLOWLIST.parsers).length;
  assert.ok(
    size <= ALLOWLIST.max_size,
    `the allowlist grew to ${size}, above its committed ceiling of ${ALLOWLIST.max_size}.` +
      ` Write a fixture instead of raising the ceiling.`,
  );
  assert.equal(
    size,
    ALLOWLIST.max_size,
    `the allowlist is down to ${size} — lower max_size to ${size} in the same commit so the` +
      ` ratchet records the ground gained.`,
  );
});

test("no allowlist entry names a parser that no longer exists", () => {
  const stale = Object.keys(ALLOWLIST.parsers).filter((p) => !parsers.includes(p));
  assert.deepEqual(stale, [], `stale allowlist entries: ${stale.join(", ")}`);
});

for (const parser of parsers) {
  const fixture = fixtureFor(parser);
  if (!fixture) continue;

  test(`${parser}: output conforms, and parsing twice does not double-count`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-conformance-"));
    const queuePath = path.join(root, "queue.jsonl");
    const input = path.join(root, "input");
    fs.mkdirSync(input, { recursive: true });

    const options = fixture.build(input);
    const cursors = {};

    await rollout[parser]({ ...options, cursors, queuePath });
    const first = readQueue(queuePath).filter((r) => r.source === fixture.source);
    assert.ok(first.length > 0, "the fixture must actually produce rows, or it proves nothing");
    first.forEach((row, i) => assertRowConforms(row, `${parser} row ${i}`));

    // The "run sync twice" lesson from CLAUDE.md:172 — the one that catches
    // dedup-key instability. Same input, carried cursors: nothing new.
    await rollout[parser]({ ...options, cursors, queuePath });
    const second = readQueue(queuePath).filter((r) => r.source === fixture.source);
    assert.deepEqual(
      second,
      first,
      "re-parsing unchanged input must not add or alter rows",
    );
  });
}
