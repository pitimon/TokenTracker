# Contributing to TokenTracker

Thanks for considering a contribution! TokenTracker is a small project, so the process is intentionally lightweight.

## Setup

```bash
git clone https://github.com/pitimon/TokenTracker.git
cd TokenTracker
npm install

# Build the dashboard once so the CLI can serve it
cd dashboard && npm install && npm run build && cd ..
```

## Run the CLI locally

```bash
node bin/tracker.js              # Start the local dashboard server (default: http://localhost:7680)
node bin/tracker.js sync         # Manual sync
node bin/tracker.js status       # Check hook status
node bin/tracker.js doctor       # Health check
```

## Tests

```bash
npm test                                     # Full suite (node --test over test/*.test.js)
node --test test/rollout-parser.test.js      # A single test file
npm run ci:local                             # Tests + validations + builds (everything CI runs)
```

If you're touching the dashboard:

```bash
npm run dashboard:dev                        # Vite dev server with mocked API
npm run dashboard:build                      # Production build (output: dashboard/dist/)
npm run validate:copy                        # Validate copy registry completeness
```

## Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] If you added user-facing strings, add them to `dashboard/src/content/copy.csv`
- [ ] If you changed Swift, run `xcodegen generate` after editing `TokenTrackerBar/project.yml`
- [ ] Conventional commit style: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `ci:`, `test:`
- [ ] PR description explains *why*, not just *what*

## Adding a New AI Tool Integration

This is the most common kind of contribution. The pattern:

1. **Add a parser to `src/lib/rollout.js`** — most tools write JSONL or SQLite logs. The parser should normalize tokens into the canonical shape: `{input_tokens, output_tokens, cached_input_tokens, cache_creation_input_tokens, total_tokens, model, source, hour_start}`. This file is large; don't read it top to bottom — find the closest existing tool (`parseDroidIncremental`, `parseZedIncremental`, …) and copy its shape. Each parser exports a `resolve*`/`list*` pair for finding the tool's files and a `parse*Incremental` for reading them.
2. **Add a hook installer in `src/commands/init.js`** — most tools support a config file or hook script you can patch. Make it idempotent (safe to re-run).
3. **Add a status check in `src/commands/status.js`** — show whether the hook is installed and whether data has been collected.
4. **Add a parser test in its own `test/<tool>-parser.test.js`** — use a real (anonymized) sample log fixture. Recent tools each got their own file (`droid-parser.test.js`, `zed-parser.test.js`, `goose-parser.test.js`); only the older ones share `rollout-parser.test.js`.

   **Also add a conformance fixture: `test/fixtures/parser-conformance/<tool>.cjs`.** `test/parser-conformance.test.js` enumerates every `parse*Incremental` from `src/lib/rollout.js` **source**, so a new parser without a fixture fails the build — it cannot be silently skipped. The alternative is an entry in `allowlist.json` explaining why a fixture is not possible (a SQLite schema, a live API shape), and that list is a ratchet: it may only shrink.

   The fixture checks the parser's *output* — the column invariant `total = input + output + cache_creation + cache_read + reasoning`, non-negative counts, a model, a 30-minute UTC bucket, and that re-parsing the same input does not double-count. It deliberately does **not** prove you read the provider's format correctly; a parser that double-counts cache reads and inflates the total to match still passes. That is what step 4's real sample log is for. Copy `craft.cjs` for the shape.
5. **Add the tool to the Supported tools list in `README.md`** — the blockquote under "🔌 Supported tools". Leave the "20+" count alone; a hard number in prose has no validator and goes stale silently.

Look at how Claude Code, Codex, or Gemini are wired in for reference — they're the simplest examples.

## Code Style

- **CLI (`src/`)**: CommonJS, Node 20+, no transpilation. Match the existing style.
- **Dashboard (`dashboard/`)**: TypeScript strict, React 18, ESM, Tailwind. Match the existing style.
- **macOS (`TokenTrackerBar/`)**: Swift 5.9, SwiftUI + AppKit. Match the existing style.
- No linter wars. Be reasonable.

## Privacy Rule (non-negotiable)

TokenTracker tracks **only token counts and timestamps**. Never log, store, transmit, or print any prompt content, response content, file paths from user code, or anything that could leak what the user is working on. If your change touches a parser, double-check this.

## Releasing (maintainers only)

See the "Release Workflow" section in [CLAUDE.md](CLAUDE.md).
