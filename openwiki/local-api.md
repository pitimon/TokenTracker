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

The mutation endpoint checks local authorization. The skills endpoint has its own
method-specific behavior. Do not expose either endpoint beyond the local server
without re-evaluating that security model.

## Pricing diagnostics

`/functions/tokentracker-usage-model-breakdown` is the one endpoint that reports
how much to trust its own numbers. Each model in `sources[].models[]` carries a
`pricing_tier`, and the response's `pricing` object carries a snapshot of what
the pricing layer knows it guessed at or missed. Both come from
`getPricingDiagnostics()` in `src/lib/pricing/index.js`; read that function
before relying on the exact field set.

The tier vocabulary is a closed set, and the distinctions matter because three
different situations all produce a `$0` cost:

| Tier | Means |
| --- | --- |
| `curated:exact`, `litellm:exact` | Matched a model id outright. Trust the price. |
| `curated:fuzzy`, `litellm:fuzzy`, `litellm:prefix-strip` | Priced by partial match. Plausible, possibly a different model's price — and never `$0`, so it cannot be spotted by looking for zeros. |
| `miss` | No price found. Counted as `$0`; needs an entry in `curated-overrides.json`. |
| `unattributed` | The row had no model id and is stored under the placeholder `unknown`. Also `$0`, but nothing to add a price for. |
| `empty` | No model id at all. |

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
