import React, { useState, useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Info, SquareArrowOutUpRight } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Card, Button, Counter } from "../../components";
import { useCurrency } from "../../../hooks/useCurrency.js";
import { copy, getCopyLocale } from "../../../lib/copy";
import { DateRangePopover, formatDateShort, getDateFnsLocale } from "./DateRangePopover.jsx";
import {
  normalizePeriods,
  parseAnimatedCounterValue,
  formatCostPerMillion,
  formatModelName,
} from "./usageFormat.js";

// Refresh button with rotation animation
function RefreshButton({ loading, onClick }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={loading}
      onClick={onClick}
      aria-label={copy("usage.button.refresh")}
      className="w-8 p-0"
    >
      <motion.span
        aria-hidden="true"
        animate={loading ? { rotate: 360 } : { rotate: 0 }}
        transition={
          loading && !shouldReduceMotion
            ? { duration: 1, repeat: Infinity, ease: "linear" }
            : { duration: 0.3 }
        }
        style={{ display: "inline-block" }}
      >
        ↻
      </motion.span>
    </Button>
  );
}

export function HeroSummary({
  period,
  periods,
  onPeriodChange,
  autoRefreshOptions = [],
  autoRefreshIntervalMs,
  onAutoRefreshIntervalChange,
  summaryValue,
  summaryLabel,
  summaryUpdatedAtLabel,
  summaryCostValue,
  usageInsights,
  onCostInfo,
  onRefresh,
  loading,
  customFrom,
  customTo,
  onCustomRangeApply,
  customRangeOpen,
  onCustomRangeOpenChange,
  onOpenShare,
}) {
  const shouldReduceMotion = useReducedMotion();
  const tabs = normalizePeriods(periods);
  const showAutoRefreshSelect =
    Array.isArray(autoRefreshOptions) &&
    autoRefreshOptions.length > 0 &&
    typeof onAutoRefreshIntervalChange === "function";
  const dateLocale = getDateFnsLocale(getCopyLocale());
  const summaryCounterValue = parseAnimatedCounterValue(String(summaryValue ?? ""));
  // The digit-by-digit Counter renders at a fixed 72px and would clip on
  // phones. Below sm we drop it and render the plain value, which scales
  // with the responsive font class below. 639px == one below Tailwind's
  // sm (640px), so this flips in lockstep with the sm: classes.
  const matchesCompact = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 639px)").matches;
  const [isCompactSummary, setIsCompactSummary] = useState(matchesCompact);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = (e) => setIsCompactSummary(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const showAnimatedSummary =
    summaryCounterValue != null && !isCompactSummary && !loading && !shouldReduceMotion;
  // Keep the selected period chip in view when the tab strip scrolls
  // horizontally on narrow screens.
  const tablistRef = useRef(null);
  useEffect(() => {
    const el = tablistRef.current?.querySelector('[aria-selected="true"]');
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [period]);
  const { currency, rate } = useCurrency();

  const costPerMillionLabel = formatCostPerMillion(
    usageInsights?.costPerMillionTokens,
    currency,
    rate,
  );
  const topCostModelName = usageInsights?.topCostModel?.name
    ? formatModelName(usageInsights.topCostModel.name)
    : "";
  const topUsageModelName = usageInsights?.topUsageModel?.name
    ? formatModelName(usageInsights.topUsageModel.name)
    : "";
  const missingPricingCount = Array.isArray(usageInsights?.missingPricingModels)
    ? usageInsights.missingPricingModels.length
    : 0;
  const hasMissingPricing = Boolean(missingPricingCount);
  const hasInsightChips = Boolean(
    costPerMillionLabel || topCostModelName || topUsageModelName || hasMissingPricing,
  );

  return (
    <Card>
        {/* Header: Period Tabs + Refresh. Tabs are a single horizontal-scroll
            strip (never wrap into stacked rows); actions stay pinned right. */}
        <div className="flex items-center gap-2 mb-6">
          <div ref={tablistRef} role="tablist" aria-label={copy("usage.overview.tablist_aria")} className="flex flex-1 min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((p) => {
              const isActive = period === p.key;
              const tabClass = `shrink-0 whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                isActive
                  ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                  : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800"
              }`;

              if (p.key === "custom") {
                const customLabel = isActive && customFrom && customTo
                  ? `${formatDateShort(customFrom, dateLocale)} — ${formatDateShort(customTo, dateLocale)}`
                  : p.label;

                return (
                  <Popover.Root
                    key="custom"
                    open={customRangeOpen}
                    onOpenChange={(open) => {
                      if (open) onPeriodChange?.("custom");
                      else onCustomRangeOpenChange?.(open);
                    }}
                  >
                    <Popover.Trigger
                      render={
                        <button
                          role="tab"
                          aria-selected={isActive}
                          type="button"
                          className={tabClass}
                        />
                      }
                    >
                      {customLabel}
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Positioner sideOffset={8} side="bottom" align="start" className="!z-[9999]">
                        <Popover.Popup className="bg-white dark:bg-oai-gray-900 border border-oai-gray-200 dark:border-oai-gray-700 rounded-xl shadow-lg">
                          <DateRangePopover
                            from={customFrom}
                            to={customTo}
                            onApply={onCustomRangeApply}
                            onCancel={() => onCustomRangeOpenChange?.(false)}
                          />
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>
                );
              }

              return (
                <button
                  key={p.key}
                  role="tab"
                  aria-selected={isActive}
                  type="button"
                  className={tabClass}
                  onClick={() => onPeriodChange?.(p.key)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {showAutoRefreshSelect ? (
              <select
                aria-label={copy("usage.auto_refresh.aria")}
                value={String(autoRefreshIntervalMs)}
                onChange={(event) => onAutoRefreshIntervalChange(event.target.value)}
                className="h-8 rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-oai-white dark:bg-oai-gray-900 px-2 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200 transition-colors hover:border-oai-gray-400 dark:hover:border-oai-gray-600 focus:outline-none focus:ring-2 focus:ring-oai-brand/25"
              >
                {autoRefreshOptions.map((option) => (
                  <option key={option.value} value={String(option.value)}>
                    {copy(option.labelKey)}
                  </option>
                ))}
              </select>
            ) : null}
            {onOpenShare ? (
              <button
                type="button"
                onClick={onOpenShare}
                aria-label={copy("share.button.aria")}
                className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-oai-white dark:bg-oai-gray-900 text-oai-black dark:text-oai-white hover:border-oai-brand hover:text-oai-brand transition-colors duration-200"
              >
                <SquareArrowOutUpRight className="h-3.5 w-3.5" strokeWidth={2} />
                {copy("share.button.label")}
              </button>
            ) : null}
            {onRefresh && (
              <RefreshButton loading={loading} onClick={onRefresh} />
            )}
          </div>
        </div>

        {/* Main Stats */}
        <div className="text-center mb-8">
          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wider mb-3">{summaryLabel}</div>
          <div className="text-5xl sm:text-6xl md:text-7xl font-bold text-oai-black dark:text-oai-white tracking-tight tabular-nums">
            {showAnimatedSummary ? (
              <Counter
                value={summaryCounterValue}
                displayValue={summaryValue}
                fontSize={72}
                padding={6}
                gap={1}
                textColor="var(--oai-black, #111827)"
                fontWeight={700}
                variant="led"
                gradientHeight={8}
                gradientFrom="rgba(8,11,17,0.98)"
                gradientTo="rgba(8,11,17,0)"
                counterStyle={{ paddingLeft: 0, paddingRight: 0, gap: 0 }}
                digitStyle={{ width: "0.88ch" }}
              />
            ) : (
              summaryValue
            )}
          </div>
          {summaryUpdatedAtLabel ? (
            <div className="mt-3 text-[11px] font-medium text-oai-gray-400 dark:text-oai-gray-500 tabular-nums">
              {summaryUpdatedAtLabel}
            </div>
          ) : null}
          {summaryCostValue && (
            <div className="flex items-center justify-center gap-2 mt-3">
              {onCostInfo ? (
                <button
                  type="button"
                  onClick={onCostInfo}
                  className="inline-flex items-center gap-1.5 text-xl font-bold text-oai-brand hover:text-oai-brand-dark dark:hover:text-oai-brand-light transition-colors cursor-pointer"
                  aria-label={copy("usage.overview.cost_breakdown_aria")}
                >
                  {summaryCostValue}
                  <Info size={16} strokeWidth={2} className="opacity-80" />
                </button>
              ) : (
                <span className="text-xl font-bold text-oai-brand">{summaryCostValue}</span>
              )}
            </div>
          )}
          {hasInsightChips && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-medium">
              {costPerMillionLabel ? (
                <span className="rounded-md border border-oai-gray-200 dark:border-oai-gray-700 px-2 py-1 text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                  {copy("usage.overview.cost_per_mtok", { value: costPerMillionLabel })}
                </span>
              ) : null}
              {topCostModelName ? (
                <span className="rounded-md border border-oai-gray-200 dark:border-oai-gray-700 px-2 py-1 text-oai-gray-600 dark:text-oai-gray-300">
                  {copy("usage.overview.top_cost_model", { model: topCostModelName })}
                </span>
              ) : null}
              {topUsageModelName && topUsageModelName !== topCostModelName ? (
                <span className="rounded-md border border-oai-gray-200 dark:border-oai-gray-700 px-2 py-1 text-oai-gray-600 dark:text-oai-gray-300">
                  {copy("usage.overview.top_usage_model", { model: topUsageModelName })}
                </span>
              ) : null}
              {hasMissingPricing ? (
                <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  {copy("usage.overview.missing_pricing_count", { count: missingPricingCount })}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </Card>
  );
}
