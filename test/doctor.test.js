const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { buildDoctorReport } = require("../src/lib/doctor");
const { cmdDoctor } = require("../src/commands/doctor");

// Inverted: doctor used to report a cloud base_url and device token. Those
// checks are gone with the cloud, and this now pins that they stay gone rather
// than silently reappearing in a local-only build.
test("doctor reports no cloud runtime checks", async () => {
  const report = await buildDoctorReport({
    runtime: { httpTimeoutMs: 1000 },
  });
  for (const id of ["runtime.base_url", "runtime.device_token", "network.reachable"]) {
    assert.equal(
      report.checks.some((c) => c.id === id),
      false,
      `${id} must stay removed`,
    );
  }
  assert.ok(report.checks.length > 0, "doctor still reports local checks");
});

test("doctor reports Node.js version and missing Linux opener", async () => {
  const report = await buildDoctorReport({
    runtime: { baseUrl: "https://example", deviceToken: "token" },
    fetch: async () => ({ status: 200 }),
    system: {
      nodeVersion: "v18.20.0",
      platform: "linux",
      env: { PATH: "/usr/bin", DISPLAY: ":0" },
      commandExists: async () => false,
    },
  });
  const nodeCheck = report.checks.find((c) => c.id === "runtime.node_version");
  const openerCheck = report.checks.find((c) => c.id === "browser.opener");

  assert.equal(nodeCheck.status, "fail");
  assert.equal(nodeCheck.critical, true);
  assert.equal(openerCheck.status, "warn");
  assert.equal(openerCheck.meta.command, "xdg-open");
  assert.equal(openerCheck.meta.linux_fix, "sudo apt install -y xdg-utils");
  assert.equal(report.ok, false);
});

test("doctor warns for headless browser opener even when Node is supported", async () => {
  const report = await buildDoctorReport({
    runtime: { baseUrl: "https://example", deviceToken: "token" },
    fetch: async () => ({ status: 200 }),
    system: {
      nodeVersion: "v20.11.1",
      platform: "linux",
      env: { PATH: "/usr/bin" },
      commandExists: async () => true,
    },
  });
  const nodeCheck = report.checks.find((c) => c.id === "runtime.node_version");
  const openerCheck = report.checks.find((c) => c.id === "browser.opener");

  assert.equal(nodeCheck.status, "ok");
  assert.equal(openerCheck.status, "warn");
  assert.equal(openerCheck.meta.headless, true);
  assert.match(openerCheck.detail, /--no-open/);
});

test("doctor marks invalid config.json as critical", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-doctor-"));
  const trackerDir = path.join(tmp, ".tokentracker", "tracker");
  await fs.mkdir(trackerDir, { recursive: true });
  const configPath = path.join(trackerDir, "config.json");
  await fs.writeFile(configPath, "{bad", "utf8");

  const report = await buildDoctorReport({
    runtime: { baseUrl: "https://example" },
    fetch: async () => ({ status: 200 }),
    paths: { trackerDir, configPath },
  });
  const configCheck = report.checks.find((c) => c.id === "fs.config_json");

  assert.equal(configCheck.status, "fail");
  assert.equal(configCheck.critical, true);
});

test("doctor --out writes json to file and stdout", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-doctor-"));
  const prevHome = process.env.HOME;
  const prevCwd = process.cwd();
  const prevFetch = globalThis.fetch;
  const prevWrite = process.stdout.write;
  const prevErr = process.stderr.write;
  const prevExit = process.exitCode;

  try {
    process.env.HOME = tmp;
    process.chdir(tmp);
    globalThis.fetch = async () => ({ status: 204 });
    const outCapture = createWriteCapture();
    const errCapture = createWriteCapture();
    process.stdout.write = outCapture.write;
    process.stderr.write = errCapture.write;
    process.exitCode = undefined;

    await cmdDoctor(["--out", "doctor.json"]);

    const out = outCapture.read();
    assert.ok(out.trim().startsWith("{"));
    const payload = JSON.parse(out);
    assert.equal(payload.version, 1);

    const filePayload = JSON.parse(await fs.readFile(path.join(tmp, "doctor.json"), "utf8"));
    assert.equal(filePayload.version, 1);
  } finally {
    process.stdout.write = prevWrite;
    process.stderr.write = prevErr;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    process.chdir(prevCwd);
    globalThis.fetch = prevFetch;
    process.exitCode = prevExit;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("doctor sets exitCode on critical failures", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-doctor-"));
  const prevHome = process.env.HOME;
  const prevFetch = globalThis.fetch;
  const prevWrite = process.stdout.write;
  const prevErr = process.stderr.write;
  const prevExit = process.exitCode;

  try {
    process.env.HOME = tmp;
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(path.join(trackerDir, "config.json"), "{bad", "utf8");
    globalThis.fetch = async () => ({ status: 200 });
    const outCapture = createWriteCapture();
    const errCapture = createWriteCapture();
    process.stdout.write = outCapture.write;
    process.stderr.write = errCapture.write;
    process.exitCode = 0;

    await cmdDoctor(["--json"]);

    assert.equal(process.exitCode, 1);
  } finally {
    process.stdout.write = prevWrite;
    process.stderr.write = prevErr;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    globalThis.fetch = prevFetch;
    process.exitCode = prevExit;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("doctor tolerates null config.json payload", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-doctor-"));
  const prevHome = process.env.HOME;
  const prevFetch = globalThis.fetch;
  const prevWrite = process.stdout.write;
  const prevErr = process.stderr.write;
  const prevExit = process.exitCode;

  try {
    process.env.HOME = tmp;
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(path.join(trackerDir, "config.json"), "null", "utf8");
    globalThis.fetch = async () => ({ status: 200 });
    const outCapture = createWriteCapture();
    const errCapture = createWriteCapture();
    process.stdout.write = outCapture.write;
    process.stderr.write = errCapture.write;
    process.exitCode = 0;

    await cmdDoctor(["--json"]);

    const payload = JSON.parse(outCapture.read());
    assert.equal(payload.version, 1);
  } finally {
    process.stdout.write = prevWrite;
    process.stderr.write = prevErr;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    globalThis.fetch = prevFetch;
    process.exitCode = prevExit;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

function createWriteCapture() {
  let out = "";
  return {
    write(chunk, enc, cb) {
      out += typeof chunk === "string" ? chunk : chunk.toString(enc || "utf8");
      if (typeof cb === "function") cb();
      return true;
    },
    read() {
      return out;
    },
  };
}
