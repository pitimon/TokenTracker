# TokenTracker OpenWiki

TokenTracker is a local-first token-usage tracker. The Node CLI parses supported
tool logs into local queue files, serves a dashboard on loopback, and can be
bundled by the macOS and Windows desktop applications.

Start with [architecture](architecture/overview.md) for the data flow. Use these
pages for change-oriented source maps:

- [CLI and operations](cli-and-operations.md)
- [Parsers and sync](parsers-and-sync.md)
- [Local API](local-api.md)
- [Dashboard routes](dashboard-routes.md)
- [Native app boundaries](native-app-boundaries.md)
- [Testing and release](testing-and-release.md)

## Source of truth

`CLAUDE.md` is the repository workflow and release authority. The machine-derived
ledger at `openwiki-facts/source-facts.json` is the authority for documented CLI
commands, local `/functions/tokentracker-*` endpoints, dashboard paths, and
incremental parser symbols. Regenerate it with:

```bash
npm run docs:openwiki:extract
npm run docs:openwiki:check
```

## Local flow

```text
Tool logs and hooks -> src/lib/rollout.js -> local queue files
    -> src/lib/local-api.js -> dashboard/dist -> browser or native WebView
```

The data contract uses token counts and timestamps. Do not add prompts, message
bodies, or other conversation content to the queue or documentation.

## Common entry points

- `bin/tracker.js` invokes `src/cli.js`.
- `src/commands/serve.js` hosts the built dashboard and local API on loopback.
- `src/commands/sync.js` coordinates parser runs.
- `dashboard/src/App.jsx` selects dashboard pages by pathname.
- `TokenTrackerBar/` and `TokenTrackerWin/` bundle the CLI and built dashboard.

Run `npm run ci:local` before a release-bound change. It includes the OpenWiki
deterministic check; the model-backed update and independent review remain local
review steps.
