"use strict";

// The coalescing contract for the quota fan-out (#141), tested where it can be
// tested. Every provider inside `getUsageLimits` is individually guarded, and no
// combination of injected inputs tried here (a throwing securityRunner, a
// rejecting commandRunner, a rejecting fetchImpl, a rejecting requestFn) produced
// a catchable rejection from it — so its public surface cannot reliably exercise
// "a failed run releases the slot", which is the branch that, if wrong, wedges
// the endpoint until the process restarts. Hence the helper is tested directly.

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createSingleFlight } = require("../src/lib/single-flight");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("concurrent callers share one execution and one result object", async () => {
  const run = createSingleFlight();
  const gate = deferred();
  let calls = 0;
  const work = () => {
    calls += 1;
    return gate.promise;
  };

  const a = run(work);
  const b = run(work);
  const c = run(work);

  const result = { fetched_at: "once" };
  gate.resolve(result);
  const [ra, rb, rc] = await Promise.all([a, b, c]);

  assert.equal(calls, 1, "the producer ran more than once — callers did not join");
  // Identity, not deep equality: two independent runs would produce two objects
  // that compare equal but are not the same fan-out.
  assert.equal(ra, result);
  assert.equal(rb, result);
  assert.equal(rc, result);
});

test("a caller arriving after the work settled starts a new execution", async () => {
  const run = createSingleFlight();
  let calls = 0;
  const work = async () => {
    calls += 1;
    return { run: calls };
  };

  const first = await run(work);
  const second = await run(work);

  assert.equal(calls, 2);
  assert.deepEqual(first, { run: 1 });
  assert.deepEqual(second, { run: 2 });
});

test("a rejection reaches every joined caller and still releases the slot", async () => {
  const run = createSingleFlight();
  const gate = deferred();
  let calls = 0;
  const failing = () => {
    calls += 1;
    return gate.promise;
  };

  const a = run(failing);
  const b = run(failing);
  gate.reject(new Error("fan-out failed"));

  await assert.rejects(a, /fan-out failed/);
  await assert.rejects(b, /fan-out failed/);
  assert.equal(calls, 1);

  // The retry is the point: a failed sweep must not be remembered.
  const after = await run(async () => ({ ok: true }));
  assert.deepEqual(after, { ok: true });
  assert.equal(calls, 1, "the retry re-entered the failed producer instead of the new one");
});

test("a synchronous throw is turned into a rejection and does not wedge the slot", async () => {
  const run = createSingleFlight();

  await assert.rejects(
    run(() => {
      throw new Error("threw before returning a promise");
    }),
    /threw before returning a promise/,
  );

  const after = await run(async () => "recovered");
  assert.equal(after, "recovered");
});

test("a rejection nobody is waiting on does not surface as an unhandledRejection", async () => {
  // The shared promise lives in module state. Before coalescing, every caller
  // owned its own promise and awaited it; now a failed run can outlive every
  // caller, and an unhandledRejection from state nobody watches would take the
  // process down under Node's default --unhandled-rejections=throw.
  const seen = [];
  const onUnhandled = (reason) => seen.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const run = createSingleFlight();
    run(async () => {
      throw new Error("nobody is listening");
    });
    // Two macrotask turns: rejection settles, then the unhandled check fires.
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }

  assert.deepEqual(
    seen.map((e) => e?.message),
    [],
    "the stored in-flight promise rejected with no handler attached",
  );
});

test("a caller arriving while work is unsettled joins it rather than replacing it", async () => {
  // This is why the slot needs no identity guard on release: a run can only be
  // replaced after it cleared the slot itself, so a stale callback can never
  // clear a successor's. Pin the property the guard would have protected.
  const run = createSingleFlight();
  const gate = deferred();

  const b = run(() => gate.promise);
  const c = run(() => {
    throw new Error("should not run — the first call is still in flight");
  });
  assert.equal(b, c, "the second caller started new work instead of joining");

  gate.resolve("shared");
  assert.equal(await b, "shared");
});
