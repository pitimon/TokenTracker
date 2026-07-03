import React, { useState, useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Info, Loader2, SquareArrowOutUpRight } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Card, Button, Counter } from "../../components";
import { useTheme } from "../../../hooks/useTheme.js";
import { useCurrency } from "../../../hooks/useCurrency.js";
import { copy, getCopyLocale } from "../../../lib/copy";
import { CURRENCY_USD, getCurrencySymbol } from "../../../lib/currency";
import { DateRangePopover, formatDateShort, getDateFnsLocale } from "./DateRangePopover.jsx";
import { ProviderIcon } from "./ProviderIcon.jsx";
import { formatCompactNumber, formatUsdCurrency } from "../../../lib/format";
import { ContextBreakdownPanel } from "./ContextBreakdownPanel.jsx";

function formatTokens(value) {
  if (!Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n <= 0) return null;
  return formatCompactNumber(n, { decimals: 1 });
}

function formatCost(value, currency, rate) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const symbol = getCurrencySymbol(currency);
  const converted = currency === CURRENCY_USD ? n : n * rate;
  if (converted < 0.01) return `<${symbol}0.01`;
  return formatUsdCurrency(n, { decimals: 2, currency, rate });
}

function formatCostPerMillion(value, currency, rate) {
  const label = formatCost(value, currency, rate);
  return label ? `${label}/MTok` : null;
}

function formatModelName(value) {
  if (!value) return "";
  return String(value).replace(/^claude-/, "").replace(/^gpt-/, "gpt-");
}

function normalizePeriods(periods) {
  if (!Array.isArray(periods)) return [];
  return periods.map((p) => {
    if (typeof p === "string") {
      return { key: p, label: getPeriodLabel(p) };
    }
    return { key: p.key, label: p.label || getPeriodLabel(p.key) };
  });
}

function parseAnimatedCounterValue(displayValue) {
  if (typeof displayValue !== "string") return null;
  const match = displayValue.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

// Provider color mapping for visual distinction
const PROVIDER_COLORS = {
  CODEX: "#3b82f6",     // blue-500
  CLAUDE: "#d97757",    // Anthropic Japonica orange-red
  OPENCODE: "#f59e0b",  // amber-500
  GEMINI: "#2196f3",    // Google Gemini bright blue
  KIMI: "#a78bfa",      // violet-400
  "KILO-CLI": "#facc15",   // yellow-400 (Kilo brand yellow)
  "KILO-CODE": "#facc15",
  DROID: "#ef4444",        // red-500 (Factory brand)
};

function getProviderColor(label, index) {
  const normalized = label?.toUpperCase?.() || "";
  return PROVIDER_COLORS[normalized] || `hsl(${150 + index * 40}, 60%, 45%)`;
}

function resolveContextBreakdownSource(provider) {
  const source = String(provider?.source || "").trim().toLowerCase();
  const label = String(provider?.label || "").trim().toLowerCase();
  if (source === "claude" || label === "claude") return "claude";
  if (source === "codex" || label === "codex") return "codex";
  return null;
}

function hasProviderModels(provider) {
  return Boolean(provider?.models?.length);
}

function getModelShareWidth(share) {
  const value = Number(share);
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${Math.min(100, Math.max(2, value))}%`;
}

function isSameModel(left, right) {
  const leftKey = String(left?.id || left?.name || "").trim().toLowerCase();
  const rightKey = String(right?.id || right?.name || "").trim().toLowerCase();
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function getVisibleModels(provider, limit = 3) {
  return [...(provider?.models || [])]
    .sort((a, b) => (Number(b.share) || 0) - (Number(a.share) || 0))
    .slice(0, limit);
}

function getHiddenModelCount(provider, visibleModels) {
  return Math.max(0, (provider?.models?.length || 0) - visibleModels.length);
}

const PERIOD_COPY_KEYS = {
  day: "usage.period.day",
  "24h": "usage.period.last24h",
  week: "usage.period.week",
  month: "usage.period.month",
  total: "usage.period.total",
  custom: "usage.period.custom",
};

function getPeriodLabel(key) {
  const copyKey = PERIOD_COPY_KEYS[key];
  return copyKey ? copy(copyKey) : String(key).toUpperCase();
}

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

export function UsageOverview({
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
  fleetData = [],
  onRefresh,
  loading,
  className = "",
  customFrom,
  customTo,
  onCustomRangeApply,
  customRangeOpen,
  onCustomRangeOpenChange,
  onOpenShare,
  from,
  to,
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
  const [expandedProvider, setExpandedProvider] = useState(null);
  const { resolvedTheme } = useTheme();
  const { currency, rate } = useCurrency();
  const isDark = resolvedTheme === "dark";
  const gradientFrom = isDark ? "rgba(10,10,10,0.98)" : "rgba(255,255,255,0.96)";
  const gradientTo = isDark ? "rgba(10,10,10,0)" : "rgba(255,255,255,0)";

  // FleetData is already grouped by provider
  const providers = fleetData.filter(hasProviderModels);
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
    <Card className={className}>
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
                gradientHeight={isDark ? 0 : 8}
                gradientFrom={gradientFrom}
                gradientTo={gradientTo}
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

        {/* Provider Distribution */}
        {providers.length > 0 && (
          <div className="space-y-6">
            {/* Distribution Bar */}
            <div
              role="img"
              aria-label={copy("usage.overview.distribution_aria", {
                items: providers
                  .map((provider) =>
                    copy("usage.overview.distribution_item", {
                      label: provider.label,
                      percent: provider.totalPercent,
                    }),
                  )
                  .join("，"),
              })}
              className="h-1.5 w-full bg-oai-gray-100 dark:bg-oai-gray-800 rounded-full overflow-hidden flex"
            >
              {providers.map((provider, idx) => {
                const color = getProviderColor(provider.label, idx);
                return (
                  <motion.div
                    key={provider.label}
                    initial={{ width: 0 }}
                    animate={{ width: `${provider.totalPercent}%` }}
                    transition={{ duration: 0.5, delay: 0.45 + idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full"
                    style={{ backgroundColor: color }}
                    title={`${provider.label}: ${provider.totalPercent}%`}
                  />
                );
              })}
            </div>

            {/* Provider Cards — responsive grid keeps cells equal-width so the
                last row never stretches when the count doesn't divide evenly. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              {providers.map((provider, idx) => {
                const color = getProviderColor(provider.label, idx);
                const isExpanded = expandedProvider === provider.label;
                const providerMissingPricingCount = provider.missingPricingModels?.length || 0;
                const hasProviderMissingPricing = Boolean(providerMissingPricingCount);
                const visibleModels = getVisibleModels(provider);
                const hiddenModelCount = getHiddenModelCount(provider, visibleModels);

                return (
                  <button
                    key={provider.label}
                    aria-expanded={isExpanded}
                    aria-controls={`provider-details-${provider.label}`}
                    aria-label={copy("usage.overview.provider_card_aria", {
                      provider: provider.label,
                      percent: provider.totalPercent,
                      tokens: formatTokens(provider.usage) || "0",
                      cost: formatCost(provider.usd, currency, rate) || `${getCurrencySymbol(currency)}0`,
                      action: copy(isExpanded ? "usage.overview.collapse" : "usage.overview.expand"),
                    })}
                    onClick={() => setExpandedProvider(isExpanded ? null : provider.label)}
                    className={`min-w-0 text-left p-3 rounded-lg border transition-colors duration-200 ${
                      isExpanded
                        ? "border-oai-gray-300 dark:border-oai-gray-600 bg-oai-gray-50 dark:bg-oai-gray-800"
                        : "border-oai-gray-200 dark:border-oai-gray-700 hover:border-oai-gray-300 dark:hover:border-oai-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <ProviderIcon provider={provider.label} size={15} color={color} className="text-oai-gray-700 dark:text-oai-gray-300 shrink-0" />
                      <span className="text-sm font-medium text-oai-black dark:text-oai-white">{provider.label}</span>
                    </div>
                    <div className="text-lg font-semibold text-oai-black dark:text-oai-white tabular-nums">
                      {provider.totalPercent}%
                    </div>
                    <div className="mt-0.5 text-[11px] text-oai-gray-400 dark:text-oai-gray-400 tabular-nums">
                      {copy("usage.overview.model_count", { count: provider.models.length })}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {visibleModels.map((model) => {
                        const isTopCost = isSameModel(model, provider.topCostModel);
                        return (
                          <div key={model.id || model.name} className="min-w-0">
                            <div className="flex min-w-0 items-center justify-between gap-2 text-[10px] font-medium">
                              <span
                                className={`truncate ${
                                  isTopCost
                                    ? "text-oai-black dark:text-oai-white"
                                    : "text-oai-gray-600 dark:text-oai-gray-300"
                                }`}
                                title={model.name}
                              >
                                {formatModelName(model.name)}
                              </span>
                              <span className="shrink-0 text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
                                {copy("usage.overview.model_percent", { percent: model.share })}
                              </span>
                            </div>
                            <div
                              role="progressbar"
                              aria-label={copy("usage.overview.model_chip", {
                                model: formatModelName(model.name),
                                percent: model.share,
                              })}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Number(model.share) || 0}
                              className="mt-1 h-1.5 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800"
                            >
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: getModelShareWidth(model.share) }}
                                transition={{
                                  duration: shouldReduceMotion ? 0 : 0.45,
                                  delay: shouldReduceMotion ? 0 : 0.05,
                                  ease: [0.16, 1, 0.3, 1],
                                }}
                                className="h-full rounded-full"
                                style={{ backgroundColor: isTopCost ? color : `${color}99` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {Boolean(hiddenModelCount) && (
                        <div className="text-[10px] font-medium text-oai-gray-400 dark:text-oai-gray-500">
                          {copy("usage.overview.model_more", { count: hiddenModelCount })}
                        </div>
                      )}
                    </div>
                    {provider.topCostModel?.name ? (
                      <div className="mt-1.5 truncate text-[10px] font-medium text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("usage.overview.provider_top_cost", {
                          model: formatModelName(provider.topCostModel.name),
                        })}
                      </div>
                    ) : null}
                    {hasProviderMissingPricing ? (
                      <div className="mt-1.5 truncate text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        {copy("usage.overview.provider_missing_pricing", {
                          count: providerMissingPricingCount,
                        })}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Expanded Provider Details */}
            {expandedProvider && (
              <div
                id={`provider-details-${expandedProvider}`}
                role="region"
                aria-label={copy("usage.overview.model_details_aria", {
                  provider: expandedProvider,
                })}
                className="mt-2"
              >
                {providers
                  .filter((p) => p.label === expandedProvider)
                  .map((provider) => {
                    const color = getProviderColor(provider.label, 0);
                    const contextSource = resolveContextBreakdownSource(provider);
                    const sortedModels = [...provider.models].sort(
                      (a, b) => (b.share || 0) - (a.share || 0)
                    );

                    const providerHeading = contextSource
                      ? `${contextSource === "claude" ? "Claude" : "Codex"} Context Breakdown`
                      : provider.label;
                    return (
                      <ProviderExpandedSection
                        key={provider.label}
                        provider={provider}
                        color={color}
                        providerHeading={providerHeading}
                        contextSource={contextSource}
                        from={from}
                        to={to}
                        sortedModels={sortedModels}
                      />
                    );
                  })}
              </div>
            )}

          </div>
        )}
      </Card>
  );
}

// Renders a single expanded provider section. Hosts loading state for the
// inline Context Breakdown so the spinner can sit next to the heading instead
// of taking its own row.
function ProviderExpandedSection({ provider, color, providerHeading, contextSource, from, to, sortedModels }) {
  const { currency, rate } = useCurrency();
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const isAntigravity =
    String(provider?.source || provider?.label || "").trim().toLowerCase() === "antigravity";

  return (
                      <div>
                        {/* Section header — provider identity. When the provider supports
                            Context Breakdown we replace the bare label with the panel title
                            so we don't render a redundant double heading. The panel's
                            loading spinner sits inline at the right of the heading. */}
                        <div className="flex items-center gap-1.5 mb-3">
                          <ProviderIcon provider={provider.label} size={14} color={color} className="shrink-0" />
                          <span className="text-sm font-medium text-oai-black dark:text-oai-white">{providerHeading}</span>
                          {contextSource && breakdownLoading && (
                            <Loader2
                              size={12}
                              className="text-oai-gray-400 dark:text-oai-gray-500 animate-spin shrink-0"
                              aria-label={copy("dashboard.context_breakdown.loading_aria")}
                            />
                          )}
                        </div>

                        {/* Antigravity transcripts carry no usage field — every token
                            here is a 4-char/token estimate that ignores Gemini prompt
                            caching. Inline footnote, same muted style as the Context
                            Breakdown footnote. */}
                        {isAntigravity && (
                          <p className="mb-3 text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
                            <span className="font-medium text-oai-gray-500 dark:text-oai-gray-400">
                              {copy("usage.overview.antigravity_notice_title")}.
                            </span>{" "}
                            {copy("usage.overview.antigravity_notice_body")}
                          </p>
                        )}

                        {/* Context Breakdown drill-down.
                            Claude: category-based (approx /context).
                            Codex: tool-oriented breakdown. */}
                        {contextSource ? (
                          <div className="mb-4 pb-4 border-b border-oai-gray-200 dark:border-oai-gray-700">
                            <ContextBreakdownPanel
                              from={from}
                              to={to}
                              source={contextSource}
                              referenceTotalTokens={provider.usage}
                              onLoadingChange={setBreakdownLoading}
                            />
                          </div>
                        ) : null}

                        {/* Model rows — text line + thin muted bar as visual rhythm */}
                        <div className="space-y-3">
                          {sortedModels.map((model) => {
                            const tokensLabel = formatTokens(model.usage);
                            const costLabel = formatCost(model.cost, currency, rate);
                            const clampedShare = Math.max(0, Math.min(100, Number(model.share) || 0));
                            return (
                              <div key={model.id || model.name}>
                                <div className="flex items-baseline gap-4 mb-1.5">
                                  <span
                                    className="flex-1 min-w-0 text-sm text-oai-gray-700 dark:text-oai-gray-300 truncate"
                                    title={model.name}
                                  >
                                    {model.name}
                                  </span>
                                  <span className="shrink-0 w-16 text-right text-sm text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
                                    {tokensLabel}
                                  </span>
                                  <span className="shrink-0 w-16 text-right text-sm text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
                                    {costLabel}
                                  </span>
                                  <span className="shrink-0 w-12 text-right text-sm text-oai-black dark:text-oai-white tabular-nums">
                                    {model.share}%
                                  </span>
                                </div>
                                <div
                                  className="h-[3px] bg-oai-gray-100 dark:bg-oai-gray-800 rounded-full overflow-hidden"
                                  role="progressbar"
                                  aria-valuenow={clampedShare}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                >
                                  <div
                                    className="h-full transition-[width] duration-500 ease-out"
                                    style={{
                                      width: `${clampedShare}%`,
                                      backgroundColor: color,
                                      opacity: 0.45,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
  );
}
