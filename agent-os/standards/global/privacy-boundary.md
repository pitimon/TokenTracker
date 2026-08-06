# Privacy Boundary

## Authority

- `CLAUDE.md`
- `CONTRIBUTING.md`
- `README.md`
- `test/outbound-inventory.test.js`

## Applies when

Changing parsers, fixtures, logs, diagnostics, queue rows, local API responses, provider integrations, outbound requests, or documentation of collected data.

## Required behavior

- Permit required usage metadata: source, model, token and conversation counts, timestamps, and derived cost.
- Derived cost is not stored in the queue and may be cached in browser localStorage.
- Never persist or expose private content: prompts, responses, message bodies, or private user-code paths.
- Credentials are used only for declared provider authentication or quota flows and their credential files; never place them in TokenTracker queues, logs, fixtures, diagnostics, API responses, or unrelated outbound payloads.
- Use real but anonymized fixtures; remove content fields and identifying paths before committing them.
- Declare and validate outbound hosts. Document what triggers each call and what data it carries.
- Treat credentials already present on the machine as sensitive inputs, not reusable output data.

## Verification

```bash
node --test test/outbound-inventory.test.js test/transcript-suppression.test.js test/capture-limits-sanitizer.test.js
npm run validate:outbound
npm run ci:local
```

Review the final diff for prompts, responses, private paths, credentials, and newly introduced network destinations.

## Do not infer

- Local-first does not mean network-free.
- A provider log is not safe to commit merely because TokenTracker reads it locally.
- Sanitizing a display label does not prove stored fixture or queue content is safe.
