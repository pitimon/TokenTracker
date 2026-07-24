const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { isAllowedHostHeader, createRequestHandler } = require("../src/commands/serve");

// Boots a real server with a stub API handler so the assertions cover the
// wiring, not just the predicate: a guard that is never reached would pass a
// predicate-only test while leaving the hole wide open. Issue #88.
async function withServer(run) {
  const seen = [];
  const handleApi = async (req, res, url) => {
    seen.push(url.pathname);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ secret: "spend history" }));
    return true;
  };
  const server = http.createServer(
    createRequestHandler({ handleApi, dashboardDir: path.join(os.tmpdir(), "tt-no-dashboard") }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run({ port, seen });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function request({ port, hostHeader, method = "GET", pathname = "/functions/tokentracker-usage-summary" }) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (hostHeader !== undefined) headers.Host = hostHeader;
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("a rebound hostname is rejected before the API handler runs", async () => {
  await withServer(async ({ port, seen }) => {
    const res = await request({ port, hostHeader: `attacker.example:${port}` });
    assert.equal(res.status, 403);
    assert.match(res.body, /loopback/i);
    assert.equal(res.body.includes("spend history"), false, "no data may leak in the 403 body");
    assert.deepEqual(seen, [], "the API handler must never be reached");
  });
});

test("an OPTIONS preflight from a rebound hostname is also rejected", async () => {
  await withServer(async ({ port }) => {
    const res = await request({ port, hostHeader: "attacker.example", method: "OPTIONS" });
    assert.equal(res.status, 403);
  });
});

test("loopback hosts still reach the API on any port", async () => {
  await withServer(async ({ port, seen }) => {
    for (const hostHeader of [`127.0.0.1:${port}`, `localhost:${port}`, "localhost", `[::1]:${port}`]) {
      const res = await request({ port, hostHeader });
      assert.equal(res.status, 200, `expected ${hostHeader} to be allowed`);
      assert.match(res.body, /spend history/);
    }
    assert.equal(seen.length, 4);
  });
});

test("isAllowedHostHeader accepts every loopback spelling", () => {
  for (const host of [
    "127.0.0.1",
    "127.0.0.1:17680",
    "localhost",
    "localhost:7680",
    "[::1]",
    "[::1]:17680",
  ]) {
    assert.equal(isAllowedHostHeader(host), true, `${host} should be allowed`);
  }
});

test("isAllowedHostHeader rejects non-loopback and lookalike hosts", () => {
  for (const host of [
    "attacker.example",
    "attacker.example:17680",
    "tokentracker.local",
    "127.0.0.1.attacker.example",
    "localhost.attacker.example",
    // userinfo trick: the real hostname is after the '@'
    "localhost:17680@attacker.example",
    "0.0.0.0",
    "192.168.1.20:17680",
  ]) {
    assert.equal(isAllowedHostHeader(host), false, `${host} should be rejected`);
  }
});

test("an absent or empty Host header is allowed (HTTP/1.0 clients, local probes)", async () => {
  assert.equal(isAllowedHostHeader(undefined), true);
  assert.equal(isAllowedHostHeader(null), true);
  assert.equal(isAllowedHostHeader(""), true);
});

test("a malformed Host header is rejected rather than throwing", () => {
  for (const host of ["::::", "[unclosed", "%%%"]) {
    assert.equal(isAllowedHostHeader(host), false, `${host} should be rejected`);
  }
});
