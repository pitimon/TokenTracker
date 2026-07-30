const cp = require("node:child_process");

// Shared process-listing primitives. Extracted from usage-limits.js so that a
// second caller (transcript-suppression.js) can reuse the parser instead of
// keeping a second copy of the same regex in the tree.
//
// PRIVACY: callers get raw command lines here, and a command line can contain a
// user's file paths. Nothing in this module writes, logs, caches, or returns a
// command line beyond the synchronous call — that constraint belongs to every
// caller, and CONTRIBUTING.md's rule ("never log, store, transmit, or print ...
// file paths from user code") is what it exists to satisfy.

const PS_BINARY = "/bin/ps";
const PS_ARGS = ["-ax", "-o", "pid=,command="];
const PS_TIMEOUT_MS = 4000;
const PS_MAX_BUFFER = 10 * 1024 * 1024;

function parseProcessLine(line) {
  const match = String(line || "")
    .trim()
    .match(/^(\d+)\s+(.*)$/);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    command: match[2],
  };
}

// `/bin/ps` with these flags is a POSIX assumption. Windows has no equivalent
// at this path, and guessing at `tasklist` output would be an untested code
// path, so the honest answer there is "not supported" rather than "no problems
// found" — the caller must not turn this into a passing check.
function isProcessListSupported(platform = process.platform) {
  return platform !== "win32";
}

// Returns { supported, ok, lines, reason }. `ok: false` never throws: a machine
// that refuses `ps` (sandbox, hardened runtime) is a normal condition here, and
// the caller reports it as "could not check" rather than as "nothing found".
function listProcessLines({ commandRunner, platform = process.platform } = {}) {
  if (!isProcessListSupported(platform)) {
    return { supported: false, ok: false, lines: [], reason: "unsupported_platform" };
  }

  const runner = typeof commandRunner === "function" ? commandRunner : cp.spawnSync;
  let result;
  try {
    result = runner(PS_BINARY, PS_ARGS, {
      encoding: "utf8",
      maxBuffer: PS_MAX_BUFFER,
      timeout: PS_TIMEOUT_MS,
    });
  } catch {
    return { supported: true, ok: false, lines: [], reason: "process_list_failed" };
  }

  if (result?.error || result?.status !== 0) {
    return { supported: true, ok: false, lines: [], reason: "process_list_failed" };
  }

  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  return { supported: true, ok: true, lines: stdout.split("\n"), reason: null };
}

module.exports = {
  PS_ARGS,
  PS_BINARY,
  PS_TIMEOUT_MS,
  isProcessListSupported,
  listProcessLines,
  parseProcessLine,
};
