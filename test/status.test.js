const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");

const { cmdStatus } = require("../src/commands/status");

// Inverted, not deleted: status used to print upload.throttle.json timestamps
// (Base URL / Last upload / Next upload after). Cloud upload is gone, so this
// now pins that those lines are gone while local-only state (queue size, last
// OpenClaw-triggered sync) still prints correctly.
test("status prints local state and does not print removed cloud-upload lines", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-status-"));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevWrite = process.stdout.write;

  try {
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, ".codex");

    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.mkdir(process.env.CODEX_HOME, { recursive: true });

    await fs.writeFile(
      path.join(process.env.CODEX_HOME, "config.toml"),
      'notify = [\"/usr/bin/env\", \"node\", \"~/.tokentracker/bin/notify.cjs\"]\n',
      "utf8",
    );

    await fs.writeFile(
      path.join(trackerDir, "cursors.json"),
      JSON.stringify({ updatedAt: "2025-12-18T00:00:00.000Z" }) + "\n",
      "utf8",
    );
    await fs.writeFile(path.join(trackerDir, "queue.jsonl"), "abcd", "utf8");
    await fs.writeFile(
      path.join(trackerDir, "openclaw.signal"),
      "2026-02-12T00:00:00.000Z\n",
      "utf8",
    );

    let out = "";
    process.stdout.write = (chunk, enc, cb) => {
      out += typeof chunk === "string" ? chunk : chunk.toString(enc || "utf8");
      if (typeof cb === "function") cb();
      return true;
    };

    await cmdStatus();

    assert.match(out, /- Queue: 4 bytes/);
    assert.match(out, /- Last OpenClaw-triggered sync: 2026-02-12T00:00:00.000Z/);
    assert.ok(!out.includes("Base URL"), "expected Base URL line to be removed");
    assert.ok(!out.includes("Device token"), "expected Device token line to be removed");
    assert.ok(!/Last upload/.test(out), "expected Last upload line to be removed");
    assert.ok(!/Next upload after/.test(out), "expected Next upload after line to be removed");
  } finally {
    process.stdout.write = prevWrite;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("status does not migrate legacy tracker directory", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-status-legacy-"));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevWrite = process.stdout.write;

  try {
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, ".codex");

    const legacyTrackerDir = path.join(tmp, ".legacy-tracker-root", "tracker");
    await fs.mkdir(legacyTrackerDir, { recursive: true });
    await fs.mkdir(process.env.CODEX_HOME, { recursive: true });

    await fs.writeFile(
      path.join(process.env.CODEX_HOME, "config.toml"),
      'notify = [\"/usr/bin/env\", \"node\", \"~/.legacy-tracker-root/bin/notify.cjs\"]\n',
      "utf8",
    );

    await fs.writeFile(
      path.join(legacyTrackerDir, "cursors.json"),
      JSON.stringify({ updatedAt: "2025-12-18T00:00:00.000Z" }) + "\n",
      "utf8",
    );
    await fs.writeFile(path.join(legacyTrackerDir, "queue.jsonl"), "", "utf8");

    let out = "";
    process.stdout.write = (chunk, enc, cb) => {
      out += typeof chunk === "string" ? chunk : chunk.toString(enc || "utf8");
      if (typeof cb === "function") cb();
      return true;
    };

    await cmdStatus();

    // Cloud upload/base-URL lines are gone entirely now (see the inverted
    // test above) — this test's own subject is the legacy-dir behavior below.
    assert.match(out, /- Queue: 0 bytes/);
    const newTrackerDir = path.join(tmp, ".tokentracker", "tracker");
    await assert.rejects(fs.stat(newTrackerDir));
    await fs.stat(legacyTrackerDir);
  } finally {
    process.stdout.write = prevWrite;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
