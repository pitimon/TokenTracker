import { describe, expect, it } from "vitest";
import { computePlanValue, formatUsd, rollUpPlanValues } from "./plan-value";

const source = (over: Record<string, unknown> = {}) => ({
  source: "claude",
  totals: { total_cost_usd: "47.000000" },
  models: [{ model: "claude-sonnet-5", pricing_tier: "litellm:exact" }],
  ...over,
});

describe("computePlanValue", () => {
  it("compares this window's list price against what the user pays", () => {
    const value = computePlanValue(source(), 20)!;
    expect(value.planPriceUsd).toBe(20);
    expect(value.listPriceUsd).toBe(47);
    expect(value.direction).toBe("above");
    expect(value.ratio).toBeCloseTo(2.35);
  });

  it("reads the same way when usage is BELOW the plan price", () => {
    // Under-usage is a downgrade signal and is exactly as useful as the other
    // direction, so nothing here treats it as the bad case.
    const value = computePlanValue(source({ totals: { total_cost_usd: "3.00" } }), 20)!;
    expect(value.direction).toBe("below");
    expect(value.listPriceUsd).toBe(3);
    expect(value.confidence).toBe("exact");
  });

  it("returns null with no plan price — absent is not zero", () => {
    // A card with no number beats a card with a wrong one, and treating an
    // unentered price as $0 would make every provider look infinitely over.
    expect(computePlanValue(source(), null)).toBeNull();
    expect(computePlanValue(source(), undefined)).toBeNull();
    expect(computePlanValue(source(), 0)).toBeNull();
    expect(computePlanValue(source(), -5)).toBeNull();
    expect(computePlanValue(source(), Number.NaN)).toBeNull();
  });

  it("marks the figure a FLOOR when some usage could not be priced", () => {
    // The caveats already shipped in #92 exist for exactly this. An unpriced
    // model means the real list price is higher than the number shown.
    const value = computePlanValue(
      source({
        models: [
          { model: "claude-sonnet-5", pricing_tier: "litellm:exact" },
          { model: "mystery-model", pricing_tier: "miss" },
        ],
      }),
      20,
    )!;
    expect(value.confidence).toBe("floor");
    expect(value.unpricedModels).toEqual(["mystery-model"]);
  });

  it("treats a fuzzy match as a floor too, and names it separately", () => {
    // A substring match can be wrong in either direction. It is still not a
    // figure anyone should read as exact.
    const value = computePlanValue(
      source({ models: [{ model: "some-model-v3", pricing_tier: "litellm:fuzzy" }] }),
      20,
    )!;
    expect(value.confidence).toBe("floor");
    expect(value.fuzzyModels).toEqual(["some-model-v3"]);
    expect(value.unpricedModels).toEqual([]);
  });

  it("counts the `unattributed` tier as unpriced", () => {
    // The tier added in #94 for "we recorded this before we recorded models".
    const value = computePlanValue(
      source({ models: [{ model: "unknown", pricing_tier: "unattributed" }] }),
      20,
    )!;
    expect(value.confidence).toBe("floor");
    expect(value.unpricedModels).toEqual(["unknown"]);
  });

  it("treats an approved composite-route blend as estimated, not exact", () => {
    const value = computePlanValue(
      source({
        totals: { total_cost_usd: "12" },
        models: [{
          model: "claude-auto-pilot-fable-v1-canary",
          pricing_tier: "routed-estimated",
        }],
      }),
      20,
    )!;
    expect(value.listPriceUsd).toBe(12);
    expect(value.confidence).toBe("floor");
    expect(value.unpricedModels).toEqual([]);
    expect(value.fuzzyModels).toEqual(["claude-auto-pilot-fable-v1-canary"]);
  });

  it("is exact when every model priced exactly", () => {
    const value = computePlanValue(
      source({
        models: [
          { model: "a", pricing_tier: "curated:exact" },
          { model: "b", pricing_tier: "litellm:exact-dot" },
          { model: "c", pricing_tier: "curated:alias" },
        ],
      }),
      20,
    )!;
    expect(value.confidence).toBe("exact");
  });

  it("does not choke on a source with no models or no totals", () => {
    const value = computePlanValue({ source: "zed" }, 10)!;
    expect(value.listPriceUsd).toBe(0);
    expect(value.direction).toBe("below");
    expect(value.confidence).toBe("exact");
  });

  it("deduplicates and sorts the named models", () => {
    const value = computePlanValue(
      source({
        models: [
          { model: "zeta", pricing_tier: "miss" },
          { model: "alpha", pricing_tier: "miss" },
          { model: "zeta", pricing_tier: "empty" },
        ],
      }),
      20,
    )!;
    expect(value.unpricedModels).toEqual(["alpha", "zeta"]);
  });
});

describe("rollUpPlanValues", () => {
  const claude = computePlanValue(source(), 20)!;
  const codex = computePlanValue(
    source({ source: "codex", totals: { total_cost_usd: "5.00" } }),
    25,
  )!;

  it("sums both sides across providers", () => {
    const rollup = rollUpPlanValues([claude, codex])!;
    expect(rollup.planPriceUsd).toBe(45);
    expect(rollup.listPriceUsd).toBe(52);
    expect(rollup.direction).toBe("above");
    expect(rollup.providerCount).toBe(2);
  });

  it("one floor anywhere makes the whole headline a floor", () => {
    // Averaging confidence would let a well-priced provider vouch for a
    // badly-priced one.
    const shaky = computePlanValue(
      source({ source: "kimi", models: [{ model: "x", pricing_tier: "miss" }] }),
      10,
    )!;
    expect(rollUpPlanValues([claude, shaky])!.confidence).toBe("floor");
    expect(rollUpPlanValues([claude, codex])!.confidence).toBe("exact");
  });

  it("returns null when no provider has a plan price", () => {
    expect(rollUpPlanValues([])).toBeNull();
  });

  it("reports `below` for the roll-up too, without treating it as failure", () => {
    const cheap = computePlanValue(source({ totals: { total_cost_usd: "1.00" } }), 20)!;
    expect(rollUpPlanValues([cheap])!.direction).toBe("below");
  });
});

describe("formatUsd", () => {
  it("keeps small numbers from reading as zero", () => {
    expect(formatUsd(0.0004)).toBe("$0.0004");
    expect(formatUsd(3)).toBe("$3.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(Number.NaN)).toBe("$0.00");
  });
});
