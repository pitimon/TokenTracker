"use strict";

/**
 * Coalesce concurrent calls to one expensive async producer.
 *
 * The problem it solves is not "the same work runs twice" — it is that the work
 * being duplicated fans out to every configured provider's private endpoint. Two
 * dashboard tabs, a route mount, and a scheduled revalidation can all arrive
 * inside the same second on a cold cache; without this, each one launches its own
 * full sweep.
 *
 * `run(fn)` returns the in-flight promise when one exists, so every caller in a
 * window shares a single execution and a single result object. The slot is
 * released as soon as the work settles — success or failure — so the next call
 * starts fresh work rather than replaying a stale outcome.
 *
 * Deliberately NOT keyed by argument: the single consumer here has one shared
 * result for the whole process. A joining caller therefore receives the FIRST
 * caller's work, arguments included. That is the intended trade for the fan-out,
 * and it is safe only because every production call site passes the same inputs.
 *
 * @returns {(fn: () => Promise<any>) => Promise<any>}
 */
function createSingleFlight() {
  let inFlight = null;

  return function run(fn) {
    if (inFlight) return inFlight;

    // `Promise.resolve().then(fn)` rather than `fn()` so a synchronous throw
    // inside fn becomes a rejection on this path too, instead of escaping past
    // the slot cleanup and wedging `inFlight` forever.
    //
    // Release carries no `inFlight === pending` identity guard, deliberately. A
    // later run can only claim the slot after this one released it — while
    // `pending` is unsettled every arrival joins instead of replacing it — so a
    // stale callback clearing a successor's slot is unreachable, and a mutation
    // test found the guard dead. Adding a way to clear the slot from outside
    // would make it reachable again; there is none, and #141 requires that a
    // cache reset specifically must not do it.
    const pending = Promise.resolve()
      .then(fn)
      .finally(() => {
        inFlight = null;
      });

    // Module state now holds a promise that real callers may all walk away from.
    // Without a handler of its own, a rejection reaching only this reference is
    // an unhandledRejection raised from state nobody is watching — a failure mode
    // that did not exist while every caller owned its own promise. Callers still
    // receive the rejection; this only marks the stored reference as handled.
    pending.catch(() => {});

    inFlight = pending;
    return pending;
  };
}

module.exports = { createSingleFlight };
