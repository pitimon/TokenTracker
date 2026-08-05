const fs = require("node:fs/promises");
const { findRowViolations } = require("./queue-compact");
const { constants } = require("node:fs");
const path = require("node:path");

const { readJsonStrict } = require("./fs");

// Stands in for a check whose `id` is missing or not a usable string, so that such
// a check can still be counted rather than silently dropped. See rule 2 in
// `listDegradedChecks`.
const UNNAMED_CHECK_ID = "(unnamed)";

async function buildDoctorReport({
  runtime = {},
  diagnostics = null,
  fetch = globalThis.fetch,
  now = () => new Date(),
  paths = {},
  system = null,
  ingest = null,
} = {}) {
  const checks = [];

  checks.push(...buildRuntimeChecks(runtime));
  if (system) {
    checks.push(...(await buildSystemChecks(system)));
  }

  if (paths.trackerDir) {
    checks.push(await checkTrackerDir(paths.trackerDir));
  }
  if (paths.configPath) {
    checks.push(await checkConfigJson(paths.configPath));
  }
  if (paths.cliPath) {
    checks.push(await checkCliEntrypoint(paths.cliPath));
  }
  if (paths.queuePath) {
    checks.push(await checkQueueRows(paths.queuePath));
  }

  // No cloud reachability check: TokenTracker is local-only, so there is no
  // remote endpoint whose availability could affect anything here.

  if (ingest) {
    const suppression = buildTranscriptSuppressionCheck(ingest.transcriptSuppression);
    if (suppression) checks.push(suppression);
  }

  if (diagnostics) {
    checks.push(...buildDiagnosticsChecks(diagnostics));
  }

  const summary = summarizeChecks(checks);
  const degradedChecks = listDegradedChecks(checks);

  return {
    version: 1,
    generated_at: now().toISOString(),
    ok: summary.critical === 0,
    // `ok` answers "should this exit non-zero", and only `critical` moves it.
    // A warning therefore leaves an entirely green-looking report, which is
    // exactly how a source going unrecorded stayed invisible. `degraded` is the
    // machine-readable half of that distinction: automation can alert on it
    // without any existing caller's exit code changing.
    //
    // It counts every warn and fail except a warn whose check marked itself
    // `advisory`. A first version counted every warn, which made it useless on the
    // one machine it was written for: that box carries a standing
    // `queue.row_invariant` warn about two parseable invariant violations, so
    // `degraded` read true
    // on a perfectly healthy day and an alert wired to it could never clear. An
    // always-on alert and an alert that never fires fail the same way.
    // `listDegradedChecks` holds the exact rule including its two fail-closed
    // clauses. Advisory is assigned at the individual warning return site: a
    // standing condition can opt out without muting an actionable warning from
    // the same check id.
    degraded: degradedChecks.length > 0,
    // Which checks put it there. Without this, `degraded: true` is unactionable —
    // a consumer has to re-derive the reason by walking `checks` itself, and a
    // human reading the JSON cannot tell a new problem from the standing one.
    degraded_checks: degradedChecks,
    summary,
    checks,
    diagnostics,
  };
}

// A check is advisory when its warn describes a standing condition the operator
// cannot act on in the moment. Such a check still reports `warn` and still appears
// in `summary.warn`: the report does not become quieter, only the alert signal
// becomes specific. Anything that does not opt in counts, so a new check is
// alert-worthy by default and has to argue its way out.
//
// Two rules here are deliberately fail-CLOSED, because the failure this field
// exists to prevent is a real problem reading as silence, and both were live
// holes in the first version of this function:
//
//   1. `advisory` suppresses a `warn` and NOTHING ELSE. The rationale for the
//      flag is about standing warnings; nothing argues for muting a `fail` on the
//      same id, so a `fail` degrades the report whatever the flag says.
//   2. A check with a missing or malformed `id` is still counted, under
//      UNNAMED_CHECK_ID. The earlier version mapped to `check.id` and then
//      dropped non-strings, so an id typo silently removed a genuine warn from
//      `degraded` altogether — it rendered as `[WARN] unknown` to a human and as
//      nothing at all to automation. A placeholder keeps `degraded` and
//      `degraded_checks` honest and in agreement.
function listDegradedChecks(checks = []) {
  return checks
    .filter((check) => check && (check.status === "warn" || check.status === "fail"))
    // A malformed id overrides advisory suppression. Advisory is an explicit
    // classification made at a known warning call site; if that identity is
    // lost, fail closed under the placeholder rather than silently dropping it.
    .filter((check) => !(
      check.status === "warn"
      && check.advisory === true
      && typeof check.id === "string"
      && check.id.trim().length > 0
    ))
    .map((check) =>
      typeof check.id === "string" && check.id.trim().length > 0 ? check.id : UNNAMED_CHECK_ID,
    )
    .sort();
}

// Reports Claude CLI processes that were started with `--no-session-persistence`.
// Those sessions write no transcript, and transcripts are the only thing the
// Claude parser can read, so their tokens are unobservable to TokenTracker.
//
// Returns null when the platform cannot answer the question at all. A check that
// was never run must not be printed as `[OK]` — absence is honest, a green line
// would not be.
function buildTranscriptSuppressionCheck(detection) {
  if (!detection || detection.supported === false) return null;

  const id = "ingest.transcript_suppressed";

  if (!detection.checked) {
    return {
      id,
      status: "warn",
      detail: "Could not read the process list, so transcript-suppressed sessions were not checked",
      critical: false,
      meta: { checked: false, reason: detection.reason || "process_list_failed" },
    };
  }

  const count = Number(detection.count) || 0;
  if (count === 0) {
    return {
      id,
      status: "ok",
      detail: "No Claude CLI process is running with --no-session-persistence",
      critical: false,
      meta: { checked: true, count: 0, models: [] },
    };
  }

  const models = Array.isArray(detection.models) ? detection.models : [];
  const modelSuffix = models.length ? ` (${models.join(", ")})` : "";
  return {
    id,
    status: "warn",
    detail:
      `${count} Claude CLI process${count === 1 ? "" : "es"} running with --no-session-persistence${modelSuffix}`
      + " - these sessions write no transcript, so their token usage cannot be recorded",
    critical: false,
    meta: { checked: true, count, models },
  };
}

async function buildSystemChecks({
  nodeVersion = process.version,
  platform = process.platform,
  env = process.env,
  commandExists = commandExistsOnPath,
} = {}) {
  return [
    buildNodeVersionCheck(nodeVersion),
    await buildBrowserOpenerCheck({ platform, env, commandExists }),
  ];
}

function buildNodeVersionCheck(nodeVersion) {
  const major = parseNodeMajor(nodeVersion);
  const ok = Number.isFinite(major) && major >= 20;
  return {
    id: "runtime.node_version",
    status: ok ? "ok" : "fail",
    detail: ok ? `Node.js ${nodeVersion} satisfies >=20` : `Node.js ${nodeVersion || "unknown"} is below required >=20`,
    critical: !ok,
    meta: {
      node_version: nodeVersion || null,
      required_major: 20,
    },
  };
}

async function buildBrowserOpenerCheck({ platform = process.platform, env = process.env, commandExists }) {
  const headless = isHeadlessEnvironment({ platform, env });
  if (headless) {
    // Standing environment property: neither --no-open nor opening the printed
    // URL manually can make a headless session acquire a browser opener.
    return {
      id: "browser.opener",
      status: "warn",
      detail: "headless/session environment detected; use --no-open or open the printed URL manually",
      critical: false,
      advisory: true,
      meta: { platform, command: null, headless: true },
    };
  }

  if (platform === "win32") {
    return {
      id: "browser.opener",
      status: "ok",
      detail: "Windows browser opener uses cmd /c start",
      critical: false,
      meta: { platform, command: "cmd", headless: false },
    };
  }

  const command = platform === "darwin" ? "open" : "xdg-open";
  const exists = await commandExists(command, env);
  return {
    id: "browser.opener",
    status: exists ? "ok" : "warn",
    detail: exists
      ? `${command} available`
      : command === "xdg-open"
        ? "xdg-open missing; install xdg-utils or use --no-open"
        : `${command} missing; use --no-open`,
    critical: false,
    meta: {
      platform,
      command,
      headless: false,
      linux_fix: command === "xdg-open" && !exists ? "sudo apt install -y xdg-utils" : null,
    },
  };
}

function parseNodeMajor(nodeVersion) {
  const match = String(nodeVersion || "").match(/^v?(\d+)/);
  return match ? Number(match[1]) : NaN;
}

function isHeadlessEnvironment({ platform, env = {} } = {}) {
  if (env.CI === "true" || env.HEADLESS === "true" || env.TOKENTRACKER_HEADLESS === "1") return true;
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY && !env.WSL_DISTRO_NAME) return true;
  return false;
}

async function commandExistsOnPath(command, env = process.env) {
  const pathValue = env.PATH || "";
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try {
      await fs.access(candidate, constants.X_OK);
      return true;
    } catch (_e) {}
  }
  return false;
}

function buildRuntimeChecks(runtime = {}) {
  const checks = [];
  const dashboardUrl =
    typeof runtime.dashboardUrl === "string" && runtime.dashboardUrl.trim()
      ? runtime.dashboardUrl.trim()
      : null;
  const httpTimeoutMs = Number.isFinite(Number(runtime.httpTimeoutMs))
    ? Number(runtime.httpTimeoutMs)
    : null;
  const debug = Boolean(runtime.debug);

  // base URL / device token checks removed: local-only, there is no remote
  // endpoint to point at and no credential to hold.

  checks.push({
    id: "runtime.dashboard_url",
    status: "ok",
    detail: dashboardUrl ? "dashboard_url set" : "dashboard_url unset",
    critical: false,
    meta: {
      dashboard_url: dashboardUrl,
      source: runtime?.sources?.dashboardUrl || null,
    },
  });

  checks.push({
    id: "runtime.http_timeout_ms",
    status: "ok",
    detail: "http timeout resolved",
    critical: false,
    meta: {
      http_timeout_ms: httpTimeoutMs,
      source: runtime?.sources?.httpTimeoutMs || null,
    },
  });

  checks.push({
    id: "runtime.debug",
    status: "ok",
    detail: debug ? "debug enabled" : "debug disabled",
    critical: false,
    meta: {
      debug,
      source: runtime?.sources?.debug || null,
    },
  });

  // runtime.auto_retry_no_spawn removed: scheduleAutoRetry and
  // spawnAutoRetryProcess went with cloud upload, so this reported on a spawn
  // path that cannot happen — and told anyone setting the env var that their
  // opt-out had taken effect on nothing.


  return checks;
}

async function checkTrackerDir(trackerDir) {
  try {
    const st = await fs.stat(trackerDir);
    if (!st.isDirectory()) {
      return {
        id: "fs.tracker_dir",
        status: "fail",
        detail: "tracker dir is not a directory",
        critical: true,
        meta: { path: trackerDir },
      };
    }
    await fs.access(trackerDir, constants.R_OK);
    return {
      id: "fs.tracker_dir",
      status: "ok",
      detail: "tracker dir readable",
      critical: false,
      meta: { path: trackerDir },
    };
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return {
        id: "fs.tracker_dir",
        status: "warn",
        detail: "tracker dir missing",
        critical: false,
        meta: { path: trackerDir },
      };
    }
    if (err && (err.code === "EACCES" || err.code === "EPERM")) {
      return {
        id: "fs.tracker_dir",
        status: "fail",
        detail: "tracker dir permission denied",
        critical: true,
        meta: { path: trackerDir, code: err.code },
      };
    }
    return {
      id: "fs.tracker_dir",
      status: "fail",
      detail: "tracker dir error",
      critical: true,
      meta: { path: trackerDir, code: err?.code || "error" },
    };
  }
}

async function checkConfigJson(configPath) {
  const res = await readJsonStrict(configPath);
  if (res.status === "ok") {
    return {
      id: "fs.config_json",
      status: "ok",
      detail: "config.json readable",
      critical: false,
      meta: { path: configPath },
    };
  }
  if (res.status === "missing") {
    return {
      id: "fs.config_json",
      status: "warn",
      detail: "config.json missing",
      critical: false,
      meta: { path: configPath },
    };
  }
  if (res.status === "invalid") {
    return {
      id: "fs.config_json",
      status: "fail",
      detail: "config.json invalid",
      critical: true,
      meta: { path: configPath },
    };
  }
  return {
    id: "fs.config_json",
    status: "fail",
    detail: "config.json read error",
    critical: true,
    meta: { path: configPath },
  };
}

async function checkCliEntrypoint(cliPath) {
  try {
    const st = await fs.stat(cliPath);
    if (!st.isFile()) {
      return {
        id: "cli.entrypoint",
        status: "fail",
        detail: "cli entrypoint is not a file",
        critical: false,
        meta: { path: cliPath },
      };
    }
    await fs.access(cliPath, constants.R_OK);
    if (process.platform !== "win32") {
      await fs.access(cliPath, constants.X_OK);
    }
    return {
      id: "cli.entrypoint",
      status: "ok",
      detail: "cli entrypoint readable",
      critical: false,
      meta: { path: cliPath },
    };
  } catch (err) {
    return {
      id: "cli.entrypoint",
      status: "fail",
      detail: "cli entrypoint not accessible",
      critical: false,
      meta: { path: cliPath, code: err?.code || "error" },
    };
  }
}


function buildDiagnosticsChecks(diagnostics) {
  const checks = [];
  const notify = diagnostics?.notify || {};
  const notifyConfigured = Boolean(
    notify.codex_notify_configured ||
    notify.every_code_notify_configured ||
    notify.claude_hook_configured ||
    notify.gemini_hook_configured ||
    notify.opencode_plugin_configured ||
    notify.openclaw_hook_configured ||
    notify.openclaw_session_plugin_configured ||
    notify.grok_hook_configured,
  );

  // This aggregate describes an optional integration preference, not whether
  // passive log ingestion works. `init` also skips hooks for providers whose
  // config is absent, so "none configured" can be a stable, intentional state.
  // Keep only that warn advisory; this check currently has no fail path.
  checks.push({
    id: "notify.configured",
    status: notifyConfigured ? "ok" : "warn",
    detail: notifyConfigured ? "notify configured" : "notify not configured",
    critical: false,
    ...(notifyConfigured ? {} : { advisory: true }),
    meta: { configured: notifyConfigured },
  });

  // The upload.last_error check is gone with cloud upload: `diagnostics.upload`
  // no longer exists, so the check could only ever report "no upload errors" —
  // a permanent green that says nothing.

  return checks;
}

function summarizeChecks(checks = []) {
  const summary = { ok: 0, warn: 0, fail: 0, critical: 0 };
  for (const check of checks) {
    if (!check || typeof check.status !== "string") continue;
    if (check.status === "ok") summary.ok += 1;
    else if (check.status === "warn") summary.warn += 1;
    else if (check.status === "fail") summary.fail += 1;
    if (check.status === "fail" && check.critical) summary.critical += 1;
  }
  return summary;
}

// CLAUDE.md states the column invariant in prose:
//
//   total = input + output + cache_creation + cache_read + reasoning
//
// Nothing enforced it at runtime, so a miswritten or corrupt row was aggregated
// and rendered rather than flagged — and a parser bug of exactly that shape is
// the class CLAUDE.md records at 1.6-7x magnitude. Same conversion as the
// curated-expiry and version-lockstep checks: a rule that lived in a document
// starts running.
//
// A warn rather than a fail: the rows are already on disk and already being
// rendered, so failing the whole health check would be reporting a crisis the
// user cannot act on in the moment. What they can act on is knowing which rows,
// and how many.
const QUEUE_VIOLATIONS_SHOWN = 5;

// `advisory: true` keeps a warn out of `degraded` and `degraded_checks` while
// leaving it a full `warn` in `checks` and in `summary.warn`. The flag is decided
// PER CALL SITE, not once for this check id, because the two warns this check can
// emit are not the same kind of thing:
//
//   - a parseable row-invariant violation IS advisory: the row is already written
//     and rendered, so there is nothing the operator can do at report time.
//   - an unparseable line or unreadable queue is NOT. Those conditions omit usage
//     or can stop ingestion and are actionable (corruption, permissions, disk).
//
// An earlier version of this function stamped `advisory: true` on everything it
// returned, which silenced the unreadable case: `warn` in `checks`,
// `degraded: false` on the wire. Default is NOT advisory, so a new call site has
// to argue its way out rather than inherit silence.
function queueCheck(status, detail, meta, { advisory = false } = {}) {
  const check = { id: "queue.row_invariant", status, detail, critical: false, meta };
  return advisory ? { ...check, advisory: true } : check;
}

async function readQueueRowsForDoctor(queuePath) {
  const raw = await fs.readFile(queuePath, "utf8");
  const rows = [];
  let malformed = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  return { rows, malformed };
}

async function checkQueueRows(queuePath) {
  let rows;
  let malformed;
  try {
    ({ rows, malformed } = await readQueueRowsForDoctor(queuePath));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return queueCheck("ok", "no queue yet", { path: queuePath });
    }
    return queueCheck("warn", `queue unreadable: ${err?.message || err}`, { path: queuePath });
  }

  const violations = findRowViolations(rows);
  if (violations.length === 0 && malformed === 0) {
    return queueCheck("ok", `${rows.length} rows satisfy the column invariant`, {
      path: queuePath,
      rows: rows.length,
    });
  }

  const parts = [];
  if (violations.length > 0) parts.push(`${violations.length} row problem(s)`);
  if (malformed > 0) parts.push(`${malformed} unparseable line(s)`);
  // Parseable invariant violations are already on disk and already aggregated
  // into what the dashboard renders, so they are advisory. Malformed lines are
  // skipped by local-api readers and their usage is absent; corruption or a
  // partial write is actionable and must degrade the report.
  return queueCheck(
    "warn",
    `${parts.join(", ")} in ${rows.length + malformed} line(s)`,
    {
      path: queuePath,
      rows: rows.length,
      malformed,
      violations: violations.length,
      examples: violations.slice(0, QUEUE_VIOLATIONS_SHOWN),
    },
    { advisory: malformed === 0 },
  );
}

module.exports = {
  buildDoctorReport,
  buildTranscriptSuppressionCheck,
  listDegradedChecks,
  UNNAMED_CHECK_ID,
  checkQueueRows,
  buildBrowserOpenerCheck,
  buildNodeVersionCheck,
  isHeadlessEnvironment,
};
