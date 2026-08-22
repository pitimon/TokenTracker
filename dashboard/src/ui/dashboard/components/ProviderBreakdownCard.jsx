import React, { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Card } from "../../components";
import { useCurrency } from "../../../hooks/useCurrency.js";
import { copy } from "../../../lib/copy";
import { getCurrencySymbol } from "../../../lib/currency";
import { ProviderIcon } from "./ProviderIcon.jsx";
import { ContextBreakdownPanel } from "./ContextBreakdownPanel.jsx";
import { LimitChips } from "./limitDisplay.jsx";
import {
  formatTokens,
  formatCost,
  formatModelName,
  getProviderColor,
  resolveContextBreakdownSource,
  hasProviderModels,
  getModelShareWidth,
  isSameModel,
  getVisibleModels,
  getHiddenModelCount,
} from "./usageFormat.js";

export function ProviderBreakdownCard({ fleetData = [], from, to, showInlineContext = true, usageLimits = null, limitDisplayMode }) {
  const shouldReduceMotion = useReducedMotion();
  const [expandedProvider, setExpandedProvider] = useState(null);
  const { currency, rate } = useCurrency();

  // FleetData is already grouped by provider
  const providers = fleetData.filter(hasProviderModels);

  if (providers.length === 0) return null;

  return (
    <Card>
        {/* Provider Distribution */}
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

            {/* Provider Cards — auto-fit so the cards always fill the row width
                regardless of how many providers are in use (a fixed 5-col grid
                left ~60% of the row empty when only 1-2 providers were active).
                minmax keeps each card readable; equal 1fr tracks avoid a
                stretched final row. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              {providers.map((provider, idx) => {
                const color = getProviderColor(provider.label, idx);
                const isExpanded = expandedProvider === provider.label;
                const providerMissingPricingCount = provider.missingPricingModels?.length || 0;
                const hasProviderMissingPricing = Boolean(providerMissingPricingCount);
                const providerFuzzyPricingCount = provider.fuzzyPricingModels?.length || 0;
                const hasProviderFuzzyPricing = Boolean(providerFuzzyPricingCount);
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
                    <LimitChips
                      label={provider.label}
                      usageLimits={usageLimits}
                      mode={limitDisplayMode}
                    />
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
                    {hasProviderFuzzyPricing ? (
                      <div className="mt-1.5 truncate text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        {copy("usage.overview.provider_fuzzy_pricing", {
                          count: providerFuzzyPricingCount,
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

                    // Only badge the section as a Context Breakdown when the
                    // inline panel is actually shown here; otherwise the context
                    // lives in the standalone ContextCard and this is just the
                    // provider's model drill-down.
                    const showContextHere = Boolean(contextSource) && showInlineContext;
                    const providerHeading = showContextHere
                      ? `${contextSource === "claude" ? "Claude" : "Codex"} Context Breakdown`
                      : provider.label;
                    return (
                      <ProviderExpandedSection
                        key={provider.label}
                        provider={provider}
                        color={color}
                        providerHeading={providerHeading}
                        contextSource={showContextHere ? contextSource : null}
                        from={from}
                        to={to}
                        sortedModels={sortedModels}
                      />
                    );
                  })}
              </div>
            )}

        </div>
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
