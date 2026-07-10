# Architecture

## Runtime components

The CommonJS CLI starts at `bin/tracker.js` and dispatches in `src/cli.js`.
`serve` creates a loopback HTTP server in `src/commands/serve.js`; it delegates
local dynamic paths to `src/lib/local-api.js` and static paths to the built
dashboard.

`sync` in `src/commands/sync.js` coordinates incremental readers from
`src/lib/rollout.js`. The runtime queue path is resolved by `src/lib/local-api.js`;
the main queue reader keeps the latest record for each `(source, model,
hour_start)` key.

The React dashboard is built from `dashboard/` into `dashboard/dist/`. Its route
selection is implemented in `dashboard/src/App.jsx`, and its local API client is
`dashboard/src/lib/api.ts`.

## Boundaries

- Parser changes begin in `src/lib/rollout.js`, then require sync and token-cost
  regression coverage.
- Local endpoint changes begin in `src/lib/local-api.js`; see [Local API](../local-api.md).
- Dashboard route changes begin in `dashboard/src/App.jsx`; see
  [Dashboard routes](../dashboard-routes.md).
- Native bridge changes span `TokenTrackerBar/TokenTrackerBar/Services/NativeBridge.swift` and
  `dashboard/src/lib/native-bridge.js`.

## Privacy and persistence

TokenTracker is designed around local token-usage records. `CLAUDE.md` defines
the queue columns and explicitly excludes prompts, messages, and conversation
bodies. Treat that constraint as a product boundary when adding a parser, API,
or documentation example.

## Build boundaries

`dashboard/dist/` is an output artifact. The macOS and Windows builds bundle the
CLI and this output, so changes under `src/` or `dashboard/` are release-bound
and must follow [Testing and release](../testing-and-release.md).
