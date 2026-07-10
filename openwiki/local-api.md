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

## Related modules

- `src/lib/pricing/` resolves model pricing used by local aggregations.
- `src/lib/usage-limits.js` backs the usage-limits endpoint.
- `src/lib/skills-manager.js` backs skills operations.
- `dashboard/src/lib/api.ts` chooses local or cloud function access for dashboard
  data.

When changing an endpoint, add or update its targeted `test/local-api-*.test.js`
coverage and update this page through the facts workflow.
