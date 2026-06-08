# npm publish checklist

This fork publishes the CLI as `@ipv9/tokentracker-cli`. Keep the binary aliases
unchanged: `tokentracker`, `tracker`, and `tokentracker-cli`.

Run these checks before publishing:

```bash
npm view @ipv9/tokentracker-cli version versions --json
npm ci
npm --prefix dashboard ci
npm --prefix dashboard run build
npm test
npm --prefix dashboard test
npm pack --dry-run --json
npm publish --access public --dry-run
npm publish --access public
npm view @ipv9/tokentracker-cli version versions --json
```

The dry-run pack output must include `dashboard/dist/index.html` and the macOS
service scripts under `scripts/`.

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

Privacy boundary for local services:

- `scripts/install-local-service.sh` installs a local dashboard LaunchAgent and a
  five-minute local sync LaunchAgent.
- The local sync wrapper exits successfully without syncing when
  `TOKENTRACKER_DEVICE_TOKEN` or `~/.tokentracker/tracker/config.json`
  `deviceToken` is configured.
- Local dashboard mode must not preload or display leaderboard navigation on
  `localhost`.
