const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${Date.now()}`;
  await fs.writeFile(tmp, content, { encoding: "utf8" });
  await fs.rename(tmp, filePath);
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

async function readJsonStrict(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return { status: "ok", value: JSON.parse(raw), error: null };
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return { status: "missing", value: null, error: err };
    }
    if (err && err.name === "SyntaxError") {
      return { status: "invalid", value: null, error: err };
    }
    return { status: "error", value: null, error: err };
  }
}

async function writeJson(filePath, obj) {
  await writeFileAtomic(filePath, JSON.stringify(obj, null, 2) + "\n");
}

async function chmod600IfPossible(filePath) {
  try {
    await fs.chmod(filePath, 0o600);
  } catch (_e) {}
}

// The holder heartbeats the lock's mtime, so "stale" now means "the holder
// died", not "the holder is slow". That lets the threshold be generous: the old
// 5-minute window silently stole the lock from any sync that ran longer than
// one local-sync tick (full-corpus rebuilds and migration reparses do — see the
// post-mortem at src/commands/sync.js:74-123), letting two writers interleave
// appends into queue.jsonl. A torn line is skipped by the reader, and a skipped
// retraction row is a permanent silent overcount. Issue #89.
const LOCK_STALE_MS = 30 * 60 * 1000; // 30 minutes
const LOCK_HEARTBEAT_MS = 30 * 1000; // touch mtime every 30s while held
const MAX_LOCK_ATTEMPTS = 3;

// mkdir is atomic and exclusive, which makes it a usable mutex on every
// filesystem we care about. Held only for the few syscalls of a takeover.
const TAKEOVER_ABANDONED_MS = 60 * 1000;

function takeoverMutexPath(lockPath) {
  return `${lockPath}.takeover`;
}

async function acquireTakeoverMutex(lockPath) {
  const mutexPath = takeoverMutexPath(lockPath);
  try {
    await fs.mkdir(mutexPath);
    return true;
  } catch (e) {
    if (!e || e.code !== "EEXIST") return false;
  }
  // A process that died mid-takeover would otherwise block every future
  // takeover forever. The window is milliseconds, so anything this old is dead.
  try {
    const stat = await fs.stat(mutexPath);
    if (Date.now() - stat.mtimeMs > TAKEOVER_ABANDONED_MS) {
      await fs.rmdir(mutexPath).catch(() => {});
    }
  } catch (_e) {
    // Vanished under us — the caller retries either way.
  }
  return false;
}

async function readLockOwner(lockPath) {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (_e) {
    // Empty, truncated, or pre-upgrade lock file — fall back to the mtime rule.
  }
  return null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but belongs to someone else.
    return Boolean(e && e.code === "EPERM");
  }
}

// A lock whose owner process is gone is stale immediately — no need to wait out
// the full window. Only trust the pid when the lock was taken on this host, and
// never when it is our own pid (a recycled pid would look alive forever).
function isOwnerGone(owner) {
  if (!owner || typeof owner.pid !== "number" || !Number.isInteger(owner.pid)) return false;
  if (owner.host !== os.hostname()) return false;
  if (owner.pid === process.pid) return false;
  return !isProcessAlive(owner.pid);
}

// Throws EEXIST when the lock is already held — that is the caller's signal to
// decide whether the existing lock is stale.
async function createHeldLock(lockPath, heartbeatMs) {
  const handle = await fs.open(lockPath, "wx");
  const owner = { pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() };

  try {
    await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, { encoding: "utf8" });
  } catch (e) {
    // A write failure would otherwise leave a leaked fd plus an empty lock file
    // that nothing releases — blocking every sync until the stale window elapses.
    await handle.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
    throw e;
  }

  // unref'd so a held lock can never keep the CLI process alive on its own.
  const heartbeat = setInterval(() => {
    const now = new Date();
    fs.utimes(lockPath, now, now).catch(() => {});
  }, heartbeatMs);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  return {
    owner,
    async release() {
      clearInterval(heartbeat);
      await handle.close().catch(() => {});
      await fs.unlink(lockPath).catch(() => {});
    },
  };
}

// Removing a stale lock is a check-then-act, and the caller's check ran outside
// any mutual exclusion: by now another waiter may already have reclaimed it and
// be holding a *fresh* lock. Deleting (or renaming) the path blind would drop
// that winner's lock and let two syncs run at once. The mkdir mutex makes the
// re-check and the delete atomic with respect to other waiters.
async function reclaimStaleLock(lockPath) {
  if (!(await acquireTakeoverMutex(lockPath))) return;
  try {
    const current = await fs.stat(lockPath).catch(() => null);
    if (!current) return;
    const currentOwner = await readLockOwner(lockPath);
    const stillStale = Date.now() - current.mtimeMs > LOCK_STALE_MS || isOwnerGone(currentOwner);
    if (stillStale) await fs.unlink(lockPath).catch(() => {});
  } finally {
    await fs.rmdir(takeoverMutexPath(lockPath)).catch(() => {});
  }
}

async function openLock(lockPath, { quietIfLocked, heartbeatMs = LOCK_HEARTBEAT_MS } = {}, attempt = 1) {
  try {
    return await createHeldLock(lockPath, heartbeatMs);
  } catch (e) {
    if (!e || e.code !== "EEXIST") throw e;

    const retry = () => openLock(lockPath, { quietIfLocked, heartbeatMs }, attempt + 1);
    const giveUp = () => {
      if (!quietIfLocked) process.stdout.write("Another sync is already running.\n");
      return null;
    };

    if (attempt >= MAX_LOCK_ATTEMPTS) return giveUp();

    let stat;
    try {
      stat = await fs.stat(lockPath);
    } catch (_statErr) {
      return retry(); // Lock file disappeared between checks.
    }

    const owner = await readLockOwner(lockPath);
    const expired = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
    // A live holder heartbeats its lock, so a fresh mtime means "still working".
    if (!expired && !isOwnerGone(owner)) return giveUp();

    await reclaimStaleLock(lockPath);
    return retry();
  }
}

module.exports = {
  ensureDir,
  writeFileAtomic,
  readJson,
  readJsonStrict,
  writeJson,
  chmod600IfPossible,
  openLock,
  // Exported for tests.
  LOCK_STALE_MS,
  LOCK_HEARTBEAT_MS,
};
