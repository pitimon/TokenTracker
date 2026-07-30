const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  PS_ARGS,
  PS_BINARY,
  isProcessListSupported,
  listProcessLines,
  parseProcessLine,
} = require("../src/lib/process-list");

// The scan must stay scoped to the user running TokenTracker. `-a` widens `ps`
// to every user on the box, and transcript-suppression serves counts and model
// ids derived from this output over an unauthenticated loopback endpoint — on a
// shared host that turns a local diagnostic into a report on other people's
// sessions. A session TokenTracker could not have recorded is, by definition,
// one this user is running, so the wider scan buys nothing.
//
// Asserted on the literal argv rather than on observed output, because a real
// `ps` run on a single-user machine looks identical either way and would not
// catch the regression.
test("the process scan is scoped to the current user", () => {
  assert.deepEqual(PS_ARGS, ["-x", "-o", "pid=,command="]);
  assert.ok(
    !PS_ARGS.some((arg) => /^-[a-z]*a/.test(arg)),
    "ps must not be invoked with the all-users flag",
  );
});

test("parseProcessLine splits a pid from a command and rejects junk", () => {
  assert.deepEqual(parseProcessLine("  4211 /usr/local/bin/claude --model x"), {
    pid: 4211,
    command: "/usr/local/bin/claude --model x",
  });
  assert.equal(parseProcessLine(""), null);
  assert.equal(parseProcessLine("no-pid-here"), null);
  assert.equal(parseProcessLine(null), null);
});

test("windows is reported as unsupported rather than as a clean scan", () => {
  assert.equal(isProcessListSupported("win32"), false);
  assert.equal(isProcessListSupported("darwin"), true);

  const listed = listProcessLines({ platform: "win32" });
  assert.deepEqual(listed, {
    supported: false,
    ok: false,
    lines: [],
    reason: "unsupported_platform",
  });
});

test("a refused or throwing ps is 'could not check', never 'found nothing'", () => {
  const nonZero = listProcessLines({
    platform: "darwin",
    commandRunner: () => ({ status: 1, stdout: "" }),
  });
  assert.equal(nonZero.ok, false);
  assert.equal(nonZero.supported, true);
  assert.equal(nonZero.reason, "process_list_failed");

  const threw = listProcessLines({
    platform: "darwin",
    commandRunner: () => {
      throw new Error("EPERM");
    },
  });
  assert.equal(threw.ok, false);
  assert.equal(threw.reason, "process_list_failed");
});

test("the real /bin/ps invocation succeeds on this POSIX host", { skip: process.platform === "win32" }, () => {
  // Every other test in this file and in transcript-suppression.test.js injects
  // a fake runner, so a broken real invocation — a bad flag, a renamed binary, a
  // changed `-o` spec — would pass the whole suite. This drives the default
  // `cp.spawnSync` path with no injection at all.
  const listed = listProcessLines({});

  assert.equal(listed.supported, true);
  assert.equal(listed.ok, true, `${PS_BINARY} ${PS_ARGS.join(" ")} must succeed on a POSIX host`);
  assert.ok(listed.lines.length > 1, "a live process list is never one line");

  const parsed = listed.lines.map(parseProcessLine).filter(Boolean);
  assert.ok(parsed.length > 0, "at least one line must parse as '<pid> <command>'");
  assert.ok(
    parsed.every((row) => Number.isInteger(row.pid) && row.pid > 0),
    "every parsed row must carry a real pid",
  );
  // This test process is our own, so a correctly scoped scan must contain it.
  assert.ok(
    parsed.some((row) => row.pid === process.pid),
    "the scan must include the current process",
  );
});
