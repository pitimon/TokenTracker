# Incremental State

## Authority

- `CLAUDE.md`
- `openwiki/parsers-and-sync.md`
- `CONTRIBUTING.md`
- `test/parser-conformance.test.js`

## Applies when

Changing a parser cursor, cumulative counter, mutable record, timestamp or bucket assignment, sync migration, queue rewrite, or per-file cache.

## Required behavior

- Verify from a real sanitized provider sample whether each field is cumulative, delta, or snapshot state.
- Attribute newly observed growth to a bucket using verified provider time semantics; cover cross-hour and cross-day updates explicitly.
- Re-reading unchanged input must not add usage again.
- Cursor, migration, and queue changes must remain safe when sync runs twice consecutively.
- Migration tests must prove conservation, idempotence, and the intended treatment of stale or moved records.
- Add the provider-specific regression fixture before changing parser behavior.

## Verification

```bash
PROVIDER_TEST="${PROVIDER_TEST:-test/rollout-parser.test.js}"
node --test "$PROVIDER_TEST" test/parser-conformance.test.js
npm run ci:local
```

Set `PROVIDER_TEST` to the affected provider's existing test file when it is not covered by `test/rollout-parser.test.js`. For cursor or migration work, execute the relevant sync path twice against an isolated fixture and compare both queue states. If token-audit output is needed, pass `scripts/audit-token-correctness.cjs` an explicit isolated queue path; never use its live-queue default as fixture evidence.

## Do not infer

- A repeated implementation is not an intentional standard; several providers can share the same bug.
- Snapshot-like fields are not cumulative without provider evidence.
- An original creation timestamp is not automatically the correct bucket for later mutable growth.
- A first successful sync does not prove clean rerun behavior.
