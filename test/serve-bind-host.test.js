const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { createRequestHandler, LOCAL_BIND_HOST, getLocalServerUrl } = require("../src/commands/serve");

test("serve binds to loopback and advertises the loopback URL", () => {
  assert.equal(LOCAL_BIND_HOST, "127.0.0.1");
  assert.equal(getLocalServerUrl(7680), "http://127.0.0.1:7680");
});

test("serve startup does not persistently rewrite config.json", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "commands", "serve.js"), "utf8");
  assert.doesNotMatch(source, /writeJson\s*\(\s*cfgPath/);
  assert.doesNotMatch(source, /cfg\.baseUrl\s*=/);
});

test("serve handles OPTIONS as a server-level preflight before endpoint methods", async () => {
  let apiCalls = 0;
  const handler = createRequestHandler({
    handleApi: async () => {
      apiCalls += 1;
      return true;
    },
    dashboardDir: "/nonexistent",
  });
  const req = {
    method: "OPTIONS",
    url: "/functions/tokentracker-usage-summary",
    headers: { host: "127.0.0.1:7680" },
  };
  const res = {
    statusCode: null,
    headers: {},
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end() {},
  };

  await handler(req, res);

  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Methods"], "GET, POST, OPTIONS");
  assert.equal(apiCalls, 0);
});
