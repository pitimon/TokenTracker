const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { openLock, LOCK_STALE_MS } = require("../src/lib/fs");

async function tmpLockPath(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `tt-lock-${name}-`));
  return path.join(dir, "sync.lock");
}

async function backdate(lockPath, ms) {
  const when = new Date(Date.now() - ms);
  await fs.utimes(lockPath, when, when);
}

async function readOwner(lockPath) {
  return JSON.parse(await fs.readFile(lockPath, "utf8"));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A pid that is definitely gone: spawn a child, kill it, wait for exit.
async function deadPid() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  const pid = child.pid;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGKILL");
  });
  return pid;
}

test("the lock records who holds it, and release removes it", async () => {
  const lockPath = await tmpLockPath("owner");
  const lock = await openLock(lockPath, { quietIfLocked: true });
  assert.ok(lock, "expected to acquire the lock");

  const owner = await readOwner(lockPath);
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.host, os.hostname());
  assert.ok(Date.parse(owner.startedAt) > 0, "startedAt must be an ISO timestamp");

  await lock.release();
  await assert.rejects(fs.stat(lockPath), { code: "ENOENT" });
});

test("a lock held by a live holder is not stolen, even past the old 5-minute window", async () => {
  const lockPath = await tmpLockPath("live");
  const held = await openLock(lockPath, { quietIfLocked: true });
  assert.ok(held);

  // Older than the window that used to steal it, newer than the current one.
  await backdate(lockPath, 6 * 60 * 1000);

  const second = await openLock(lockPath, { quietIfLocked: true });
  assert.equal(second, null, "a heartbeating holder must keep its lock");

  await held.release();
});

test("the heartbeat keeps advancing the lock mtime while it is held", async () => {
  const lockPath = await tmpLockPath("heartbeat");
  const lock = await openLock(lockPath, { quietIfLocked: true, heartbeatMs: 20 });
  assert.ok(lock);

  await backdate(lockPath, 10 * 60 * 1000);
  const stale = (await fs.stat(lockPath)).mtimeMs;

  await sleep(120);
  const beating = (await fs.stat(lockPath)).mtimeMs;
  assert.ok(beating > stale, "heartbeat should have touched the lock");

  await lock.release();
});

test("release stops the heartbeat", async () => {
  const lockPath = await tmpLockPath("release-stops");
  const lock = await openLock(lockPath, { quietIfLocked: true, heartbeatMs: 20 });
  await lock.release();

  // Re-create the file so there is something for a leaked timer to touch.
  await fs.writeFile(lockPath, "{}\n");
  await backdate(lockPath, 60 * 1000);
  const before = (await fs.stat(lockPath)).mtimeMs;

  await sleep(120);
  const after = (await fs.stat(lockPath)).mtimeMs;
  assert.equal(after, before, "a released lock must not keep touching the path");
});

test("a lock past the stale window is taken over", async () => {
  const lockPath = await tmpLockPath("stale");
  const first = await openLock(lockPath, { quietIfLocked: true });
  assert.ok(first);
  // Simulate a dead holder: stop the heartbeat, then age the file out.
  await first.release();
  await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, host: os.hostname() }));
  await backdate(lockPath, LOCK_STALE_MS + 60_000);

  const second = await openLock(lockPath, { quietIfLocked: true });
  assert.ok(second, "an expired lock should be reclaimed");
  assert.equal((await readOwner(lockPath)).pid, process.pid);
  await second.release();
});

test("a lock whose owner process is gone is reclaimed immediately, without waiting out the window", async () => {
  const lockPath = await tmpLockPath("dead-owner");
  const pid = await deadPid();
  await fs.writeFile(lockPath, JSON.stringify({ pid, host: os.hostname(), startedAt: new Date().toISOString() }));
  // mtime is fresh — only the dead pid justifies the takeover.

  const lock = await openLock(lockPath, { quietIfLocked: true });
  assert.ok(lock, "a lock owned by a dead process should be reclaimed at once");
  assert.equal((await readOwner(lockPath)).pid, process.pid);
  await lock.release();
});

test("a fresh lock recorded on another host is left alone even if the pid looks dead", async () => {
  const lockPath = await tmpLockPath("other-host");
  const pid = await deadPid();
  await fs.writeFile(lockPath, JSON.stringify({ pid, host: `${os.hostname()}-elsewhere` }));

  const lock = await openLock(lockPath, { quietIfLocked: true });
  assert.equal(lock, null, "pid liveness is only meaningful on the recording host");
});

test("a corrupt or pre-upgrade lock file falls back to the mtime rule", async () => {
  const lockPath = await tmpLockPath("corrupt");
  await fs.writeFile(lockPath, "not json at all");

  const fresh = await openLock(lockPath, { quietIfLocked: true });
  assert.equal(fresh, null, "a fresh unreadable lock is still a lock");

  await backdate(lockPath, LOCK_STALE_MS + 60_000);
  const reclaimed = await openLock(lockPath, { quietIfLocked: true });
  assert.ok(reclaimed, "an aged unreadable lock should be reclaimed");
  await reclaimed.release();
});

test("concurrent takeover of one stale lock yields exactly one winner", async () => {
  const lockPath = await tmpLockPath("race");
  await fs.writeFile(lockPath, JSON.stringify({ pid: 1, host: `${os.hostname()}-elsewhere` }));
  await backdate(lockPath, LOCK_STALE_MS + 60_000);

  const results = await Promise.all(
    Array.from({ length: 4 }, () => openLock(lockPath, { quietIfLocked: true })),
  );
  const winners = results.filter(Boolean);
  assert.equal(winners.length, 1, `expected exactly one winner, got ${winners.length}`);

  // The takeover mutex must not be left behind, or every future takeover blocks.
  const leftovers = (await fs.readdir(path.dirname(lockPath))).filter((f) => f.includes(".takeover"));
  assert.deepEqual(leftovers, []);

  await winners[0].release();
});
