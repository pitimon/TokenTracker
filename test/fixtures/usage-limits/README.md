# Usage-limits response fixtures

Produced by `node scripts/capture-limits-fixtures.cjs`, which captures **one real
response per provider** from the machine it runs on, sanitizes it, and writes it
here. Run `--dry-run` first and read the output.

## Why capture rather than hand-write

`src/lib/usage-limits.js` talks to nine providers' undocumented private
endpoints. A fixture written from reading our own normalizer only encodes our
reading of it — it is green whether or not the provider ever sends those fields.
The lesson that named this is blunt: *a mock payload proves render logic, never
data-source presence.*

## What these fixtures do and do not prove

**They do:** lock the normalizer's behaviour against a payload the provider
really sent, so our own refactors cannot silently change how it is parsed.

**They do not:** detect upstream drift. Nothing short of live credentials in CI
does, and that is explicitly rejected — nine providers' secrets in repository
secrets, with the rotation burden and disclosure surface that implies, to catch
something a user hitting the Limits page catches anyway.

## Sanitisation

Allowlist-shaped, not blocklist-shaped: anything not provably a quota shape is
replaced. Specifically —

- keys are classified **segment-wise** across both naming conventions, because
  these APIs mix them (`remainingFraction` next to `limit_window_seconds`);
- a lone identifying word redacts (`token`, `accountId`); one qualified by a
  quota word does not (`tokenType`, `usageLimit`);
- `id` and `name` are read **with their parent**: `currentTier.id` is a tier
  label the normalizer reads, `user.id` is an account identifier;
- numbers under an unrecognised key are bucketed to a magnitude — an account id
  is an integer, so "numbers are safe" would publish it;
- timestamps keep their shape but lose **sub-minute precision**, which is a
  per-account fingerprint even though no field there is an identifier;
- arrays are truncated to two elements.

`scripts/capture-limits-fixtures.cjs` never captures discovery commands. `ps -ax`
and `lsof` are run to find the Antigravity process, and their output is the
machine's process list and open files. The first version captured them; it
survived only because an email address happened to appear in the `ps` output and
took the whole string with it.

## Response shapes, from public sources

These were used to test the sanitizer **before** it was pointed at an account,
and finding them is what caught two defects in it. Each is quoted from a project
that calls the same endpoint — none is inferred from our own code, which would
have been circular.

| Provider | Public source | Shape highlights |
|---|---|---|
| Claude — `api.anthropic.com/api/oauth/usage` | [steipete/CodexBar](https://github.com/steipete/CodexBar) `ClaudeOAuthUsageFetcher.swift` + tests; independently corroborated in [Claude-Code-Usage-Monitor#202](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202) | `five_hour`/`seven_day`/`seven_day_opus` each `{utilization, resets_at}`; newer `limits[]` with `kind`, `group`, `percent`, `scope.model` |
| Codex — `chatgpt.com/backend-api/wham/usage` | [steipete/CodexBar](https://github.com/steipete/CodexBar) `CodexOAuthUsageFetcher.swift` + tests | `plan_type`, `rate_limit.{primary,secondary}_window.{used_percent, reset_at, limit_window_seconds}`, `additional_rate_limits[]`, `credits` |
| Cursor — `cursor.com/api/usage-summary` | [dmwyatt/cursor-usage](https://github.com/dmwyatt/cursor-usage) `testdata/summary_response.json` (a committed real capture) + CodexBar | `individualUsage.plan.{used,limit,remaining,totalPercentUsed}`, `teamUsage.onDemand`, cents. `www.cursor.com` 308-redirects and strips the auth cookie |
| Kimi — `api.kimi.com/coding/v1/usages` | [luisleineweber/usagebar](https://github.com/luisleineweber/usagebar) `plugins/kimi/plugin.js` | `usage.{limit,remaining,resetTime}` as **strings**; `limits[].window.{duration,timeUnit}` |
| Z.AI — `api.z.ai/api/monitor/usage/quota/limit` | [guyinwonder168/opencode-glm-quota](https://github.com/guyinwonder168/opencode-glm-quota) `src/index.ts` | `data.limits[].{type,percentage,nextResetTime}`. Auth header takes **no** `Bearer` prefix |
| Gemini — `cloudcode-pa.googleapis.com` | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) `code_assist/types.ts` (Google's own OSS) | `buckets[].{remainingAmount,remainingFraction,resetTime,tokenType,modelId}`; `cloudaicompanionProject` is a **GCP project id** |
| Copilot | [Official docs](https://docs.github.com/en/rest/billing/usage) for the billing endpoint; [Noisemaker111/openusage-opencode](https://github.com/Noisemaker111/openusage-opencode) for the reverse-engineered `copilot_internal/user` | `quota_snapshots.premium_interactions.{percent_remaining,entitlement,remaining,quota_id}` |
| Kiro — `kiro-cli chat --no-interactive /usage` | [steipete/CodexBar](https://github.com/steipete/CodexBar) `docs/kiro.md` | **Not JSON.** ANSI-decorated box drawing; percentage from the bar, `resets on MM/DD`. [kirodotdev/Kiro#5423](https://github.com/kirodotdev/Kiro/issues/5423) confirms no JSON mode exists |
| Antigravity — local HTTPS RPC | [steipete/CodexBar](https://github.com/steipete/CodexBar) `docs/antigravity.md`, corroborated by [Antigravity-Context-Window-Monitor](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor) | `RetrieveUserQuotaSummary` → `groups[].buckets[].remaining.remainingFraction`. `GetUserStatus` is the only source of **`accountEmail`** |

Sources were current when checked on 2026-07-25; several of these projects are
actively maintained and the shapes can change without notice.
