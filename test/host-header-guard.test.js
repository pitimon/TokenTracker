const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  isAllowedHostHeader,
  isAllowedRequestTarget,
  createRequestHandler,
} = require("../src/commands/serve");

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

// Raw socket write, so the request-target can be absolute-form — http.request
// always sends origin-form and cannot express it.
function rawRequest(port, requestLine, extraHeaders = "") {
  const net = require("node:net");
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`${requestLine}\r\n${extraHeaders}Connection: close\r\n\r\n`);
    });
    let body = "";
    socket.on("data", (chunk) => { body += chunk; });
    socket.on("end", () => resolve(body));
    socket.on("error", reject);
  });
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

test("an absolute-form request target is refused rather than routed by its own authority", async () => {
  // Host says loopback, the target says otherwise. Routing would parse the
  // absolute URL and take evil.example as the authority, disagreeing with the
  // allowlist that just passed the request.
  await withServer(async ({ port, seen }) => {
    const response = await rawRequest(
      port,
      "GET http://evil.example/functions/tokentracker-usage-summary HTTP/1.1",
      "Host: localhost\r\n",
    );
    assert.match(response.split("\r\n")[0], /400/);
    assert.equal(response.includes("spend history"), false);
    assert.deepEqual(seen, [], "the API handler must never be reached");
  });
});

test("the fully-qualified loopback spelling is allowed", () => {
  for (const host of ["localhost.", "localhost.:17680", "127.0.0.1.", "127.0.0.1.:7680"]) {
    assert.equal(isAllowedHostHeader(host), true, `${host} should be allowed`);
  }
  // Stripping the dot must not turn a foreign name into a loopback one.
  assert.equal(isAllowedHostHeader("evil.example."), false);
  assert.equal(isAllowedHostHeader("localhost.evil.example."), false);
});

test("userinfo in a Host header is refused even when the host itself is loopback", () => {
  // Not a rebinding bypass on its own — the origin really is 127.0.0.1 — but
  // Host has no userinfo component, so anything carrying one is malformed and
  // only creates room for two parsers to disagree.
  assert.equal(isAllowedHostHeader("evil.example@127.0.0.1"), false);
  assert.equal(isAllowedHostHeader("user:pass@localhost"), false);
});

test("isAllowedRequestTarget accepts only origin-form and asterisk-form", () => {
  for (const target of ["/", "/functions/x", "/api/y?z=1", "*"]) {
    assert.equal(isAllowedRequestTarget(target), true, `${target} should be allowed`);
  }
  for (const target of ["http://evil.example/x", "https://evil.example/x", "evil.example:443", "", null]) {
    assert.equal(isAllowedRequestTarget(target), false, `${JSON.stringify(target)} should be refused`);
  }
});
