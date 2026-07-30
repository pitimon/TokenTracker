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

`degraded` is true when at least one check is `warn` or `fail` **and is not
marked `advisory`**. `degraded_checks` lists the ids that put it there, sorted,
so `degraded: true` says which condition rather than only that one exists.

A check sets `advisory: true` when its warn describes a standing condition the
operator cannot act on at the moment they read the report — `queue.row_invariant`
is the one that does today, because the offending rows are already written and
already being rendered. An advisory check is still a full `warn` in `checks` and
still counts in `summary.warn`; the report is not quieter, the alert signal is
narrower. Not opting in is the default, so a new check is alert-worthy unless it
argues otherwise.

That distinction is the whole point of the field: an earlier version counted
every warn, and on a machine carrying one standing row-invariant warning it read
`true` on a healthy day. An alert that can never clear and an alert that never
fires are the same defect.

A check that could not be run on this platform is **omitted** from `checks`
rather than reported as `ok`.

## Service and release operations

Local service installers live under `scripts/`. The authoritative release and
LaunchAgent workflow is in `CLAUDE.md`; on this workstation, verify the actual
listener and LaunchAgent command before diagnosing dashboard behavior.
