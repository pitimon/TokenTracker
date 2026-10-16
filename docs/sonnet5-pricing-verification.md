# Sonnet 5 post-cutoff verification

Verified 2026-10-16, Asia/Bangkok (+07), for issue #60. This is source-data verification, not a provider invoice or runtime activation receipt.

## Confirmed rates

Anthropic's current pricing table and Sonnet 5 overview list **USD 2 input / 10 output per million tokens**. The pricing table lists **0.20 cache read / 2.50 five-minute cache write**. Do not apply the obsolete presumed 3/15 increase from the expired repository note.[1][2]

The approved LiteLLM source at commit `e74e4e569331c1d99757ae6118685d8826c6f7c6` contains the same four Sonnet 5 rates. The previously bundled Sonnet 5 entry already had these values; verification does not justify changing that model's prices.[3]

## Action and scope

- Ran the existing `npm run pricing:build-seed` generator and checked every generated model/rate against the pinned LiteLLM source (excluding generated timestamp/source metadata): exact equality.
- Snapshot inventory: 2,633 to 3,382 entries; 1,088 additions, 339 removals and 298 changed existing entries. This is a full approved-source offline fallback refresh, **not a Sonnet-only snapshot change**. It requires review for the wider offline fallback effect; no global curated overrides were changed.
- Removed only the resolved `sonnet5-intro-price` expiry item after source verification. Kept the expiry validator and its boundary/failure tests intact. No postponed deadline, frozen clock or skipped test.
- No edge tables remain in this fork. No queue/cursor/history rewrite, automatic calendar repricing or running-service change.
- A current fallback snapshot is not historical billing evidence. Existing curated-price precedence remains unchanged; this work does not verify private gateway/canary billing rates (#191).

## Verification receipts

The expiry test failed before the edit and passes after it. A date-independent regression checks the bundled Sonnet 5 tariff components. Full combined PR CI and registry/runtime verification remain separate release gates; removing metadata is not by itself evidence of a completed release.

## Sources

[1] https://platform.claude.com/docs/en/about-claude/pricing
[2] https://platform.claude.com/docs/en/models/sonnet-5/overview
[3] https://github.com/BerriAI/litellm/blob/e74e4e569331c1d99757ae6118685d8826c6f7c6/model_prices_and_context_window.json
