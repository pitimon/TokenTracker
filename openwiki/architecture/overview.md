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

For how usage data moves through these components step by step, see
[Data flow](dataflow.md).

## Boundaries

- Parser changes begin in `src/lib/rollout.js`, then require sync and token-cost
  regression coverage.
- Local endpoint changes begin in `src/lib/local-api.js`; see [Local API](../local-api.md).
- Dashboard route changes begin in `dashboard/src/App.jsx`; see
  [Dashboard routes](../dashboard-routes.md).
- Native bridge and wrapper source is archived and unsupported; it is not an active architecture boundary.

## Privacy and persistence

TokenTracker is designed around local token-usage records. `CLAUDE.md` defines
the queue columns and explicitly excludes prompts, messages, and conversation
bodies. Treat that constraint as a product boundary when adding a parser, API,
or documentation example.

## Build boundaries

`dashboard/dist/` is the npm package's browser UI output. Changes under `src/` or `dashboard/` that affect shipped behavior follow the npm-only path in [Testing and release](../testing-and-release.md). Archived native projects do not participate in active builds or versioning.
