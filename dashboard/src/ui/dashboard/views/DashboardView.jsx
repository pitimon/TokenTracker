import React from "react";
import { Shell } from "../../components";
import { CostAnalysisModal } from "../components/CostAnalysisModal.jsx";
import { DataDetails } from "../components/DataDetails.jsx";
import { PlanValueCard } from "../components/PlanValueCard.jsx";
import { StatsPanel } from "../components/StatsPanel.jsx";
import { PulseCard } from "../components/PulseCard.jsx";
import { HeroSummary } from "../components/HeroSummary.jsx";
import { ProviderBreakdownCard } from "../components/ProviderBreakdownCard.jsx";
import { ContextCard } from "../components/ContextCard.jsx";
import { hasProviderModels, resolveContextBreakdownSource } from "../components/usageFormat.js";
import { TrendMonitor } from "../components/TrendMonitor.jsx";
import { FadeIn } from "../../foundation/FadeIn.jsx";
import { WidgetOnboardingCard } from "../components/WidgetOnboardingCard.jsx";

export function DashboardView(props) {

  const {
    copy,
    screenshotMode,
    screenshotTitleLine1,
    screenshotTitleLine2,
    identityDisplayName,
    identityStartDate,
    activeDays,
    identitySubscriptions,
    identityScrambleDurationMs,
    projectUsageEntries,
    planPrices = {},
    onPlanPriceChange,
    modelBreakdown = null,
    projectUnattributedSources = [],
    projectUsageLimit,
    setProjectUsageLimit,
    pulse,
    pulseComparedAtLabel,
    isLocalMode,
    trendRowsForDisplay,
    trendFromForDisplay,
    trendToForDisplay,
    trendZoomConfig,
    usageFrom,
    usageTo,
    period,
    trendTimeZoneLabel,
    activityHeatmapBlock,
    periodsForDisplay,
    setSelectedPeriod,
    autoRefreshOptions,
    autoRefreshIntervalMs,
    onAutoRefreshIntervalChange,
    customFrom,
    customTo,
    onCustomRangeApply,
    customRangeOpen,
    onCustomRangeOpenChange,
    summaryLabel,
    summaryValue,
    summaryUpdatedAtLabel,
    summaryCostValue,
    usageInsights,
    costInfoEnabled,
    openCostModal,
    costModalOpen,
    closeCostModal,
    allowBreakdownToggle,
    refreshAll,
    usageLoadingState,
    dataHealthMessage,
    fleetData,
    usageLimits,
    limitDisplayMode,
    hasDetailsActual,
    dailyEmptyPrefix,
    installSyncCmd,
    dailyEmptySuffix,
    detailsColumns,
    ariaSortFor,
    toggleSort,
    sortIconFor,
    pagedDetails,
    dailyBreakdownRows,
    dailyBreakdownColumns,
    dailyBreakdownAriaSortFor,
    dailyBreakdownSortIconFor,
    dailyBreakdownDateKey,
    detailsDateKey,
    renderDetailDate,
    renderDailyBreakdownDate,
    renderDetailCell,
    DETAILS_PAGED_PERIODS,
    detailsPageCount,
    detailsPage,
    setDetailsPage,
  } = props;

  // Header 和 Footer 已简化
  const header = null;
  const footer = null;

  // Only reserve a bento cell for the Context card when a provider actually
  // qualifies (claude/codex) — otherwise let TrendMonitor take the full row
  // instead of leaving an empty column beside it.
  const hasContextSource =
    Array.isArray(fleetData) &&
    fleetData.some(
      (p) => hasProviderModels(p) && resolveContextBreakdownSource(p) !== null
    );

  return (
    <>
      <Shell
        bare={!screenshotMode}
        hideHeader={screenshotMode}
        header={header}
        footer={!screenshotMode ? footer : null}
        className={screenshotMode ? "screenshot-mode" : ""}
      >
        {screenshotMode ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-3xl md:text-4xl font-semibold text-oai-black dark:text-oai-white tracking-tight leading-none">
                  {screenshotTitleLine1}
                </span>
                <span className="text-2xl md:text-3xl font-semibold text-oai-black dark:text-oai-white tracking-tight leading-none">
                  {screenshotTitleLine2}
                </span>
              </div>
            </div>

            <HeroSummary
              period={period}
              periods={periodsForDisplay}
              onPeriodChange={setSelectedPeriod}
              autoRefreshOptions={autoRefreshOptions}
              autoRefreshIntervalMs={autoRefreshIntervalMs}
              onAutoRefreshIntervalChange={onAutoRefreshIntervalChange}
              summaryLabel={summaryLabel}
              summaryValue={summaryValue}
              summaryUpdatedAtLabel={summaryUpdatedAtLabel}
              summaryCostValue={summaryCostValue}
              usageInsights={usageInsights}
              onCostInfo={costInfoEnabled ? openCostModal : null}
              onRefresh={screenshotMode ? null : refreshAll}
              loading={usageLoadingState}
              customFrom={customFrom}
              customTo={customTo}
              onCustomRangeApply={onCustomRangeApply}
              customRangeOpen={customRangeOpen}
              onCustomRangeOpenChange={onCustomRangeOpenChange}
            />

            <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
              <div className="lg:col-span-2 min-w-0">
                <StatsPanel
                  rankLabel={identityStartDate ?? copy("identity_card.rank_placeholder")}
                  streakDays={activeDays}
                  subscriptions={identitySubscriptions}
                />
              </div>
              {activityHeatmapBlock ? (
                <div className="lg:col-span-4 min-w-0">{activityHeatmapBlock}</div>
              ) : null}
              <div className="lg:col-span-6 min-w-0">
                <ProviderBreakdownCard
                  fleetData={fleetData}
                  from={usageFrom}
                  to={usageTo}
                  usageLimits={usageLimits}
                  limitDisplayMode={limitDisplayMode}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {dataHealthMessage ? (
              <FadeIn delay={0.08}>
                <div className="rounded-lg border border-oai-gray-200 bg-oai-gray-50 px-4 py-3 text-sm text-oai-gray-700 dark:border-oai-gray-800 dark:bg-oai-gray-900/70 dark:text-oai-gray-300">
                  {dataHealthMessage}
                </div>
              </FadeIn>
            ) : null}

            {/* Layout v2: Hero + Trend share the top row (3:3) so the summary
                and its time series read together. Identity is a left rail; when
                a context source exists it spans two rows so Provider stacks
                directly above Context (cols 3-6), reading "which providers →
                their context" top-down. Heatmap, onboarding, then details span
                the full width below. */}
            <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
              <div className="lg:col-span-3 min-w-0">
                <FadeIn delay={0.05} className="h-full">
                  <HeroSummary
                    period={period}
                    periods={periodsForDisplay}
                    onPeriodChange={setSelectedPeriod}
                    autoRefreshOptions={autoRefreshOptions}
                    autoRefreshIntervalMs={autoRefreshIntervalMs}
                    onAutoRefreshIntervalChange={onAutoRefreshIntervalChange}
                    summaryLabel={summaryLabel}
                    summaryValue={summaryValue}
                    summaryUpdatedAtLabel={summaryUpdatedAtLabel}
                    summaryCostValue={summaryCostValue}
                    usageInsights={usageInsights}
                    onCostInfo={costInfoEnabled ? openCostModal : null}
                    onRefresh={screenshotMode ? null : refreshAll}
                    loading={usageLoadingState}
                    customFrom={customFrom}
                    customTo={customTo}
                    onCustomRangeApply={onCustomRangeApply}
                    customRangeOpen={customRangeOpen}
                    onCustomRangeOpenChange={onCustomRangeOpenChange}
                    emphasized
                  />
                </FadeIn>
              </div>

              <div className="lg:col-span-3 min-w-0">
                <FadeIn delay={0.09}>
                  <TrendMonitor
                    rows={trendRowsForDisplay}
                    from={trendFromForDisplay}
                    to={trendToForDisplay}
                    period={period}
                    timeZoneLabel={trendTimeZoneLabel}
                    showTimeZoneLabel={false}
                    zoomConfig={trendZoomConfig}
                  />
                </FadeIn>
              </div>

              <div className="lg:col-span-2 min-w-0">
                <FadeIn delay={0.13}>
                  <div className="flex flex-col gap-4">
                    <PulseCard
                      pulse={pulse}
                      period={period}
                      comparedAtLabel={pulseComparedAtLabel}
                    />
                    <StatsPanel
                      rankLabel={identityStartDate ?? copy("identity_card.rank_placeholder")}
                      streakDays={activeDays}
                      subscriptions={identitySubscriptions}
                    />
                  </div>
                </FadeIn>
              </div>

              <div className="lg:col-span-4 min-w-0">
                <FadeIn delay={0.19}>
                  {/* Context now lives in the standalone ContextCard below, so
                      suppress the drill-down's inline Context Breakdown to avoid
                      rendering the same panel (and refetching it) twice. */}
                  <ProviderBreakdownCard
                    fleetData={fleetData}
                    from={usageFrom}
                    to={usageTo}
                    showInlineContext={false}
                    usageLimits={usageLimits}
                    limitDisplayMode={limitDisplayMode}
                  />
                </FadeIn>
              </div>

              {/* Activity Heatmap and Context Breakdown share the third row:
                  Heatmap at cols 1-2, Context at cols 3-6. Each falls back to
                  full width when the other is absent so the row never leaves a
                  gap. */}
              {activityHeatmapBlock ? (
                <div className={hasContextSource ? "lg:col-span-2 min-w-0" : "lg:col-span-6 min-w-0"}>
                  <FadeIn delay={0.25}>{activityHeatmapBlock}</FadeIn>
                </div>
              ) : null}

              {hasContextSource ? (
                <div className={activityHeatmapBlock ? "lg:col-span-4 min-w-0" : "lg:col-span-6 min-w-0"}>
                  <FadeIn delay={0.31}>
                    <ContextCard fleetData={fleetData} from={usageFrom} to={usageTo} />
                  </FadeIn>
                </div>
              ) : null}

              {isLocalMode ? (
                <div className="lg:col-span-6">
                  <WidgetOnboardingCard enterDelay={0.37} />
                </div>
              ) : null}
            </div>

            <FadeIn delay={0.42}>
              <PlanValueCard
                sources={modelBreakdown?.sources}
                planPrices={planPrices}
                onPlanPriceChange={onPlanPriceChange}
                copy={copy}
                className="oai-card p-4"
              />
            </FadeIn>

            <FadeIn delay={0.43}>
              <DataDetails
                projectEntries={projectUsageEntries}
                projectUnattributedSources={projectUnattributedSources}
                projectLimit={projectUsageLimit}
                onProjectLimitChange={setProjectUsageLimit}
                copy={copy}
                hasDetailsActual={hasDetailsActual}
                dailyEmptyPrefix={dailyEmptyPrefix}
                installSyncCmd={installSyncCmd}
                dailyEmptySuffix={dailyEmptySuffix}
                detailsColumns={detailsColumns}
                ariaSortFor={ariaSortFor}
                toggleSort={toggleSort}
                sortIconFor={sortIconFor}
                pagedDetails={pagedDetails}
                dailyBreakdownRows={dailyBreakdownRows}
                dailyBreakdownColumns={dailyBreakdownColumns}
                dailyBreakdownAriaSortFor={dailyBreakdownAriaSortFor}
                dailyBreakdownSortIconFor={dailyBreakdownSortIconFor}
                dailyBreakdownDateKey={dailyBreakdownDateKey}
                detailsDateKey={detailsDateKey}
                renderDetailDate={renderDetailDate}
                renderDailyBreakdownDate={renderDailyBreakdownDate}
                renderDetailCell={renderDetailCell}
                DETAILS_PAGED_PERIODS={DETAILS_PAGED_PERIODS}
                period={period}
                detailsPageCount={detailsPageCount}
                detailsPage={detailsPage}
                setDetailsPage={setDetailsPage}
              />
            </FadeIn>
          </div>
        )}
      </Shell>
      <CostAnalysisModal isOpen={costModalOpen} onClose={closeCostModal} fleetData={fleetData} />
    </>
  );
}
