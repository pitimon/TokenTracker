# npm Publish Checklist

TokenTracker's sole active release artifact is `@ipv9/tokentracker-cli`, containing the loopback CLI backend and built browser dashboard. Native macOS/Windows projects are archived and do not participate in versioning or release.

## Before the PR

1. Confirm the target version is unused:

   ```bash
   npm view @ipv9/tokentracker-cli version versions --json
   ```

2. Bump only npm metadata:

   ```bash
   npm version X.Y.Z --no-git-tag-version --ignore-scripts
   ```

3. Run focused tests, then one full gate:

   ```bash
   npm run ci:local
   npm publish --dry-run --json
   ```

4. Confirm the dry-run contains `dashboard/dist`, the target version, CLI entrypoints, and expected files.

## Publish and verify

- Preferred: GitHub Actions Trusted Publishing/OIDC after Issue #179 is complete.
- Recovery: authorized local `npm publish --access public`; this does not prove CI publishing works.
- Fresh-install the exact registry version and verify CLI help, Node engine, dependency audit, dashboard assets, target version presence, and old/bad version absence.
- If deployed as an always-on local service, run `scripts/release.sh X.Y.Z` and verify both LaunchAgent pins, listener, HTTP 200, and served bundle version.

Do not dispatch archived DMG/Windows workflows, synchronize native project versions, create native assets, or treat historical GitHub Releases as the active release contract.
