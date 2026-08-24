const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { cmdSync } = require("../src/commands/sync");

test("sync --reconcile-hermes fails closed before creating tracker state", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-unsafe-hermes-reconcile-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = tmp;

    await assert.rejects(
      () => cmdSync(["--reconcile-hermes"]),
      /historical Hermes reconciliation is disabled.*temporal/i,
    );
    await assert.rejects(
      () => fs.stat(path.join(tmp, ".tokentracker", "tracker")),
      { code: "ENOENT" },
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
