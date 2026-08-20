# Issue #184: Consume Hermes authoritative cost

## Decision

**Decision loop:** In-the-Loop. The owner selected this Phase 1 boundary on 2026-08-20.

TokenTracker will consume already-persisted per-model Hermes cost attribution from local `state.db`. It will not contact LiteLLM, hold a gateway credential, query `LiteLLM_SpendLogs`, or infer client ownership from a logical route and time window.

## Motivation

Logical gateway aliases can resolve through TokenTracker's generic fuzzy price even when Hermes later records an authoritative per-model cost. The dashboard must prefer the persisted authoritative amount when Hermes explicitly labels it actual, while retaining the current local estimate for absent, unknown, or estimated attribution.

## Scope

- Read compatible `actual_cost_usd`, `estimated_cost_usd`, `cost_status`, and `cost_source` columns from Hermes `session_model_usage`.
- Persist cost deltas with the existing local Hermes queue rows and latest-wins bucket semantics.
- Prefer an explicit Hermes `cost_status=actual` value for affected cost aggregates and expose cost provenance in the local API/dashboard model data.
- Preserve the existing behavior for older Hermes schemas and non-authoritative rows.

## Non-goals

- Direct LiteLLM API/PostgreSQL/export collection.
- Gateway credentials, request IDs, key aliases, spend-log correlation, or remote-network calls.
- Rewriting historical queue rows to retrospectively replace estimates.
- Project-level cost attribution beyond the existing local project queue contract.

## Acceptance criteria

1. A compatible Hermes row with `cost_status=actual` contributes its persisted `actual_cost_usd` instead of a LiteLLM fuzzy estimate.
2. A missing, unknown, or estimated Hermes cost retains the existing TokenTracker estimate and pricing tier.
3. A second incremental read is idempotent, and a later cumulative cost increase contributes only its delta.
4. The usage summary, daily aggregation, and model breakdown agree on the selected cost source.
5. The API exposes a non-secret provenance classification; it does not expose Hermes session IDs, prompts, credential values, request bodies, or gateway identifiers.
6. Older Hermes schemas without cost columns remain readable.

## Follow-up dependency

A separate Hermes/gateway change must populate `actual_cost_usd` and `cost_status=actual` from a trusted per-call source before this feature can show live authoritative gateway cost. The current local Hermes database reports only `unknown`/`none` cost attribution.
