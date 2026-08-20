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

## Hermes authoritative-cost handoff

When a compatible Hermes `session_model_usage` row explicitly reports
`cost_status=actual`, TokenTracker carries its cumulative `actual_cost_usd`
delta into the matching local half-hour bucket and labels the emitted row
`cost_provenance=hermes-actual`. This is a local state-db handoff, not a
LiteLLM API or database collector: TokenTracker neither holds gateway
credentials nor correlates request logs in this path.

Older Hermes schemas, `unknown`/estimated rows, and pre-existing queue buckets
continue through the normal TokenTracker price resolver. A historical bucket is
not relabelled actual merely because a later row carries a cost; that fail-closed
rule avoids replacing an unknown portion of past usage with a partial amount.

## Change checklist

1. Read the matching parser and its fixture-based tests under `test/`.
2. Verify raw provider semantics before mapping a field to a queue column.
3. Run sync twice when changing cursor or migration behavior.
4. Run the focused parser and pricing tests, then `npm run ci:local`.
