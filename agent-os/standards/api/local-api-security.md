# Local API Security

## Authority

- `CLAUDE.md`
- `openwiki/local-api.md`
- `test/local-api-security.test.js`
- `test/local-api-methods.test.js`

## Applies when

Changing `src/lib/local-api.js`, the loopback server, a dynamic endpoint, provider-backed responses, request parsing, or browser-to-local API behavior.

## Required behavior

- Preserve the loopback/local trust boundary and the exact endpoint-method allowlist.
- Reject unsupported methods and malformed input with visible, actionable failures.
- Scope and sanitize responses that expose process, filesystem, provider, or credential-adjacent state.
- Declare every new outbound host in `outbound-hosts.json` and the public privacy inventory before enabling the call.
- Add a negative-path contract test before changing endpoint behavior.

## Verification

```bash
node --test test/local-api-methods.test.js test/local-api-security.test.js test/outbound-inventory.test.js
npm run ci:local
```

For browser-visible behavior, exercise the affected route against the real CLI server; a static source assertion is not live proof.

## Do not infer

- Loopback binding does not remove the need for method, host, input, and response validation.
- A mocked dashboard or source check does not prove the real local API path.
- Existing provider credentials do not authorize exposing or transmitting them.
