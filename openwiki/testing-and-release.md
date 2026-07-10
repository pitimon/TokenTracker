# Testing and Release

The repository's command index is in `package.json`; project policy and the full
release procedure are in `CLAUDE.md`.

## Local validation

```bash
npm run ci:local
npm pack --dry-run --json
```

Use focused Node or dashboard tests while iterating. For UI behavior, run the
dashboard and verify the relevant route in a real browser. Do not treat a static
source check as proof of a live dashboard change.

## OpenWiki validation

```bash
npm run docs:openwiki:extract
npm run docs:openwiki:check
npm run docs:openwiki:verify
```

The deterministic check validates source-backed names and coverage. The last
command invokes Codex in read-only mode to review prose against source. It is a
local review gate, not a CI job, because it uses model access.

## Release boundary

Changes under `src/` or `dashboard/` require the npm plus macOS/Windows release
path described in `CLAUDE.md`. Before publishing, verify that the target package
version is unused, keep all version locations synchronized, and validate the
packaged artifact. Manual npm MFA stays with the human user.
