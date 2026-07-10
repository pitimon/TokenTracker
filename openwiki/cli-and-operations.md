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
| `tokentracker device-login` | `src/commands/device-login.js` |
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

## Service and release operations

Local service installers live under `scripts/`. The authoritative release and
LaunchAgent workflow is in `CLAUDE.md`; on this workstation, verify the actual
listener and LaunchAgent command before diagnosing dashboard behavior.
