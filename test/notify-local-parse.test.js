const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const cp = require("node:child_process");
const { test } = require("node:test");

// Regression guard for #67: the generated notify hook used to gate local
// parsing on a cloud credential, so a local-only install never refreshed its
// queue after a session ended. Parsing local logs and uploading them are two
// separate decisions; this hook makes only the first.

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    cp.execFile(process.execPath, args, { env }, (err) => (err ? reject(err) : resolve()));
  });
}

async function rmWithRetry(target, retries = 3) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (err) {
      lastErr = err;
      if (!err || err.code !== "ENOTEMPTY") throw err;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastErr;
}

// Sets up an install with no device token anywhere: not in the environment,
// not in config.json. This is the local-only configuration from #67.
async function setupTokenlessInstall(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-notify-local-"));
  t.after(() => rmWithRetry(tmp));

  const codexHome = path.join(tmp, ".codex");
  await fs.mkdir(codexHome, { recursive: true });

  const env = {
    ...process.env,
    HOME: tmp,
    CODEX_HOME: codexHome,
    OPENCODE_CONFIG_DIR: path.join(tmp, ".config", "opencode"),
  };
  delete env.TOKENTRACKER_DEVICE_TOKEN;

  const entry = path.join(path.resolve(__dirname, ".."), "bin", "tracker.js");
  await runNode([entry, "init", "--yes", "--no-auth", "--no-open"], env);

  const trackerDir = path.join(tmp, ".tokentracker", "tracker");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(path.join(trackerDir, "config.json"), "{}", "utf8");

  return {
    env,
    trackerDir,
    notifyPath: path.join(tmp, ".tokentracker", "bin", "notify.cjs"),
    throttlePath: path.join(trackerDir, "sync.throttle"),
  };
}

test("notify starts a local sync when no device token is configured", async (t) => {
  const ctx = await setupTokenlessInstall(t);

  // #67 step 5: sync.throttle was never created, because the throttle write
  // lived inside the credential gate. Its absence is the observable symptom.
  await assert.rejects(fs.stat(ctx.throttlePath), /ENOENT/);

  await runNode([ctx.notifyPath, "--source=codex"], ctx.env);

  const stat = await fs.stat(ctx.throttlePath);
  assert.ok(stat.isFile(), "notify must record a throttle stamp for a tokenless install");

  const stamp = Number(await fs.readFile(ctx.throttlePath, "utf8"));
  assert.ok(Number.isFinite(stamp) && stamp > 0, `expected a timestamp, got ${stamp}`);
});

test("notify still throttles repeat events for a tokenless install", async (t) => {
  const ctx = await setupTokenlessInstall(t);

  await runNode([ctx.notifyPath, "--source=codex"], ctx.env);
  const first = await fs.readFile(ctx.throttlePath, "utf8");

  await runNode([ctx.notifyPath, "--source=codex"], ctx.env);
  const second = await fs.readFile(ctx.throttlePath, "utf8");

  // Removing the credential gate must not remove the 20s throttle with it.
  assert.equal(second, first, "a second notify inside the throttle window must not re-stamp");
});

test("the generated notify hook reads no cloud credential at all", async (t) => {
  const ctx = await setupTokenlessInstall(t);
  const source = await fs.readFile(ctx.notifyPath, "utf8");

  // The defect was not "the gate was set wrong" — it was that this hook
  // consulted a cloud credential to decide whether to do local work. Asserting
  // the credential is never read keeps the gate from growing back in any form.
  assert.doesNotMatch(source, /TOKENTRACKER_DEVICE_TOKEN/, "notify must not read the device-token env var");
  assert.doesNotMatch(source, /deviceToken/, "notify must not read a device token from config");
  assert.doesNotMatch(source, /canSync/, "notify must not branch on cloud-sync capability");

  // It must still only ever invoke the local sync entry point.
  assert.match(source, /'sync', '--auto', '--from-notify'/);
});
