# Working on this documentation

How to keep these pages true: where the authority lives, which commands
regenerate it, and the entry points worth knowing before you edit. For the map
of the pages themselves, start at [the OpenWiki index](README.md).

## Source of truth

`CLAUDE.md` is the repository workflow and release authority. The machine-derived
ledger at `openwiki-facts/source-facts.json` is the authority for documented CLI
commands, local `/functions/tokentracker-*` endpoints, dashboard paths, and
incremental parser symbols. Regenerate it with:

```bash
npm run docs:openwiki:extract
npm run docs:openwiki:check
```

The check runs two different ways over two different file sets:

- **Every reference must resolve** — across `openwiki/**`, plus `README.md` and
  `CONTRIBUTING.md`. A CLI command, `/functions/*` endpoint, dashboard route, or
  `parse*Incremental` symbol named in any of them must exist in the ledger. The
  front-door docs are included because that is where readers copy commands from:
  `README.md` spent a long time telling users with a broken install to run a
  repair command the CLI has never had, while this checker passed every time
  without ever looking at that file. There is deliberately no way to silence a
  finding — if a page needs to name something that does not exist, describe it
  instead of quoting it.
- **Every contract must be documented** — `openwiki/**` only. The README is a
  front door, not a manifest; it is not required to list every endpoint.

## Local flow

```text
Tool logs and hooks -> src/lib/rollout.js -> local queue files
    -> src/lib/local-api.js -> dashboard/dist -> browser on localhost
```

The data contract is usage metadata only — source, model, token and conversation counts, timestamps, and derived cost. Never add prompts, responses, message bodies, or private user-code paths to the queue or documentation. Credentials are used only for declared provider authentication or quota flows and their credential files; never place them in TokenTracker queues, logs, fixtures, diagnostics, API responses, or unrelated outbound payloads. Derived cost normally comes from local model pricing; a compatible Hermes row explicitly marked `hermes-actual` may carry its local actual-cost amount without a gateway request.

## Common entry points

- `bin/tracker.js` invokes `src/cli.js`.
- `src/commands/serve.js` hosts the built dashboard and local API on loopback.
- `src/commands/sync.js` coordinates parser runs.
- `dashboard/src/App.jsx` selects dashboard pages by pathname.
- `archive/native-apps/TokenTrackerBar/` and `archive/native-apps/TokenTrackerWin/` are unsupported historical source; there are no active native contracts.

Run `npm run ci:local` before a release-bound change. It includes the OpenWiki
deterministic check; the model-backed update and independent review remain local
review steps.
