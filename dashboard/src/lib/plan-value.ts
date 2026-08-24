// "Is my plan worth it?" — the number README:32 already promises.
//
//   > Subscriptions hide the number entirely. A flat monthly plan shows you a
//   > quota bar, not what your usage would have cost. TokenTracker prices every
//   > token against public model rates, so you can see whether the plan is a
//   > bargain or a subsidy you have outgrown.
//
// The arithmetic is a subtraction. THE LABELLING IS THE HARD PART, and this
// module exists so it can be tested away from React.
//
// Three rules it enforces, all from issue 106:
//
// 1. It is LIST-PRICE-EQUIVALENT, not a counterfactual bill. Anyone actually on
//    the API would use it differently, so nothing here says "you saved".
// 2. It inherits the pricing caveats. If any model in the window is unpriced or
//    fuzzy-matched, the comparison is a FLOOR, not a figure — `confidence`
//    says which, and the caller must show it.
// 3. It reads NEUTRALLY IN BOTH DIRECTIONS. "$3 of usage on a $20 plan" is a
//    downgrade signal and is exactly as useful as the other direction, so
//    neither is celebrated.

export type PlanConfidence = "exact" | "floor";

export type PlanValue = {
  source: string;
  /** What the user pays, per month, as they entered it. */
  planPriceUsd: number;
  /** What this window's usage would cost at public list rates. */
  listPriceUsd: number;
  /**
   * "above" — usage exceeds the plan price. "below" — it does not.
   * Deliberately not "saving"/"losing": see rule 1.
   */
  direction: "above" | "below" | "even";
  /** listPrice / planPrice. 1 means the plan exactly breaks even. */
  ratio: number;
  /**
   * "floor" when some usage in the window could not be priced, so the real
   * list-price figure is at least this much and possibly more.
   */
  confidence: PlanConfidence;
  /** Models that made this a floor rather than a figure. */
  unpricedModels: string[];
  fuzzyModels: string[];
};

type SourceTotals = { total_cost_usd?: string | number };
type SourceModel = { model?: string; model_id?: string; pricing_tier?: string };
type BreakdownSource = {
  source?: string;
  totals?: SourceTotals;
  models?: SourceModel[];
};

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// Tiers that mean "we did not really price this". `miss` and `empty` produced no
// price at all; the fuzzy tiers matched by substring, which is a guess that can
// be wrong in either direction. Kept as an explicit list rather than a
// "not exact" rule so a NEW tier has to be classified deliberately.
const UNPRICED_TIERS = new Set(["miss", "empty", "unattributed", "routed-unresolved"]);
const FUZZY_TIERS = new Set(["curated:fuzzy", "litellm:fuzzy", "litellm:prefix-strip", "litellm:strip"]);

function modelName(model: SourceModel): string {
  return String(model.model || model.model_id || "").trim();
}

/**
 * One provider's comparison. Returns null when there is no plan price to compare
 * against — an absent price is not zero, and a card with no number is better
 * than a card with a wrong one.
 */
export function computePlanValue(
  source: BreakdownSource,
  planPriceUsd: number | null | undefined,
): PlanValue | null {
  const price = Number(planPriceUsd);
  if (!Number.isFinite(price) || price <= 0) return null;

  const listPriceUsd = toNumber(source?.totals?.total_cost_usd);
  const models = Array.isArray(source?.models) ? source.models : [];

  const unpricedModels = models
    .filter((m) => UNPRICED_TIERS.has(String(m.pricing_tier || "")))
    .map(modelName)
    .filter(Boolean);
  const fuzzyModels = models
    .filter((m) => FUZZY_TIERS.has(String(m.pricing_tier || "")))
    .map(modelName)
    .filter(Boolean);

  const ratio = listPriceUsd / price;
  const direction = ratio > 1 ? "above" : ratio < 1 ? "below" : "even";

  return {
    source: String(source?.source || ""),
    planPriceUsd: price,
    listPriceUsd,
    direction,
    ratio,
    // Unpriced usage means the real figure is higher than this one. A fuzzy
    // match could be wrong in either direction, but it is still not a figure
    // anyone should read as exact, so it lands in the same bucket.
    confidence: unpricedModels.length > 0 || fuzzyModels.length > 0 ? "floor" : "exact",
    unpricedModels: [...new Set(unpricedModels)].sort(),
    fuzzyModels: [...new Set(fuzzyModels)].sort(),
  };
}

export type PlanRollup = {
  planPriceUsd: number;
  listPriceUsd: number;
  direction: "above" | "below" | "even";
  confidence: PlanConfidence;
  /** How many providers contributed, so the headline can say what it covers. */
  providerCount: number;
};

/**
 * One headline across providers. Only providers with a plan price count — a
 * provider the user pays nothing for has no plan to evaluate, and folding its
 * usage in would inflate the list-price side against a smaller plan side.
 */
export function rollUpPlanValues(values: PlanValue[]): PlanRollup | null {
  const priced = values.filter(Boolean);
  if (priced.length === 0) return null;

  const planPriceUsd = priced.reduce((sum, v) => sum + v.planPriceUsd, 0);
  const listPriceUsd = priced.reduce((sum, v) => sum + v.listPriceUsd, 0);
  return {
    planPriceUsd,
    listPriceUsd,
    direction: listPriceUsd > planPriceUsd ? "above" : listPriceUsd < planPriceUsd ? "below" : "even",
    // One floor anywhere makes the whole headline a floor. Averaging confidence
    // would let a well-priced provider vouch for a badly-priced one.
    confidence: priced.some((v) => v.confidence === "floor") ? "floor" : "exact",
    providerCount: priced.length,
  };
}

/** Two decimals above a cent, four below, so small numbers do not read as zero. */
export function formatUsd(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
