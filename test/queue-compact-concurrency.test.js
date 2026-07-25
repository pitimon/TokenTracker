"use strict";

// The one item of issue 103's definition of done that #117 left open:
// "Compaction is safe against a concurrent append (test with the sync lock
// held)."
//
// It is safe BECAUSE of the lock, not on its own, and the honest way to show
// that is to demonstrate both halves — that an unlocked concurrent append really
// is lost, and that the sync command holds the lock across the whole operation.
// A test that only asserted the happy path would be claiming a property the code
// does not have.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { compactQueue } = require("../src/lib/queue-compact");
const { openLock } = require("../src/lib/fs");

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

function tmpQueue(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-compact-lock-"));
  const queuePath = path.join(dir, "queue.jsonl");
  fs.writeFileSync(queuePath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { dir, queuePath };
}

test("an append that lands mid-compaction IS lost — which is what the lock is for", () => {
  // Demonstrating the hazard rather than asserting it away. compactQueue reads
  // the file, builds the output, then renames over it. Anything appended in
  // between is on the old inode and goes with it.
  //
  // If this test ever starts failing because the append survives, compaction
  // grew a merge step and the lock requirement should be re-examined — that is
  // a finding, not a broken test.
  const { queuePath } = tmpQueue([
    row({ input_tokens: 1, total_tokens: 51 }),
    row({ input_tokens: 2, total_tokens: 52 }),
  ]);

  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function patched(target, ...rest) {
    const result = realWriteFileSync.call(fs, target, ...rest);
    if (String(target).includes(".compact.")) {
      // The window: the temp file exists, the rename has not happened.
      realWriteFileSync.call(
        fs,
        queuePath,
        fs.readFileSync(queuePath, "utf8") +
          JSON.stringify(row({ hour_start: "2026-05-14T10:00:00.000Z", total_tokens: 999 })) +
          "\n",
      );
    }
    return result;
  };
  try {
    compactQueue(queuePath);
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }

  const left = fs.readFileSync(queuePath, "utf8");
  assert.ok(
    !left.includes("2026-05-14T10:00:00.000Z"),
    "the concurrent append survived; if compaction now merges, revisit the lock requirement",
  );
});

test("the sync lock actually excludes a second holder", () => {
  // The property the safety argument rests on. If openLock let two callers in,
  // "compaction runs inside the lock" would guarantee nothing.
  return (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-lock-"));
    const lockPath = path.join(dir, "sync.lock");
    const held = await openLock(lockPath, { quietIfLocked: true });
    assert.ok(held, "the first caller must get the lock");
    try {
      const second = await openLock(lockPath, { quietIfLocked: true });
      assert.equal(second, null, "a second caller must be refused while the first holds it");
    } finally {
      await held.release();
      await fs.promises.unlink(lockPath).catch(() => {});
    }
    const afterRelease = await openLock(lockPath, { quietIfLocked: true });
    assert.ok(afterRelease, "and must succeed once it is released");
    await afterRelease.release();
  })();
});

test("compaction while the lock is held completes and the result is correct", () => {
  // The positive case, run in the arrangement the sync command actually uses:
  // lock first, compact second, release last.
  return (async () => {
    const { dir, queuePath } = tmpQueue([
      row({ input_tokens: 1, total_tokens: 51 }),
      row({ input_tokens: 2, total_tokens: 52 }),
      row({ input_tokens: 3, total_tokens: 53 }),
    ]);
    const lockPath = path.join(dir, "sync.lock");
    const lock = await openLock(lockPath, { quietIfLocked: true });
    assert.ok(lock);
    let result;
    try {
      // A would-be concurrent writer is refused here, which is the whole point.
      assert.equal(await openLock(lockPath, { quietIfLocked: true }), null);
      result = compactQueue(queuePath);
    } finally {
      await lock.release();
    }
    assert.equal(result.changed, true);
    assert.equal(result.keptLines, 1);
    const left = fs.readFileSync(queuePath, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(left.length, 1);
    assert.equal(left[0].input_tokens, 3, "the last row per key survives");
  })();
});

test("sync runs compaction inside the lock, not before or after it", () => {
  // A source fact, because the ordering is what makes the two tests above add up
  // to a safety property. Reordering these lines would leave both green while
  // reopening the window.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "commands", "sync.js"), "utf8");
  const lockAt = source.indexOf("const lock = await openLock(lockPath");
  const compactAt = source.indexOf("if (opts.compact)");
  const releaseAt = source.indexOf("await lock.release()");
  assert.ok(lockAt > 0 && compactAt > 0 && releaseAt > 0, "the three markers must all be present");
  assert.ok(lockAt < compactAt, "the lock must be taken before compaction");
  assert.ok(compactAt < releaseAt, "and released after it");
});
