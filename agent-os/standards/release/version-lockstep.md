# npm Version and Local Web Release

## Authority

- `CLAUDE.md`
- `openwiki/testing-and-release.md`
- `package.json`
- `.github/workflows/npm-publish.yml`
- `scripts/release.sh`
- `test/npm-publish-workflow.test.js`
- `test/release-automation.test.js`

## Applies when

Changing `src/`, `dashboard/`, package version metadata, npm packaging/publishing, or local browser-dashboard LaunchAgent behavior.

## Required behavior

- npm is the sole active release artifact; archived native source and project versions are outside the release contract.
- Keep `package.json` and `package-lock.json` versions synchronized.
- Verify the target npm version is unused; published versions are immutable.
- Rebuild `dashboard/dist` before publish and semantically inspect the exact registry artifact.
- Keep npm authentication with the approved human/OIDC boundary and inspect pricing-seed changes before recording release state.
- Verify dashboard and local-sync LaunchAgent pins, listener, HTTP status, and served target version after local deployment.

## Verification

```bash
node --test test/npm-publish-workflow.test.js test/release-automation.test.js test/web-only-product-scope.test.js
npm publish --dry-run --json
npm run ci:local
```

Publishing and local deployment remain explicit external approval gates.

## Do not infer

- A green source test proves the registry artifact or served browser bundle is current.
- A successful manual publish proves GitHub Actions publishing works.
- Updating one LaunchAgent pin is sufficient.
- Archived DMG/Windows workflows or project versions are active release authorities.
- A docs/tests/CI-only change requires a product version bump unless its actual release surface says otherwise.
