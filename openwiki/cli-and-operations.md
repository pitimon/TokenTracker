# CLI and Operations

`src/cli.js` dispatches these commands. The exact options are maintained in its
help text and command modules; do not infer additional options from examples.

| Command | Source module |
| --- | --- |
| `tokentracker serve` | `src/commands/serve.js` |
| `tokentracker init` | `src/commands/init.js` |
| `tokentracker sync` | `src/commands/sync.js` |
| `tokentracker status` | `src/commands/status.js` |
| `tokentracker diagnostics` | `src/commands/diagnostics.js` |
| `tokentracker doctor` | `src/commands/doctor.js` |
| `tokentracker uninstall` | `src/commands/uninstall.js` |
| `tokentracker wrapped` | `src/commands/wrapped.js` |

Calling `tokentracker` with no command starts `serve` with sync enabled by
`src/cli.js`. Invoking `serve` directly does not add that default argument.

## Serve

Use the local server to exercise CLI and dashboard changes together:

```bash
node bin/tracker.js serve --no-sync
```

The server uses loopback binding. It serves API and proxy prefixes before the
built dashboard, then uses the SPA fallback. Browser launch is opt-in with
`--open`; opener failures are warnings so headless and service environments can
use the displayed URL.

## Operations checks

`doctor` produces a human-readable report or JSON. `status` reports installation
and integration state. `diagnostics` writes a diagnostics report when given its
output option. Read the relevant command implementation before documenting a
new report field or command option.

The JSON report carries two separate verdicts. `ok` answers "should this exit
non-zero", and only a `critical` check moves it — that is the existing exit-code
contract and it is unchanged. `degraded` exists because a warning otherwise
leaves an entirely green-looking report, which is how a source that had stopped
being recorded stayed invisible for two days.

`degraded` is true when at least one check is `warn` or `fail`, except that a
`warn` marked `advisory` does not count. A `fail` always counts, `advisory` or
not. `degraded_checks` lists the ids that put it there, sorted, so `degraded:
true` says which condition rather than only that one exists; a check whose `id`
is missing or unusable is still counted, under `(unnamed)`, rather than dropped.
`listDegradedChecks` in `src/lib/doctor.js` is the rule — read it rather than
this paragraph if the two ever disagree.

`advisory` is decided **per emitted warn, not per check id**. It marks a standing
condition that cannot be cleared by operator action at report time. An advisory
warn remains in `checks` and `summary.warn`; only `degraded` and
`degraded_checks` ignore it. The opt-in is the literal boolean `true`, and only
for status `warn`: a fail always degrades, malformed or missing ids are named
`(unnamed)`, and every new/unclassified warn is alert-worthy by default.

The current warning-path audit is:

| Check and emitted condition | Classification | Reason |
| --- | --- | --- |
| `browser.opener`: headless/session environment | Advisory | Headlessness is a standing host/session property; `--no-open` or manually opening the URL does not clear it. |
| `browser.opener`: `open`/`xdg-open` missing on a non-headless host | Actionable | Install the opener (`xdg-utils` on Linux) or deliberately use `--no-open`. |
| `notify.configured`: no supported notify/hook integration configured | Advisory | The integrations are optional and provider-specific; `init` skips absent provider configs, and passive readers do not require hooks. This aggregate check has no fail path. |
| `queue.row_invariant`: parseable rows violating the column invariant | Advisory | The rows are already on disk and already rendered; the warning remains visible for diagnosis. |
| `queue.row_invariant`: unparseable lines | Actionable | Local API readers skip malformed lines, so their usage is absent; corruption or a partial write must degrade the report. |
| `queue.row_invariant`: queue unreadable | Actionable | Permissions, disk, or file-type problems can stop ingestion. The shared check id does not inherit the advisory flag. |
| `ingest.transcript_suppressed`: process list could not be read | Actionable | Doctor could not verify whether unrecordable Claude sessions are running. |
| `ingest.transcript_suppressed`: one or more `--no-session-persistence` sessions | Actionable | Those sessions write no transcript, so their token usage cannot be recorded. |
| `fs.tracker_dir`: tracker directory missing | Actionable | Initialization can create the required local state. Permission and type errors are fails, not warns. |
| `fs.config_json`: config missing | Actionable | Initialization can create it. Invalid or unreadable config is a fail, not a warn. |

The remaining doctor checks have no warning path: `runtime.node_version` and
`cli.entrypoint` fail closed; `runtime.dashboard_url`,
`runtime.http_timeout_ms`, and `runtime.debug` are informational `ok` checks.
`buildDiagnosticsChecks` currently emits only `notify.configured`. A check that
cannot run on an unsupported platform is omitted rather than reported as `ok`.

This distinction is the point of the field: an earlier version counted every
warn, and on a machine carrying one standing row-invariant warning it read
`true` on a healthy day. An alert that can never clear and an alert that never
fires are the same defect.

## Service and release operations

Local service installers live under `scripts/`. The authoritative release and
LaunchAgent workflow is in `CLAUDE.md`; on this workstation, verify the actual
listener and LaunchAgent command before diagnosing dashboard behavior.
