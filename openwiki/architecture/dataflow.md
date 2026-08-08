# Data Flow

This is the data-flow view of TokenTracker: how usage data moves from AI coding
tool logs to the dashboard, and where it is transformed along the way. For the
component view (who calls whom) see [Architecture](overview.md); for the visual
system map see the [OpenWiki index](../README.md).

TokenTracker runs entirely on the local machine. Tool logs are read-only inputs,
the loopback server binds to `127.0.0.1`, and no usage data leaves the host.

## Context (Level 0)

```text
  AI coding tools               TokenTracker (local)              consumer
  Claude, Codex, Gemini,        parse -> aggregate -> price       browser dashboard (React)
  Cursor, and other readers             |                             ^
          |  raw session logs            |  usage + cost JSON          |
          |  (read-only *.jsonl)         |  (/functions/ endpoints)    |
          +----------------------------> [ TokenTracker ] -------------+

  Boundary: usage metadata only — source, model, token and conversation counts,
  timestamps, and derived cost. Never persist prompts, responses, message bodies,
  or private user-code paths. Credentials are used only for declared provider
  authentication or quota flows and their credential files; never place them in
  TokenTracker queues, logs, fixtures, diagnostics, API responses, or unrelated
  outbound payloads. Derived cost is computed downstream;
  it is not stored in the queue.
```

## Level 1 data-flow

```text
 EXTERNAL ENTITIES (log producers, read-only)
 +---------------------------------------------------------------------+
 | ~/.claude/projects/**/*.jsonl        (source: claude)               |
 | ~/.codex/sessions/**/*.jsonl         (source: codex)                |
 | Gemini, Cursor, Kimi, CodeBuddy, omp, pi, and other tool logs       |
 +----------------------------+----------------------------------------+
                              | (A) raw log lines
                              v
        +==============================+     (B) read cursors
        | 1.0  PARSE (incremental)     | <--------------------------+
        | src/lib/rollout.js           |                           |
        |  - parseClaudeIncremental    | --(B) update cursors------>+------------------------+
        |  - parseRolloutIncremental   |                           | D1 cursors.json        |
        |  - parseGeminiIncremental ...|                           | ~/.tokentracker/tracker|
        +==============+===============+                           +------------------------+
                       | (C) parsed usage records
                       |     {source, model, tokens, hour_start}
                       v
        +==============================+
        | 2.0  AGGREGATE + DEDUP       |  bucket key = (source, model, hour_start)
        | src/commands/sync.js         |  UTC half-hour, append-only, latest-wins
        +==============+===============+
                       | (D) queue entries
                       v
   +-------------------------------+     +-------------------------------+
   | D2 queue.jsonl                |     | D3 project.queue.jsonl        |
   | {hour_start, source, model,   |     | (per-project scope)           |
   |  input_tokens, output_tokens, |     +---------------+---------------+
   |  cached_input_tokens,         |                     |
   |  cache_creation_input_tokens, |     (E) read + dedup latest per key
   |  reasoning_output_tokens,     | <-------------------+-----------------------+
   |  total_tokens,                |                                            |
   |  conversation_count}          |                             +==============================+
   +-------------------------------+                             | 3.0  SERVE + PRICE           |
                                                                 | src/lib/local-api.js         |
   +-------------------------------+     (F) model rates         | src/lib/pricing/ computeRow  |
   | src/lib/pricing/ (seed)       | ------------------------->  |  Cost uses billable columns  |
   | model -> $/MTok               |                             |  only, never total_tokens    |
   +-------------------------------+                             +==============+===============+
                                                                                | (G) usage + cost JSON
                                     /functions/tokentracker-usage-summary       |
                                     /functions/tokentracker-usage-daily         |
                                     /functions/tokentracker-usage-hourly        v
                                     /functions/tokentracker-usage-heatmap  +----------------------------+
                                     /functions/tokentracker-usage-monthly  | dashboard/src/lib/api.ts   |
                                     ... and the other documented endpoints  | -> dashboard pages         |
                                                                            | -> browser on localhost    |
                                                                            +----------------------------+
```

## Flow legend

| Flow | Data in motion | Notes |
| --- | --- | --- |
| (A) | Raw log lines from each tool | Source files are read only; never modified. |
| (B) | Per-file read cursors | Stored in `~/.tokentracker/tracker/cursors.json`; enables incremental reads instead of re-reading whole files. |
| (C) | Parsed usage records | Raw provider fields are normalized into the queue columns. |
| (D) | Queue entries | Appended to the queue, bucketed into UTC half-hour windows. |
| (E) | Dedup read | Readers keep the latest entry per `(source, model, hour_start)`. |
| (F) | Model pricing rates | Seeded separately from the queue; cost is derived, not stored in the queue. |
| (G) | Usage + cost JSON | Served over the loopback `/functions/` endpoints to `dashboard/src/lib/api.ts`. |

## Data stores

| Store | Path | Contents |
| --- | --- | --- |
| D1 cursors | `~/.tokentracker/tracker/cursors.json` | Last read position per source file, so re-runs stay incremental. |
| D2 main queue | `~/.tokentracker/tracker/queue.jsonl` | Append-only usage rows; the aggregation source of truth. |
| D3 project queue | `~/.tokentracker/tracker/project.queue.jsonl` | Project-scoped copy for per-project views. |

## Token accounting boundary

The parse step (1.0) is the trust boundary. Everything downstream handles usage
metadata — source, model, token and conversation counts, timestamps, and derived cost.
Never persist prompts, responses, message bodies, or private user-code paths.
Credentials are used only for declared provider authentication or quota flows and their credential files; never place them in TokenTracker queues, logs, fixtures, diagnostics, API responses, or unrelated outbound payloads. The queue columns and content exclusions are defined in `CLAUDE.md`;
cost is computed from the individual billable columns in `src/lib/pricing/`, never
stored in the queue or derived from `total_tokens`.
See [Parsers and sync](../parsers-and-sync.md) and [Local API](../local-api.md).
