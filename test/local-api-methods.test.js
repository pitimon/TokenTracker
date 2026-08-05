const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

function createRequest({ method = "GET", headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;
  process.nextTick(() => {
    if (body != null) req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk) {
      this.body = chunk == null ? Buffer.alloc(0) : Buffer.from(chunk);
    },
  };
}

async function call(handler, pathname, { method = "GET", headers = {}, body } = {}) {
  const req = createRequest({ method, headers, body });
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1${pathname}`));
  return { handled, res, json: res.body.length ? JSON.parse(res.body.toString("utf8")) : null };
}

function makeHandler() {
  return createLocalApiHandler({ queuePath: path.join(process.cwd(), "nonexistent-method-contract-queue.jsonl") });
}

test("documented GET endpoint rejects POST with 405 and exact Allow header", async () => {
  const { handled, res, json } = await call(
    makeHandler(),
    "/functions/tokentracker-usage-summary?from=2026-01-01&to=2026-01-01",
    { method: "POST" },
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
  assert.deepEqual(json, { error: "Method Not Allowed" });
});

test("POST endpoint rejects GET with 405 and exact Allow header", async () => {
  const { handled, res, json } = await call(
    makeHandler(),
    "/functions/tokentracker-local-sync",
    { method: "GET" },
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
  assert.deepEqual(json, { ok: false, error: "Method Not Allowed" });
});

test("allowed requests still reach their existing endpoint behavior", async () => {
  const handler = makeHandler();
  const summary = await call(
    handler,
    "/functions/tokentracker-usage-summary?from=2026-01-01&to=2026-01-01",
  );
  assert.equal(summary.handled, true);
  assert.equal(summary.res.statusCode, 200);
  assert.equal(summary.json.totals.total_tokens, 0);

  const sync = await call(handler, "/functions/tokentracker-local-sync", { method: "POST" });
  assert.equal(sync.handled, true);
  assert.equal(sync.res.statusCode, 401);
  assert.deepEqual(sync.json, { ok: false, error: "Unauthorized" });
});

const METHOD_CONTRACT = [
  ["/api/local-auth", "POST", "GET"],
  ["/proxy/ipcheck/api/geoip/127.0.0.1", "POST", "GET, HEAD"],
  ["/api/avatar-proxy?url=https://gravatar.com/avatar/example", "POST", "GET, HEAD"],
  ["/functions/tokentracker-local-sync", "GET", "POST", { ok: false, error: "Method Not Allowed" }],
  ["/functions/tokentracker-wrapped", "POST", "GET"],
  ["/functions/tokentracker-usage-summary", "POST", "GET"],
  ["/functions/tokentracker-usage-daily", "POST", "GET"],
  ["/functions/tokentracker-usage-heatmap", "POST", "GET"],
  ["/functions/tokentracker-usage-model-breakdown", "POST", "GET"],
  ["/functions/tokentracker-usage-category-breakdown", "POST", "GET"],
  ["/functions/tokentracker-project-usage-summary", "POST", "GET"],
  ["/functions/tokentracker-user-status", "POST", "GET"],
  ["/functions/tokentracker-usage-hourly", "POST", "GET"],
  ["/functions/tokentracker-usage-monthly", "POST", "GET"],
  ["/functions/tokentracker-skills", "PUT", "GET, POST", { ok: false, error: "Method Not Allowed" }],
  ["/functions/tokentracker-usage-limits", "POST", "GET"],
  ["/functions/tokentracker-ingest-health", "POST", "GET"],
];

test("every handled local API path enforces its declared method contract", async (t) => {
  const handler = makeHandler();
  for (const [pathname, method, allow, expectedBody = { error: "Method Not Allowed" }] of METHOD_CONTRACT) {
    await t.test(`${method} ${pathname}`, async () => {
      const { handled, res, json } = await call(handler, pathname, { method });
      assert.equal(handled, true);
      assert.equal(res.statusCode, 405);
      assert.equal(res.headers.Allow, allow);
      assert.deepEqual(json, expectedBody);
    });
  }
});

test("method guard does not turn unknown paths into handled 405 responses", async () => {
  const { handled, res } = await call(makeHandler(), "/functions/not-a-real-endpoint", {
    method: "POST",
  });
  assert.equal(handled, false);
  assert.equal(res.statusCode, null);
  assert.deepEqual(res.headers, {});
  assert.equal(res.body.length, 0);
});

test("existing GET and HEAD support remains reachable", async () => {
  const handler = makeHandler();

  const auth = await call(handler, "/api/local-auth");
  assert.equal(auth.res.statusCode, 200);
  assert.equal(typeof auth.json.token, "string");

  const proxyHead = await call(handler, "/proxy/ipcheck/not-allowed", { method: "HEAD" });
  assert.equal(proxyHead.res.statusCode, 403);

  const avatarHead = await call(handler, "/api/avatar-proxy", { method: "HEAD" });
  assert.equal(avatarHead.res.statusCode, 400);
});
