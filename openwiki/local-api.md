# Local API

The loopback local API is implemented by `src/lib/local-api.js`. The server in
`src/commands/serve.js` routes `/functions/`, `/api/`, and `/proxy/` requests to
that handler before static dashboard files.

## Function endpoints

These endpoint names and methods are generated from source. Query parameters and
response fields are implementation details: read the handler before relying on
them in a client or document.

| Method | Path |
| --- | --- |
| POST | `/functions/tokentracker-local-sync` |
| GET | `/functions/tokentracker-wrapped` |
| GET | `/functions/tokentracker-usage-summary` |
| GET | `/functions/tokentracker-usage-daily` |
| GET | `/functions/tokentracker-usage-heatmap` |
| GET | `/functions/tokentracker-usage-model-breakdown` |
| GET | `/functions/tokentracker-usage-category-breakdown` |
| GET | `/functions/tokentracker-project-usage-summary` |
| GET | `/functions/tokentracker-user-status` |
| GET | `/functions/tokentracker-usage-hourly` |
| GET | `/functions/tokentracker-usage-monthly` |
| GET and POST | `/functions/tokentracker-skills` |
| GET | `/functions/tokentracker-usage-limits` |
| GET | `/functions/tokentracker-ingest-health` |

The mutation endpoint checks local authorization. The skills endpoint has its own
method-specific behavior. Do not expose either endpoint beyond the local server
without re-evaluating that security model.

## Ingest health

`/functions/tokentracker-ingest-health` reports collection problems that make a
source under-report *without producing an error*. Today it carries one signal:
Claude CLI sessions started with `--no-session-persistence`. That flag tells the
CLI to write no session transcript, and transcripts under `~/.claude/projects`
are the only thing `parseClaudeIncremental` can read, so those tokens are
unobservable — indistinguishable, from the queue alone, from a quiet day.

The payload is deliberately narrow, because this endpoint answers
unauthenticated loopback GETs:

```json
{
  "transcript_suppressed": {
    "supported": true, "checked": true,
    "count": 2, "models": ["glm-5-turbo"], "reason": null
  },
  "checked_at": "2026-07-29T23:40:00.000Z"
}
```

No pid, argv, or environment value is returned. `checked: false` means the
question could not be answered — `reason` is `unsupported_platform` (no
`/bin/ps`, i.e. Windows) or `process_list_failed` — and a client must not render
that as a clean result. The detector lives in
`src/lib/transcript-suppression.js` and caches for 30 seconds, so polling this
endpoint does not spawn a process per request.

**The scan is scoped to the user running TokenTracker.** `PS_ARGS` in
`src/lib/process-list.js` is `-x`, not `-ax`: `-a` would widen `ps` to every
account on the machine, and since this endpoint answers unauthenticated loopback
GETs, on a shared host that would let any local user ask it about someone else's
Claude sessions. Nothing is lost by narrowing it — a session TokenTracker could
have recorded is by definition one this user started. `test/process-list.test.js`
asserts the literal argv, because a real `ps` run on a single-user machine looks
identical either way.

Note that `src/lib/usage-limits.js` performs a separate, unrelated `ps` scan and
still passes `-ax`; it is not reached from this endpoint.

The same detector backs the `ingest.transcript_suppressed` check in
`tokentracker doctor`. That check is **omitted entirely** where the platform
cannot answer it, rather than printed as `[OK]`.

## Pricing diagnostics

`/functions/tokentracker-usage-model-breakdown` is the one endpoint that reports
how much to trust its own numbers. Each model in `sources[].models[]` carries a
`pricing_tier`, and the response's `pricing` object carries a snapshot of what
the pricing layer knows it guessed at or missed. Both come from
`getPricingDiagnostics()` in `src/lib/pricing/index.js`; read that function
before relying on the exact field set.

The tiers come from the resolution ladder in `src/lib/pricing/matcher.js` — that
function is the authority; the grouping below is what each rung means for
trusting the number. The distinctions matter because three different situations
all produce a `$0` cost, and because a *guessed* price is never `$0` and so
cannot be spotted by looking for zeros.

**Resolved exactly** — the id matched, trust the price:

| Tier | Rung |
| --- | --- |
| `curated:exact` | Matched a key in `curated-overrides.json`. Curated always wins over LiteLLM. |
| `curated:exact-dot`, `litellm:exact-dot` | Matched exactly after rejoining dash-separated numerics (`glm-5-1` → `glm-5.1`), for providers that dash-normalize version numbers. |
| `litellm:exact` | Matched a LiteLLM key. |
| `curated:alias` | A deliberate curated mapping, e.g. Cursor's `auto` → `composer-1`. Intentional, not inferred. |
| `litellm:strip` | Matched the base model after removing a reasoning-effort suffix (`-high`, `-xhigh`, `-fast`, …). Reasoning effort changes how many tokens you spend, not the per-token rate, so the base price is the right one. |

**Guessed** — plausible, possibly another model's price. These are what
`fuzzy_priced_models` reports:

| Tier | Rung |
| --- | --- |
| `curated:fuzzy` | A curated substring rule matched. |
| `litellm:prefix-strip` | A provider-qualified key ended with the bare model name. Where several providers expose the same model, the lexicographically smallest key wins — deterministic, but the chosen provider's rate may not be yours. |
| `litellm:fuzzy` | Reverse substring, longest key first: the model id *contains* a known key. |

**Not priced** — all cost `$0`, for three different reasons:

| Tier | Rung |
| --- | --- |
| `miss` | Nothing matched. Needs an entry in `curated-overrides.json`; this is what `unpriced_models` lists. |
| `unattributed` | The row had no model id and is stored under the placeholder `unknown`. Also `$0`, but there is nothing to add a price for — deliberately excluded from `unpriced_models`. |
| `empty` | No model id passed at all. |

`unpriced_models` lists only `miss` models — it is a work list of ids needing a
curated price, so placeholders are deliberately excluded from it.
`fuzzy_priced_models` lists the guessed ones. A `miss`, or a snapshot older than
its TTL, triggers a single-flight background refresh; `refreshing`, `stale`, and
`last_refresh_error` report that machinery. A refresh that cannot reach upstream
is discarded rather than installed, so a failed refresh never replaces good
prices with an older snapshot's.

## Related modules

- `src/lib/pricing/` resolves model pricing used by local aggregations.
- `src/lib/usage-limits.js` backs the usage-limits endpoint.
- `src/lib/skills-manager.js` backs skills operations.
- `dashboard/src/lib/api.ts` chooses local or cloud function access for dashboard
  data.

When changing an endpoint, add or update its targeted `test/local-api-*.test.js`
coverage and update this page through the facts workflow.
