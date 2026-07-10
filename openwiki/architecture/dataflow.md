# Data Flow

This is the data-flow view of TokenTracker: how usage data moves from AI coding
tool logs to the dashboard, and where it is transformed along the way. For the
component view (who calls whom) see [Architecture](overview.md); for the visual
system map see the [OpenWiki index](../README.md).

TokenTracker runs entirely on the local machine. Tool logs are read-only inputs,
the loopback server binds to `127.0.0.1`, and no usage data leaves the host.

## Context (Level 0)

```text
  AI coding tools               TokenTracker (local)              consumers
  Claude, Codex, Gemini,        parse -> aggregate -> price       dashboard (React)
  Cursor, and other readers                                       native WebView
          |                              |                             ^
          |  raw session logs            |  usage + cost JSON          |
          |  (read-only *.jsonl)         |  (/functions/ endpoints)    |
          +----------------------------> [ TokenTracker ] -------------+

  Boundary: prompts, messages, and conversation bodies never cross into
  TokenTracker. Only token counts and timestamps are read and stored.
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
                                                                            | -> native WebView (Bar/Win)|
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

The parse step (1.0) is the trust boundary. Everything downstream of it works
only on token counts and timestamps; prompt and message content is dropped at
parse time and never reaches the queue. The queue columns and the exclusion of
conversation content are defined in `CLAUDE.md`, and cost is computed from the
individual billable columns in `src/lib/pricing/`, never from `total_tokens`.
See [Parsers and sync](../parsers-and-sync.md) and [Local API](../local-api.md).
