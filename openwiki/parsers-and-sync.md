# Parsers and Sync

`src/lib/rollout.js` contains the incremental readers used by sync. The exported
parser surface is recorded in `openwiki-facts/source-facts.json`; its symbols
include `parseClaudeIncremental`, `parseGeminiIncremental`,
`parseRolloutIncremental`, `parseOpenclawIncremental`, and provider-specific
readers for installed tool formats.

`src/commands/sync.js` owns orchestration. It is the place to inspect when
adding a parser to the real sync path or changing aggregation behavior.

## Token accounting

`CLAUDE.md` defines the queue contract:

- `input_tokens` is non-cached input.
- `cached_input_tokens` and `cache_creation_input_tokens` are separate columns.
- `reasoning_output_tokens` is separate from ordinary output.
- Cost is calculated from the individual billable columns, not from
  `total_tokens`.

Parser changes must preserve those meanings. A parser that only supplies
`total_tokens` cannot produce a correct model cost without further normalization.

## Change checklist

1. Read the matching parser and its fixture-based tests under `test/`.
2. Verify raw provider semantics before mapping a field to a queue column.
3. Run sync twice when changing cursor or migration behavior.
4. Run the focused parser and pricing tests, then `npm run ci:local`.
