// Regression tests for issue #75 — Codex subagent fork history overcount.
//
// A spawned Codex subagent rollout begins with
// session_meta.payload.source.subagent.thread_spawn, then REPLAYS the parent
// thread's token_count history (cumulative total_token_usage counters that
// keep climbing), then a deterministic boundary record
// (type: "inter_agent_communication_metadata"), then the genuine child turns.
//
// The cumulative counter is CONTINUOUS across the boundary (verified against
// real local rollouts): the last replayed cumulative and the first child
// cumulative differ only by the child's genuine first turn. So the correct
// accounting is baseline-tracking: advance the delta baseline through the
// replay WITHOUT accumulating, flip accumulation on at the boundary, and let
// the first child delta be (firstChildCumulative - lastReplayCumulative).
//
// These tests use synthetic rollouts whose structure mirrors the verified
// real files. No network, no external fixtures — strictly local.

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");

const { parseRolloutIncremental } = require("../src/lib/rollout");
const { parseCodexRolloutFile } = require("../src/lib/codex-rollout-parser");

// --- builders ---------------------------------------------------------------

function forkSessionMetaLine({ cwd = "/work/child", parent = "parent-thread-1" } = {}) {
  return JSON.stringify({
    type: "session_meta",
    timestamp: "2026-07-20T10:51:35.000Z",
    payload: {
      id: "child-thread-1",
      cwd,
      model_provider: "openai",
      source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } },
    },
  });
}

function normalSessionMetaLine({ cwd = "/work/main" } = {}) {
  return JSON.stringify({
    type: "session_meta",
    timestamp: "2026-07-20T10:51:35.000Z",
    payload: { id: "main-thread-1", cwd, model_provider: "openai" },
  });
}

function boundaryLine({ ts = "2026-07-20T10:52:00.000Z" } = {}) {
  return JSON.stringify({
    type: "inter_agent_communication_metadata",
    timestamp: ts,
    payload: { trigger_turn: true },
  });
}

// cumulative is the total_token_usage object (Codex reports input inclusive of
// cached). last is that turn's last_token_usage (present in real data).
function tokenCountLine({ ts, last, cumulative }) {
  return JSON.stringify({
    type: "event_msg",
    timestamp: ts,
    payload: {
      type: "token_count",
      info: { last_token_usage: last, total_token_usage: cumulative },
    },
  });
}

function u(input, cached, output) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: input + output,
  };
}

async function readJsonLines(filePath) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// The queue is a running-total log keyed by (source, model, hour_start): each
// incremental run re-emits the FULL bucket total, so the LATEST entry per
// bucket is authoritative. Sum a field across the latest entry of each bucket.
function sumField(rows, field) {
  const latest = new Map();
  for (const r of rows) {
    latest.set(`${r.source}|${r.model}|${r.hour_start}`, r);
  }
  return Array.from(latest.values()).reduce((s, r) => s + Number(r[field] || 0), 0);
}

// Replay cumulative history (cached-heavy, climbing) shared by fork scenarios.
// Last replayed cumulative = input 600 / cached 560 / output 60 (total 660).
const REPLAY = [
  tokenCountLine({ ts: "2026-07-20T10:51:40.000Z", last: u(100, 90, 10), cumulative: u(100, 90, 10) }),
  tokenCountLine({ ts: "2026-07-20T10:51:45.000Z", last: u(200, 190, 20), cumulative: u(300, 280, 30) }),
  tokenCountLine({ ts: "2026-07-20T10:51:50.000Z", last: u(300, 280, 30), cumulative: u(600, 560, 60) }),
];
// Genuine child turns, continuing from the replayed baseline (continuous).
// C1 cumulative 650/600/70; C2 cumulative 700/640/90.
const CHILD = [
  tokenCountLine({ ts: "2026-07-20T10:52:05.000Z", last: u(50, 40, 10), cumulative: u(650, 600, 70) }),
  tokenCountLine({ ts: "2026-07-20T10:52:10.000Z", last: u(50, 40, 20), cumulative: u(700, 640, 90) }),
];
// Expected genuine child accounting (delta of cumulatives, then normalized so
// input excludes cached): C1 delta input50/cached40/out10 -> input10; C2 delta
// input50/cached40/out20 -> input10. Totals: cached 80, output 30, total 130.
const EXPECT_CHILD = { cached_input_tokens: 80, output_tokens: 30, total_tokens: 130 };

async function withTmp(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-fork-"));
  try {
    return await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// --- 1. normal (non-fork) rollout is unaffected -----------------------------

test("#75 normal rollout counts every token_count as before", async () => {
  await withTmp(async (tmp) => {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };
    const lines = [normalSessionMetaLine(), ...REPLAY]; // here REPLAY records are genuine
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");

    const res = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    const queued = await readJsonLines(queuePath);
    // Full cumulative counted (cached climbs to 560).
    assert.equal(sumField(queued, "cached_input_tokens"), 560);
    assert.equal(sumField(queued, "total_tokens"), 660);
    assert.equal(res.eventsAggregated, 3);
  });
});

// --- 1b. non-fork null-delta record must not re-baseline the cumulative -----
// Guards the CRITICAL from review: the fork fix must not change the shared
// non-fork path. A transient cumulative dip (corrupt/out-of-order record) makes
// pickDelta return null with a valid totalUsage; the baseline must NOT advance
// down to the dip, or the recovery record would over-count everything since.

test("#75 non-fork cumulative dip does not re-baseline (no over-count on recovery)", async () => {
  await withTmp(async (tmp) => {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };
    const lines = [
      normalSessionMetaLine(),
      tokenCountLine({ ts: "2026-07-20T10:51:40.000Z", last: u(1000, 0, 0), cumulative: u(1000, 0, 0) }),
      // Dip: all-zero cumulative -> pickDelta returns null (valid totalUsage).
      tokenCountLine({ ts: "2026-07-20T10:51:45.000Z", last: u(0, 0, 0), cumulative: u(0, 0, 0) }),
      // Recovery: baseline must still be 1000, so this delta is 10, not 1010.
      tokenCountLine({ ts: "2026-07-20T10:51:50.000Z", last: u(10, 0, 0), cumulative: u(1010, 0, 0) }),
    ];
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");

    await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    const queued = await readJsonLines(queuePath);
    // 1000 (first turn) + 10 (recovery delta). A downward re-baseline gives 2010.
    assert.equal(sumField(queued, "total_tokens"), 1010);
  });
});

// --- 2. complete fork: replay excluded, only child counted ------------------

test("#75 complete subagent fork counts only post-boundary child turns", async () => {
  await withTmp(async (tmp) => {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };
    const lines = [forkSessionMetaLine(), ...REPLAY, boundaryLine(), ...CHILD];
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");

    await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    const queued = await readJsonLines(queuePath);
    assert.equal(
      sumField(queued, "cached_input_tokens"),
      EXPECT_CHILD.cached_input_tokens,
      "replayed parent cached history must not be counted",
    );
    assert.equal(sumField(queued, "total_tokens"), EXPECT_CHILD.total_tokens);
    // Fork resolved -> persisted state is child.
    assert.equal(cursors.files[rolloutPath].codexFork, "child");
  });
});

// --- 3. partial fork (no boundary yet): fail closed, cursor not advanced -----

test("#75 partial fork without boundary ingests nothing and does not advance cursor", async () => {
  await withTmp(async (tmp) => {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };
    const partial = [forkSessionMetaLine(), ...REPLAY]; // boundary not written yet
    await fs.writeFile(rolloutPath, partial.join("\n") + "\n", "utf8");

    const res = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    const queued = await readJsonLines(queuePath);
    assert.equal(queued.length, 0, "no genuine child turns yet");
    assert.equal(res.eventsAggregated, 0);
    // Fail closed: cursor stays at 0 so the completed file is re-read later.
    assert.equal(cursors.files[rolloutPath].offset, 0);
    assert.equal(cursors.files[rolloutPath].codexFork, "replay");
  });
});

// --- 4. resume: boundary + child appended after a partial read --------------

test("#75 fork resumes correctly once the boundary is written", async () => {
  await withTmp(async (tmp) => {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    // Pass 1: partial (replay only).
    await fs.writeFile(rolloutPath, [forkSessionMetaLine(), ...REPLAY].join("\n") + "\n", "utf8");
    await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    assert.equal((await readJsonLines(queuePath)).length, 0);

    // Pass 2: boundary + child now present (full file rewritten as it grows).
    await fs.writeFile(
      rolloutPath,
      [forkSessionMetaLine(), ...REPLAY, boundaryLine(), ...CHILD].join("\n") + "\n",
      "utf8",
    );
    await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });

    const queued = await readJsonLines(queuePath);
    assert.equal(sumField(queued, "cached_input_tokens"), EXPECT_CHILD.cached_input_tokens);
    assert.equal(sumField(queued, "total_tokens"), EXPECT_CHILD.total_tokens);
    assert.equal(cursors.files[rolloutPath].codexFork, "child");
  });
});

// --- 5. incremental resume after boundary (child grows across reads) --------

test("#75 child turns appended in a later incremental read are counted once", async () => {
  await withTmp(async (tmp) => {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    // Pass 1: session_meta + replay + boundary + first child turn only.
    await fs.writeFile(
      rolloutPath,
      [forkSessionMetaLine(), ...REPLAY, boundaryLine(), CHILD[0]].join("\n") + "\n",
      "utf8",
    );
    await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    assert.equal(cursors.files[rolloutPath].codexFork, "child");

    // Pass 2: append the second child turn (append-only growth).
    await fs.appendFile(rolloutPath, CHILD[1] + "\n", "utf8");
    await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });

    const queued = await readJsonLines(queuePath);
    // Both child turns counted exactly once; replay still excluded.
    assert.equal(sumField(queued, "cached_input_tokens"), EXPECT_CHILD.cached_input_tokens);
    assert.equal(sumField(queued, "total_tokens"), EXPECT_CHILD.total_tokens);
  });
});

// --- 7. context-breakdown drill-down parser excludes replay -----------------

test("#75 context-breakdown parser attributes only child turns for a fork", async () => {
  await withTmp(async (tmp) => {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const lines = [forkSessionMetaLine(), ...REPLAY, boundaryLine(), ...CHILD];
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");

    const res = await parseCodexRolloutFile(rolloutPath, {});
    // Only the two genuine child turns, measured from the boundary baseline.
    assert.equal(res.totals.total_tokens, EXPECT_CHILD.total_tokens);
    assert.equal(res.totals.cached_input_tokens, EXPECT_CHILD.cached_input_tokens);
    assert.equal(res.turnCount, 2);
  });
});

// --- 7b. drill-down under a day-scoped window still excludes replay ---------
// Production calls parseCodexRolloutFile with from/to day keys. Fork-control
// records are handled before the date gate, so replay stays excluded.

test("#75 context-breakdown parser excludes replay under a day-scoped window", async () => {
  await withTmp(async (tmp) => {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const lines = [forkSessionMetaLine(), ...REPLAY, boundaryLine(), ...CHILD];
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");

    // All records fall on 2026-07-20; query that exact day.
    const res = await parseCodexRolloutFile(rolloutPath, { from: "2026-07-20", to: "2026-07-20" });
    assert.equal(res.totals.total_tokens, EXPECT_CHILD.total_tokens);
    assert.equal(res.totals.cached_input_tokens, EXPECT_CHILD.cached_input_tokens);
    assert.equal(res.turnCount, 2);
  });
});

// --- 6. two subagents forked from the same parent are isolated --------------

test("#75 multiple subagent forks each count only their own child turns", async () => {
  await withTmp(async (tmp) => {
    const fileA = path.join(tmp, "rollout-a.jsonl");
    const fileB = path.join(tmp, "rollout-b.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    const forkDoc = [forkSessionMetaLine(), ...REPLAY, boundaryLine(), ...CHILD].join("\n") + "\n";
    await fs.writeFile(fileA, forkDoc, "utf8");
    await fs.writeFile(fileB, forkDoc, "utf8");

    await parseRolloutIncremental({ rolloutFiles: [fileA, fileB], cursors, queuePath });
    const queued = await readJsonLines(queuePath);
    // Two children -> exactly twice the single-child totals, no replay bleed.
    assert.equal(sumField(queued, "cached_input_tokens"), EXPECT_CHILD.cached_input_tokens * 2);
    assert.equal(sumField(queued, "total_tokens"), EXPECT_CHILD.total_tokens * 2);
  });
});
