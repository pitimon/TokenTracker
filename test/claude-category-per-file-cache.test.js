const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  computeClaudeCategoryBreakdown,
  __resetCategoryCachesForTests,
  __getCategoryParseCountsForTests,
} = require("../src/lib/claude-categorizer");

// Issue #62: the aggregate cache keys on the GLOBAL maximum session-file mtime,
// so appending to the active session invalidated every historical file. These
// pin that only changed files are reparsed AND that the incremental result is
// identical to a clean scan — including when files share a dedup hash, which is
// the case that makes per-file results non-composable.

function ts(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function assistantEntry({ requestId, messageId, at, output = 200, cacheCreate = 1000 }) {
  return {
    type: "assistant",
    timestamp: at,
    requestId,
    message: {
      id: messageId,
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: cacheCreate,
        cache_read_input_tokens: 0,
        output_tokens: output,
      },
      content: [{ type: "text", text: "x".repeat(50) }],
    },
  };
}

async function writeJsonl(file, lines) {
  await fs.writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
}

async function appendAndTouch(file, lines) {
  await fs.appendFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  const future = new Date(Date.now() + 2000);
  fssync.utimesSync(file, future, future);
}

async function setupCorpus(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-claude-perfile-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  __resetCategoryCachesForTests();
  t.after(() => __resetCategoryCachesForTests());

  const historical = [];
  for (let i = 0; i < 3; i++) {
    const file = path.join(dir, `session-hist-${i}.jsonl`);
    await writeJsonl(file, [
      assistantEntry({ requestId: `rH${i}`, messageId: `mH${i}`, at: ts(60 + i) }),
    ]);
    historical.push(file);
  }
  const active = path.join(dir, "session-active.jsonl");
  await writeJsonl(active, [assistantEntry({ requestId: "rA1", messageId: "mA1", at: ts(5) })]);

  return { dir, historical, active };
}

test("appending to the active session reparses only that file", async (t) => {
  const { dir, active } = await setupCorpus(t);

  const before = await computeClaudeCategoryBreakdown({ rootDir: dir });
  assert.deepStrictEqual([...__getCategoryParseCountsForTests().values()], [1, 1, 1, 1]);

  await appendAndTouch(active, [assistantEntry({ requestId: "rA2", messageId: "mA2", at: ts(1) })]);

  const warm = await computeClaudeCategoryBreakdown({ rootDir: dir });

  for (const [filePath, count] of __getCategoryParseCountsForTests()) {
    const expected = filePath === active ? 2 : 1;
    assert.equal(count, expected, `${path.basename(filePath)} parsed ${count}x, expected ${expected}x`);
  }

  assert.equal(warm.message_count, before.message_count + 1);
  assert.ok(warm.totals.total_tokens > before.totals.total_tokens);
});

test("the incremental result is identical to a clean full scan", async (t) => {
  const { dir, active } = await setupCorpus(t);

  await computeClaudeCategoryBreakdown({ rootDir: dir });
  await appendAndTouch(active, [assistantEntry({ requestId: "rA3", messageId: "mA3", at: ts(1) })]);
  const warm = await computeClaudeCategoryBreakdown({ rootDir: dir });

  __resetCategoryCachesForTests();
  const cold = await computeClaudeCategoryBreakdown({ rootDir: dir });

  assert.deepStrictEqual(warm, cold, "cached recombination must equal a clean scan");
});

test("a dedup hash shared across two files falls back to a full sequential scan", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-claude-collide-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  __resetCategoryCachesForTests();
  t.after(() => __resetCategoryCachesForTests());

  // Same requestId AND message.id in two files produces the same dedup key, so
  // a full scan counts it once. Summing independent per-file results would
  // count it twice — this is the case the collision guard exists for.
  const at = ts(30);
  await writeJsonl(path.join(dir, "session-one.jsonl"), [
    assistantEntry({ requestId: "shared", messageId: "shared-msg", at, output: 400 }),
  ]);
  await writeJsonl(path.join(dir, "session-two.jsonl"), [
    assistantEntry({ requestId: "shared", messageId: "shared-msg", at, output: 400 }),
    assistantEntry({ requestId: "unique", messageId: "unique-msg", at, output: 100 }),
  ]);

  const result = await computeClaudeCategoryBreakdown({ rootDir: dir });

  // Two distinct messages survive dedup, not three.
  assert.equal(result.message_count, 2, "the duplicated message must be counted once");

  // The guard reparses everything sequentially, so each file is parsed twice:
  // once optimistically, once in the fallback.
  for (const [filePath, count] of __getCategoryParseCountsForTests()) {
    assert.equal(count, 2, `${path.basename(filePath)} should be parsed twice (optimistic + fallback)`);
  }
});

test("changing the date range does not serve a cached parse from another range", async (t) => {
  const { dir } = await setupCorpus(t);

  await computeClaudeCategoryBreakdown({ rootDir: dir });
  const baseline = [...__getCategoryParseCountsForTests().values()];

  const today = new Date().toISOString().slice(0, 10);
  await computeClaudeCategoryBreakdown({ rootDir: dir, from: today, to: today });
  const after = [...__getCategoryParseCountsForTests().values()];

  assert.deepStrictEqual(
    after,
    baseline.map((n) => n + 1),
    "a different range must reparse; per-file entries are range-scoped",
  );
});

test("rotating a file invalidates its cached parse", async (t) => {
  const { dir, active } = await setupCorpus(t);

  await computeClaudeCategoryBreakdown({ rootDir: dir });
  const before = __getCategoryParseCountsForTests().get(active);

  await fs.rm(active);
  await writeJsonl(active, [
    assistantEntry({ requestId: "rotated", messageId: "rotated-msg", at: ts(2), output: 900 }),
  ]);

  const rotated = await computeClaudeCategoryBreakdown({ rootDir: dir });
  assert.equal(__getCategoryParseCountsForTests().get(active), before + 1);

  __resetCategoryCachesForTests();
  const cold = await computeClaudeCategoryBreakdown({ rootDir: dir });
  assert.deepStrictEqual(rotated, cold);
});
