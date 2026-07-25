"use strict";

// A durable guard, not a one-off grep.
//
// There is no DashboardView test harness, and this session already produced the
// lesson: a Vite build stayed green over a deleted identifier, and a notice was
// wired into a component nothing mounts. A build passing is not evidence that a
// card reaches the screen.
//
// So this asserts the wiring as source facts. It is coarse — it cannot prove the
// card renders — but it fails loudly if any link in the chain is removed, which
// is the failure mode that actually happens.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", ...parts), "utf8");

test("DashboardView mounts PlanValueCard with the data it needs", () => {
  const view = read("ui", "dashboard", "views", "DashboardView.jsx");
  assert.match(view, /import \{ PlanValueCard \} from "\.\.\/components\/PlanValueCard\.jsx"/);
  assert.match(view, /<PlanValueCard/);
  assert.match(view, /sources=\{modelBreakdown\?\.sources\}/, "the card needs per-source cost");
  assert.match(view, /planPrices=\{planPrices\}/);
  assert.match(view, /onPlanPriceChange=\{onPlanPriceChange\}/, "without this there is no way to set a price");
  assert.match(view, /modelBreakdown = null,/, "the prop has to be destructured to arrive");
  assert.match(view, /planPrices = \{\},/);
});

test("DashboardPage supplies them", () => {
  const page = read("pages", "DashboardPage.jsx");
  assert.match(page, /const \{ planPrices, setPlanPrice \} = usePlanPrices\(\)/);
  assert.match(page, /modelBreakdown=\{modelBreakdown\}/);
  assert.match(page, /planPrices=\{planPrices\}/);
  assert.match(page, /onPlanPriceChange=\{setPlanPrice\}/);
});

test("the plan price never leaves the machine", () => {
  // The product's headline claim. A plan price is exactly the kind of thing it
  // promises not to transmit, so the hook must reach localStorage and nothing
  // else — no fetch, no api import.
  const hook = read("hooks", "use-plan-prices.ts");
  assert.match(hook, /window\.localStorage/);
  assert.doesNotMatch(hook, /\bfetch\s*\(/, "the plan price must not be sent anywhere");
  assert.doesNotMatch(hook, /from "\.\.\/lib\/api"/, "no API client in the storage hook");
});

test("the card's honesty rules are stated in its own source", () => {
  // These are the sentences a future edit is most likely to quietly drop, and
  // the component tests assert the rendered behaviour. This pins the reasoning
  // next to it so the "why" is not lost when the "what" is edited.
  const card = read("ui", "dashboard", "components", "PlanValueCard.jsx");
  assert.match(card, /LIST-PRICE-EQUIVALENT|list-price-equivalent/i);
  assert.match(card, /FLOOR|floor/);
});
