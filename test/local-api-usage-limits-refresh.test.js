"use strict";

// #141 requires that `refresh=1` and `refresh=true` both keep forcing a refresh.
// Nothing covered either spelling before, so "remains compatible" rested on
// reading the line. The dashboard client sends `refresh=1`
// (dashboard/src/lib/api.ts), and `true` is the form a human types by hand into
// the URL; silently dropping either turns a forced refresh into a cached read,
// which looks identical to a working one.

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

const LIMITS_PATH = require.resolve("../src/lib/usage-limits");
const { createLocalApiHandler } = require("../src/lib/local-api");
const { isForcedRefresh } = require("../src/lib/usage-limits");

// Both handlers that speak this protocol — src/lib/local-api.js and the Vite dev
// middleware in dashboard/vite.config.js — now call this one function rather than
// each keeping a copy of the comparison. The dev middleware cannot be driven from
// a Node test (vite.config.js exports only the config), so testing the shared
// parser is what makes "both handlers agree" a property of the code rather than a
// claim about two places that happen to match today.
for (const [value, expected] of [
  ["1", true],
  ["true", true],
  ["0", false],
  ["false", false],
  ["yes", false],
  ["", false],
  ["TRUE", false],
  ["True", false],
  [" 1", false],
  [null, false],
  [undefined, false],
]) {
  test(`isForcedRefresh(${JSON.stringify(value)}) === ${expected}`, () => {
    assert.equal(isForcedRefresh(value), expected);
  });
}

function createRequest() {
  const req = new EventEmitter();
  req.method = "GET";
  req.headers = {};
  process.nextTick(() => req.emit("end"));
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

// The route resolves `./usage-limits` per request, so replacing the module in
// the require cache is enough to observe which calls it makes — and keeps the
// test off the real providers, which would make it slow and machine-dependent.
function withStubbedUsageLimits(run) {
  const original = require.cache[LIMITS_PATH];
  const calls = { reset: 0, get: 0 };
  require.cache[LIMITS_PATH] = {
    id: LIMITS_PATH,
    filename: LIMITS_PATH,
    loaded: true,
    exports: {
      // The real parser, deliberately not a stand-in: stubbing it would make
      // this test prove only that the fake agrees with itself. Only the two
      // expensive calls are replaced, so what is observed is the real route
      // running the real force decision.
      isForcedRefresh,
      resetUsageLimitsCache() {
        calls.reset += 1;
      },
      async getUsageLimits() {
        calls.get += 1;
        return { fetched_at: `sweep-${calls.get}` };
      },
    },
  };
  try {
    return run(calls);
  } finally {
    if (original) require.cache[LIMITS_PATH] = original;
    else delete require.cache[LIMITS_PATH];
  }
}

async function requestLimits(query) {
  const handler = createLocalApiHandler({ queuePath: "/nonexistent/queue.jsonl" });
  const req = createRequest();
  const res = createResponse();
  const handled = await handler(
    req,
    res,
    new URL(`http://127.0.0.1/functions/tokentracker-usage-limits${query}`),
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode ?? 200, 200);
  return JSON.parse(res.body.toString("utf8"));
}

for (const query of ["?refresh=1", "?refresh=true"]) {
  test(`${query} resets the quota cache before fetching`, async () => {
    await withStubbedUsageLimits(async (calls) => {
      const data = await requestLimits(query);
      assert.equal(calls.reset, 1, `${query} did not force a refresh`);
      assert.equal(calls.get, 1);
      assert.equal(data.fetched_at, "sweep-1");
    });
  });
}

for (const query of ["", "?refresh=0", "?refresh=yes", "?refresh="]) {
  test(`${query || "(no query)"} leaves the quota cache alone`, async () => {
    await withStubbedUsageLimits(async (calls) => {
      await requestLimits(query);
      assert.equal(
        calls.reset,
        0,
        `${query || "(no query)"} forced a refresh — every scheduled poll would clear the cache`,
      );
      assert.equal(calls.get, 1);
    });
  });
}
