const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { buildDoctorReport, listDegradedChecks } = require("../src/lib/doctor");
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

test("doctor warns on transcript-suppressed sessions and marks the report degraded", async () => {
  const report = await buildDoctorReport({
    runtime: { baseUrl: "https://example" },
    ingest: {
      transcriptSuppression: {
        supported: true,
        checked: true,
        count: 2,
        models: ["glm-5-turbo"],
        reason: null,
      },
    },
  });

  const check = report.checks.find((c) => c.id === "ingest.transcript_suppressed");
  assert.equal(check.status, "warn");
  assert.equal(check.critical, false);
  assert.equal(check.meta.count, 2);
  assert.deepEqual(check.meta.models, ["glm-5-turbo"]);
  assert.match(check.detail, /--no-session-persistence/);

  // The warning must be machine-readable without changing the exit contract:
  // `ok` still governs the exit code, `degraded` is the new signal.
  assert.equal(report.degraded, true);
  assert.equal(report.ok, true);
});

test("doctor omits the suppression check where the platform cannot answer it", async () => {
  const report = await buildDoctorReport({
    runtime: {},
    ingest: {
      transcriptSuppression: {
        supported: false,
        checked: false,
        count: 0,
        models: [],
        reason: "unsupported_platform",
      },
    },
  });

  // Absent, not [OK] — a check that never ran must not read as one that passed.
  assert.equal(
    report.checks.find((c) => c.id === "ingest.transcript_suppressed"),
    undefined,
  );
  assert.equal(report.degraded, false);
});

test("doctor warns when the process list could not be read at all", async () => {
  const report = await buildDoctorReport({
    runtime: {},
    ingest: {
      transcriptSuppression: {
        supported: true,
        checked: false,
        count: 0,
        models: [],
        reason: "process_list_failed",
      },
    },
  });

  const check = report.checks.find((c) => c.id === "ingest.transcript_suppressed");
  assert.equal(check.status, "warn");
  assert.equal(check.meta.checked, false);
  assert.equal(check.meta.reason, "process_list_failed");
});

test("doctor reports a clean suppression check and stays undegraded", async () => {
  const report = await buildDoctorReport({
    runtime: {},
    ingest: {
      transcriptSuppression: {
        supported: true,
        checked: true,
        count: 0,
        models: [],
        reason: null,
      },
    },
  });

  const check = report.checks.find((c) => c.id === "ingest.transcript_suppressed");
  assert.equal(check.status, "ok");
  assert.equal(report.degraded, false);
  assert.deepEqual(report.degraded_checks, []);
});

// --- #130: `degraded` counts non-advisory warns only -------------------------
//
// The first version counted every warn. On the machine that reported #128 that
// made it useless: a standing `queue.row_invariant` warning about two malformed
// rows meant `degraded` read true on a healthy day, so an alert wired to it could
// never clear. These pin the narrowed contract.

test("listDegradedChecks counts a plain warn or fail and names it", () => {
  assert.deepEqual(
    listDegradedChecks([
      { id: "a.ok", status: "ok" },
      { id: "b.warn", status: "warn" },
      { id: "c.fail", status: "fail" },
    ]),
    ["b.warn", "c.fail"],
  );
});

test("listDegradedChecks skips a check that opted out via advisory", () => {
  assert.deepEqual(
    listDegradedChecks([
      { id: "standing.warn", status: "warn", advisory: true },
      { id: "real.warn", status: "warn" },
    ]),
    ["real.warn"],
  );
});

// Opting out must be explicit. A future check that forgets the flag has to show
// up in the alert signal, not vanish from it — the failure this whole field
// exists to prevent is a problem that reads as silence.
test("listDegradedChecks treats anything but advisory:true as alert-worthy", () => {
  for (const advisory of [undefined, null, false, 0, "true", "yes", 1]) {
    assert.deepEqual(
      listDegradedChecks([{ id: "x.warn", status: "warn", advisory }]),
      ["x.warn"],
      `advisory=${JSON.stringify(advisory)} must not suppress the check`,
    );
  }
});

test("a queue row violation warns and is counted, but does not degrade the report", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-degraded-advisory-"));
  const queuePath = path.join(tmp, "queue.jsonl");
  try {
    // total_tokens disagrees with the column sum (1 + 1 = 2, not 999), which is
    // exactly the invariant `queue.row_invariant` exists to catch.
    await fs.writeFile(
      queuePath,
      `${JSON.stringify({
        source: "claude",
        model: "m",
        hour_start: "2026-07-30T00:00:00.000Z",
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cached_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 999,
      })}\n`,
      "utf8",
    );

    const report = await buildDoctorReport({ runtime: {}, paths: { queuePath } });
    const check = report.checks.find((c) => c.id === "queue.row_invariant");

    // The report does not get quieter: still a warn, still counted.
    assert.equal(check.status, "warn");
    assert.equal(check.advisory, true);
    assert.ok(report.summary.warn >= 1, "an advisory warn still counts in summary.warn");

    // Only the alert signal narrows.
    assert.equal(report.degraded, false);
    assert.deepEqual(report.degraded_checks, []);
    assert.equal(report.ok, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a standing queue warn does not mask a real one arriving beside it", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-degraded-both-"));
  const queuePath = path.join(tmp, "queue.jsonl");
  try {
    await fs.writeFile(
      queuePath,
      `${JSON.stringify({
        source: "claude",
        model: "m",
        hour_start: "2026-07-30T00:00:00.000Z",
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cached_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 999,
      })}\n`,
      "utf8",
    );

    const report = await buildDoctorReport({
      runtime: {},
      paths: { queuePath },
      ingest: {
        transcriptSuppression: {
          supported: true,
          checked: true,
          count: 1,
          models: ["glm-5-turbo"],
          reason: null,
        },
      },
    });

    // Two warns present; only the actionable one reaches the alert signal, and
    // `degraded_checks` says which — the whole point of #130.
    assert.equal(report.summary.warn, 2);
    assert.equal(report.degraded, true);
    assert.deepEqual(report.degraded_checks, ["ingest.transcript_suppressed"]);
  } finally {
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
