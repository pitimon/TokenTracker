# npm publish checklist

This fork publishes the CLI as `@ipv9/tokentracker-cli`. Keep the binary aliases
unchanged: `tokentracker`, `tracker`, and `tokentracker-cli`.

Run these checks before publishing:

```bash
npm view @ipv9/tokentracker-cli version versions --json
npm ci
npm --prefix dashboard ci
node --test test/pricing.test.js test/model-breakdown.test.js test/local-api-source-scope.test.js
npm --prefix dashboard test -- UsageOverview DataDetails --run
npm test
npm --prefix dashboard test
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm --prefix dashboard run build
npm pack --dry-run --json
npm publish --access public --dry-run
npm publish --access public
npm view @ipv9/tokentracker-cli version versions --json
```

The dry-run pack output must include `dashboard/dist/index.html` and the macOS
service scripts under `scripts/`.

Dashboard pricing/UI release gate:

- Every model you actually used must resolve to non-zero pricing before publish.
  Run `node --test test/pricing.test.js`, then check the live surface rather than
  a hard-coded list of model names — a list in prose goes stale the week a new
  model ships, which is the failure this gate exists to catch:

  ```bash
  curl -s "http://localhost:7680/functions/tokentracker-usage-model-breakdown?from=$(date -v-7d +%F)&to=$(date +%F)" \
    | python3 -c 'import json,sys; p=json.load(sys.stdin)["pricing"]; print(p["unpriced_models"], p["fuzzy_priced_models"])'
  ```

  `unpriced_models` should be empty. Anything listed needs an entry in
  `src/lib/pricing/curated-overrides.json` before you publish. Entries in
  `fuzzy_priced_models` are priced by partial match — plausible but possibly
  wrong, so confirm them rather than assuming.
- Collapsed provider cards must show model chips, top-cost signal, and a
  pricing-missing badge when a non-free model has tokens but zero cost. Use the
  focused `UsageOverview` and `model-breakdown` tests before relying on a
  browser smoke.
- Daily Breakdown must show cost, cost per MTok, and top model columns. Use the
  focused `DataDetails` test and a built-dashboard browser smoke.
- After installing or rebuilding the local LaunchAgent, smoke the active port
  from `launchctl print gui/$(id -u)/com.pitimon.tokentracker.dashboard`; on
  this workstation that may be `127.0.0.1:17680` instead of the default `7680`.

Manual MFA publish flow:

- Do not publish a version that already exists in the npm registry.
- If `npm publish --access public` prints `Authenticate your account at:
  https://www.npmjs.com/auth/cli/...`, keep the terminal session open and have
  the package owner approve that URL in the browser.
- Do not pass npm passwords, OTP codes, recovery codes, or tokens through chat.
- Wait for the command to finish with `+ @ipv9/tokentracker-cli@X.Y.Z`, then
  verify the registry with `npm view @ipv9/tokentracker-cli version versions --json`.
- `prepublishOnly` runs `scripts/build-pricing-seed.cjs` and may update
  `src/lib/pricing/seed-snapshot.json`. If the post-publish diff is only
  `_meta.generated_at` with the same model count and no model/rate changes,
  commit and push that timestamp so the PR matches the published tarball.
  Review any non-metadata pricing changes before recording the publish state.
- Update the PR body with the published version, npm verification, and validation
  commands.

GitHub Actions publish guardrails:

- `.github/workflows/npm-publish.yml` runs `npm run ci:local` on Node 24 before
  the publish job can run.
- The publish job checks `@ipv9/tokentracker-cli@<package.json version>` first
  and skips immutable versions already present on npm.
- Homebrew tap dispatch is disabled by default. Configure both
  `HOMEBREW_TAP_REPOSITORY` (`owner/repo`) and `HOMEBREW_DISPATCH_TOKEN` only
  for this fork's intended tap; do not dispatch to upstream `mm7894215` by
  accident.

Privacy boundary for local services:

- `scripts/install-local-service.sh` installs a local dashboard LaunchAgent and a
  five-minute local sync LaunchAgent.
- The local sync wrapper exits successfully without syncing when
  `TOKENTRACKER_DEVICE_TOKEN` or `~/.tokentracker/tracker/config.json`
  `deviceToken` is configured.
