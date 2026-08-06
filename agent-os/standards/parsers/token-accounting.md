# Token Accounting

## Authority

- `CLAUDE.md`
- `openwiki/parsers-and-sync.md`
- `CONTRIBUTING.md`
- `src/lib/queue-compact.js`
- `test/parser-conformance.test.js`

## Applies when

Adding or changing provider parsing, normalized token columns, queue rows, model attribution, pricing inputs, deduplication, or token migrations.

## Required behavior

- Normalize non-cached input, output, cache reads, cache writes, and reasoning into their canonical columns.
- Preserve provider-specific exceptions documented in `CLAUDE.md`, including sources whose reasoning is already folded into output.
- Keep queue totals consistent with `expectedTotal()` and non-negative.
- Compute cost from billable columns, never from `total_tokens` alone.
- Test raw provider semantics with a real anonymized fixture as well as the generic conformance contract.
- Prove model/source attribution and deduplication when one session or record can represent multiple models or providers.

## Verification

```bash
PROVIDER_TEST="${PROVIDER_TEST:-test/rollout-parser.test.js}"
node --test "$PROVIDER_TEST" test/parser-conformance.test.js test/pricing.test.js test/token-audit.test.js
npm run ci:local
```

Set `PROVIDER_TEST` to the affected provider's existing test file when it is not covered by `test/rollout-parser.test.js`. If token-audit output is needed, pass `scripts/audit-token-correctness.cjs` an explicit isolated queue path; never use its live-queue default as fixture evidence.

## Do not infer

- Identically named fields have identical semantics across providers.
- Passing parser conformance proves the raw provider mapping is correct.
- A populated `total_tokens` field produces a correct price when billable columns are empty.
- Conservation of the grand total proves model, source, time, or project attribution is correct.
