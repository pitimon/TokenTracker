# Version Lockstep

## Authority

- `CLAUDE.md`
- `openwiki/testing-and-release.md`
- `package.json`
- `scripts/release.sh`
- `test/version-lockstep.test.js`
- `test/npm-publish-workflow.test.js`

## Applies when

Changing `src/`, `dashboard/`, either native wrapper, version metadata, packaging, LaunchAgent behavior, npm publishing, or the macOS/Windows release workflows.

## Required behavior

- Treat changes under `src/` or `dashboard/` as npm, macOS, and Windows release-bound.
- Keep package, lockfile, both macOS marketing versions, and Windows package version synchronized.
- Verify the target npm version is unused before publishing; published versions are immutable.
- Keep npm MFA with the human and inspect post-publish pricing-seed changes before recording release state.
- Keep the combined release draft unpublished until required platform assets succeed.
- Verify both dashboard and local-sync LaunchAgent pins when release tooling changes.

## Verification

```bash
npm run validate:version-lockstep
node --test test/version-lockstep.test.js test/npm-publish-workflow.test.js test/release-dmg-workflow.test.js test/release-windows-workflow.test.js
npm pack --dry-run --json
npm run ci:local
```

Publishing and release dispatch remain explicit external approval gates.

## Do not infer

- A green npm test proves desktop bundles are current.
- A tag or draft release proves npm or both native assets were published.
- Updating one version location or one LaunchAgent pin is sufficient.
- A docs/scripts-only change requires a product version bump unless its actual release surface says otherwise.
