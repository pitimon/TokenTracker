const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  computeCodexContextBreakdown,
  __resetContextCachesForTests,
  __getParseCountsForTests,
} = require("../src/lib/codex-context-breakdown");

// Issue #62: the aggregate cache keys on the GLOBAL maximum session-file mtime,
// so appending to the one active session invalidated every historical file and
// forced a full rescan. These pin that only changed files are reparsed, and
// that the cached aggregate still equals a clean scan.

const DAY = "2026-05-08";

function rolloutEvents({ sessionId, at, inputTokens, outputTokens }) {
  return [
    {
      timestamp: `${DAY}T${at}.000Z`,
      type: "session_meta",
      payload: { id: sessionId, cwd: "/tmp/project", model_provider: "openai", cli_version: "1.0.0" },
    },
    {
      timestamp: `${DAY}T${at}.100Z`,
      type: "turn_context",
      payload: { cwd: "/tmp/project", model: "gpt-5.5" },
    },
    {
      timestamp: `${DAY}T${at}.200Z`,
      type: "response_item",
      payload: { type: "function_call", name: "exec_command", call_id: `call-${sessionId}`, arguments: "{}" },
    },
    {
      timestamp: `${DAY}T${at}.300Z`,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: inputTokens,
            cached_input_tokens: 0,
            output_tokens: outputTokens,
            reasoning_output_tokens: 0,
            total_tokens: inputTokens + outputTokens,
          },
        },
      },
    },
  ];
}

async function writeRollout(rootDir, fileName, events) {
  const dir = path.join(rootDir, DAY.slice(0, 4), DAY.slice(5, 7), DAY.slice(8, 10));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return filePath;
}

// Appending and then re-stat-ing within the same millisecond can leave mtimeMs
// unchanged, which would make this test pass for the wrong reason. Push mtime
// forward explicitly so the identity check is exercised, not the clock.
async function appendAndTouch(filePath, events) {
  await fs.appendFile(filePath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  const future = new Date(Date.now() + 2000);
  fssync.utimesSync(filePath, future, future);
}

async function setupCorpus(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tt-codex-perfile-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  __resetContextCachesForTests();
  t.after(() => __resetContextCachesForTests());

  const historical = [];
  for (let i = 0; i < 3; i++) {
    historical.push(
      await writeRollout(
        root,
        `rollout-hist-${i}.jsonl`,
        rolloutEvents({ sessionId: `hist-${i}`, at: `1${i}:00:00`, inputTokens: 100, outputTokens: 50 }),
      ),
    );
  }
  const active = await writeRollout(
    root,
    "rollout-active.jsonl",
    rolloutEvents({ sessionId: "active", at: "14:00:00", inputTokens: 200, outputTokens: 100 }),
  );

  return { root, historical, active };
}

test("appending to the active session reparses only that file", async (t) => {
  const { root, active } = await setupCorpus(t);

  const before = await computeCodexContextBreakdown({ codexDir: root });
  const cold = __getParseCountsForTests();
  assert.equal(cold.size, 4, "first pass must parse all four files");
  assert.deepStrictEqual([...cold.values()], [1, 1, 1, 1]);

  await appendAndTouch(active, rolloutEvents({ sessionId: "active", at: "15:00:00", inputTokens: 7, outputTokens: 3 }));

  const warm = await computeCodexContextBreakdown({ codexDir: root });
  const after = __getParseCountsForTests();

  // The three historical files must not have been parsed a second time.
  for (const [filePath, count] of after) {
    const expected = filePath === active ? 2 : 1;
    assert.equal(count, expected, `${path.basename(filePath)} parsed ${count}x, expected ${expected}x`);
  }

  assert.ok(
    warm.totals.total_tokens > before.totals.total_tokens,
    "the appended record must be reflected in the aggregate",
  );
});

test("the cached aggregate equals a clean full scan after an append", async (t) => {
  const { root, active } = await setupCorpus(t);

  await computeCodexContextBreakdown({ codexDir: root });
  await appendAndTouch(active, rolloutEvents({ sessionId: "active", at: "16:00:00", inputTokens: 11, outputTokens: 5 }));
  const warm = await computeCodexContextBreakdown({ codexDir: root });

  // Cold: no aggregate cache, no per-file cache, nothing carried over.
  __resetContextCachesForTests();
  const cold = await computeCodexContextBreakdown({ codexDir: root });

  assert.deepStrictEqual(warm, cold, "incremental result must be identical to a clean scan");
});

test("changing only top reuses the per-file cache", async (t) => {
  const { root } = await setupCorpus(t);

  await computeCodexContextBreakdown({ codexDir: root, top: 20 });
  const baseline = __getParseCountsForTests();

  await computeCodexContextBreakdown({ codexDir: root, top: 5 });
  const after = __getParseCountsForTests();

  // top is applied at merge time, so it is deliberately absent from the
  // per-file key. If someone adds it, this test is what catches the
  // regression: every file would reparse for a purely cosmetic change.
  assert.deepStrictEqual([...after.values()], [...baseline.values()], "changing top must not reparse anything");
});

test("changing the timezone context does reparse", async (t) => {
  const { root } = await setupCorpus(t);

  await computeCodexContextBreakdown({ codexDir: root });
  const baseline = [...__getParseCountsForTests().values()];

  await computeCodexContextBreakdown({
    codexDir: root,
    timeZoneContext: { timeZone: "Asia/Bangkok", offsetMinutes: 420 },
  });
  const after = [...__getParseCountsForTests().values()];

  // Bucketing depends on the timezone, so cached parses are not reusable.
  assert.deepStrictEqual(after, baseline.map((n) => n + 1), "a timezone change must reparse every file");
});

test("rotation and truncation invalidate the per-file cache", async (t) => {
  const { root, active } = await setupCorpus(t);

  await computeCodexContextBreakdown({ codexDir: root });
  const before = __getParseCountsForTests().get(active);

  // Rewrite with different leading bytes and a different length: the inode may
  // be reused, so this leans on the head fingerprint and the size check.
  await fs.rm(active);
  await writeRollout(
    root,
    "rollout-active.jsonl",
    rolloutEvents({ sessionId: "rotated", at: "17:00:00", inputTokens: 999, outputTokens: 1 }),
  );

  const rotated = await computeCodexContextBreakdown({ codexDir: root });
  assert.equal(__getParseCountsForTests().get(active), before + 1, "a rotated file must be reparsed");

  __resetContextCachesForTests();
  const cold = await computeCodexContextBreakdown({ codexDir: root });
  assert.deepStrictEqual(rotated, cold, "post-rotation result must match a clean scan");
});
