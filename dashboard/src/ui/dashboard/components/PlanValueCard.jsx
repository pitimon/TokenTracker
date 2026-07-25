import React, { useMemo } from "react";
import { computePlanValue, formatUsd, rollUpPlanValues } from "../../../lib/plan-value";

/**
 * "Is my plan worth it?" — the number README:32 already promises and the product
 * did not compute.
 *
 * The arithmetic is a subtraction; the labelling is the hard part, and the rules
 * it follows come straight from issue 106:
 *
 * - It never says "you saved". This is LIST-PRICE-EQUIVALENT, not a
 *   counterfactual bill — anyone actually on the API would use it differently.
 *   The disclaimer line is not decoration, it is the claim being kept honest.
 * - Under-usage reads the same as over-usage. "$3 of usage on a $20 plan" is a
 *   downgrade signal and is exactly as useful as the other direction, so neither
 *   gets a colour or a verdict.
 * - When any model in the window could not be priced, the figure is a FLOOR and
 *   says so, naming the models. The caveats shipped in #92 exist for this.
 *
 * Renders nothing when no provider has a plan price. A card with no number beats
 * a card with a wrong one.
 */
// Module level rather than inline, for two reasons: the arrow function reads
// better away from the JSX, and the ui-hardcode scanner treats the `=>` before a
// `return (` as an opening JSX tag and everything after it as raw text.
function namedFloorModels(values) {
  const names = new Set();
  for (const value of values) {
    for (const model of value.unpricedModels) names.add(model);
    for (const model of value.fuzzyModels) names.add(model);
  }
  return Array.from(names).sort().join(", ");
}

export function PlanValueCard({
  sources = [],
  planPrices = {},
  onPlanPriceChange,
  copy,
  className = "",
}) {
  // Every provider with usage in this window, whether or not it has a price
  // yet — the input has to be reachable before the comparison can exist.
  const providers = (Array.isArray(sources) ? sources : [])
    .map((s) => String(s?.source || "").toLowerCase())
    .filter(Boolean);
  const { values, rollup } = useMemo(() => {
    const list = (Array.isArray(sources) ? sources : [])
      .map((source) => computePlanValue(source, planPrices?.[String(source?.source || "").toLowerCase()]))
      .filter(Boolean);
    return { values: list, rollup: rollUpPlanValues(list) };
  }, [sources, planPrices]);

  const title = copy("dashboard.plan_value.title");

  // The inputs. Rendered in both states, because in the empty state they are
  // the only way out of it.
  const priceInputs = onPlanPriceChange ? (
    <div className="mt-2 space-y-1">
      {providers.map((provider) => (
        <label
          key={provider}
          className="flex items-baseline justify-between gap-3 oai-text-caption text-oai-gray-500 dark:text-oai-gray-400"
        >
          <span className="truncate">{provider}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            aria-label={copy("dashboard.plan_value.input_aria", { source: provider })}
            value={planPrices?.[provider] ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              onPlanPriceChange(provider, raw === "" ? null : Number(raw));
            }}
            className="w-20 rounded border border-oai-gray-300 dark:border-oai-gray-700 oai-bg-elevated px-1.5 py-0.5 text-right tabular-nums"
          />
        </label>
      ))}
    </div>
  ) : null;

  if (!rollup) {
    return (
      <div className={className}>
        <div className="oai-text-body-sm font-medium text-oai-black dark:text-oai-white">{title}</div>
        <div className="mt-1 oai-text-caption text-oai-gray-500 dark:text-oai-gray-400">
          {copy("dashboard.plan_value.empty")}
        </div>
        {priceInputs}
      </div>
    );
  }

  const floorList = namedFloorModels(values);

  return (
    <div className={className}>
      <div className="oai-text-body-sm font-medium text-oai-black dark:text-oai-white">{title}</div>

      <div className="mt-1 oai-text-body-sm text-oai-black dark:text-oai-white tabular-nums">
        {copy("dashboard.plan_value.headline", {
          plan: formatUsd(rollup.planPriceUsd),
          list: formatUsd(rollup.listPriceUsd),
        })}
      </div>

      <div className="mt-2 space-y-1">
        {values.map((value) => (
          <div
            key={value.source}
            className="flex items-baseline justify-between gap-3 oai-text-caption text-oai-gray-500 dark:text-oai-gray-400"
          >
            <span className="truncate">{value.source}</span>
            <span className="tabular-nums whitespace-nowrap">
              {copy("dashboard.plan_value.row", {
                plan: formatUsd(value.planPriceUsd),
                list: formatUsd(value.listPriceUsd),
              })}
            </span>
          </div>
        ))}
      </div>

      {priceInputs}

      {rollup.confidence === "floor" ? (
        <div className="mt-2 oai-text-caption text-oai-gray-500 dark:text-oai-gray-400">
          {copy("dashboard.plan_value.floor_note", { models: floorList })}
        </div>
      ) : null}

      <div className="mt-1 oai-text-caption text-oai-gray-500 dark:text-oai-gray-400">
        {copy("dashboard.plan_value.disclaimer")}
      </div>
    </div>
  );
}
