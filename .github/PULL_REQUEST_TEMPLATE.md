# PR Goal (one sentence)

## Scope

- [ ] CLI (`src/`)
- [ ] Dashboard (`dashboard/`)
- [ ] Docs / CI / config

## Checklist

- [ ] `npm run ci:local` passes, or focused test commands are listed below with rationale
- [ ] New dashboard/user-facing strings go through `dashboard/src/content/copy.csv`
- [ ] Commits follow conventional style (`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` / `test:` / `ci:`)
- [ ] PR description explains why, not just what
- [ ] Version bump files are in lockstep when release-bound (`package.json`, `package-lock.json`)
- [ ] npm publish state is recorded when release-bound (manual MFA URL approval, `npm view @ipv9/tokentracker-cli version versions --json`, and any `seed-snapshot.json` post-publish diff)

## Codex Context (required when requesting @codex review)

- **Delta since last Codex review:** (commits or summary)
- **Intended behavior / invariants:**
- **Edge cases covered:**
- **Tests run (command + result):**
- **Known gaps / out of scope:**

## Risk Layer Trigger (if any)

- [ ] Public exposure / share links / unauthenticated access
- [ ] Auth/session/token handling
- [ ] Cross-endpoint invariants or shared logic
- [ ] External gateway / environment constraints

## Risk Layer Addendum (fill ONLY if any trigger checked)

### Rules / Invariants

-

### Boundary Matrix (must list at least 3)

-

### Evidence (tests or repro)

-

## Public Exposure Checklist (if applicable)

- [ ] Public access rules defined (share token required, non-JWT handling, 401 behavior)
- [ ] Exposed fields explicitly listed and verified
- [ ] Avatar/image policy defined
- [ ] Regression tests cover invalid link and auth fallback
- [ ] Mark N/A if no public exposure

## Regression Test Gate

### Most likely regression surface

-

### Verification method (choose at least one)

- [ ]

### Uncovered scope

-
