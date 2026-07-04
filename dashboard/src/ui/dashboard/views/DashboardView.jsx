import React from "react";
import { Shell, Button } from "../../components";
import { CostAnalysisModal } from "../components/CostAnalysisModal.jsx";
import { DataDetails } from "../components/DataDetails.jsx";
import { StatsPanel } from "../components/StatsPanel.jsx";
import { HeroSummary } from "../components/HeroSummary.jsx";
import { ProviderBreakdownCard } from "../components/ProviderBreakdownCard.jsx";
import { TrendMonitor } from "../components/TrendMonitor.jsx";
import { FadeIn } from "../../foundation/FadeIn.jsx";
import { WidgetOnboardingCard } from "../components/WidgetOnboardingCard.jsx";

export function DashboardView(props) {

  const {
    copy,
    onOpenShare,
    screenshotMode,
    screenshotTitleLine1,
    screenshotTitleLine2,
    identityDisplayName,
    identityStartDate,
    activeDays,
    identitySubscriptions,
    identityScrambleDurationMs,
    projectUsageEntries,
    projectUsageLimit,
    setProjectUsageLimit,
    topModels,
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
    isCapturing,
    handleShareToX,
    screenshotTwitterButton,
    screenshotTwitterHint,
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
    summaryConversationsValue,
    rollingUsage,
    costInfoEnabled,
    openCostModal,
    costModalOpen,
    closeCostModal,
    allowBreakdownToggle,
    refreshAll,
    usageLoadingState,
    dataHealthMessage,
    fleetData,
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
              onOpenShare={screenshotMode ? null : onOpenShare}
              customFrom={customFrom}
              customTo={customTo}
              onCustomRangeApply={onCustomRangeApply}
              customRangeOpen={customRangeOpen}
              onCustomRangeOpenChange={onCustomRangeOpenChange}
            />

            <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
              <div className="lg:col-span-2 min-w-0">
                <StatsPanel
                  title={copy("dashboard.identity.title")}
                  subtitle={copy("dashboard.identity.subtitle")}
                  period={period}
                  rankLabel={identityStartDate ?? copy("identity_card.rank_placeholder")}
                  streakDays={activeDays}
                  subscriptions={identitySubscriptions}
                  periodConversations={summaryConversationsValue}
                  rolling={rollingUsage}
                  topModels={topModels}
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
                />
              </div>
            </div>

            <div
              className="flex flex-col items-center gap-2"
              data-screenshot-exclude="true"
              style={isCapturing ? { display: "none" } : undefined}
            >
              <Button
                type="button"
                onClick={handleShareToX}
                variant="primary"
                size="lg"
                disabled={isCapturing}
              >
                {screenshotTwitterButton}
              </Button>
              <span className="text-sm text-oai-gray-500 dark:text-oai-gray-300">
                {screenshotTwitterHint}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <FadeIn delay={0.05}>
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
                onOpenShare={screenshotMode ? null : onOpenShare}
                customFrom={customFrom}
                customTo={customTo}
                onCustomRangeApply={onCustomRangeApply}
                customRangeOpen={customRangeOpen}
                onCustomRangeOpenChange={onCustomRangeOpenChange}
              />
            </FadeIn>

            {dataHealthMessage ? (
              <FadeIn delay={0.08}>
                <div className="rounded-lg border border-oai-gray-200 bg-oai-gray-50 px-4 py-3 text-sm text-oai-gray-700 dark:border-oai-gray-800 dark:bg-oai-gray-900/70 dark:text-oai-gray-300">
                  {dataHealthMessage}
                </div>
              </FadeIn>
            ) : null}

            <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
              <div className="lg:col-span-2 min-w-0">
                <FadeIn delay={0.11}>
                  <StatsPanel
                    title={copy("dashboard.identity.title")}
                    subtitle={copy("dashboard.identity.subtitle")}
                    period={period}
                    rankLabel={identityStartDate ?? copy("identity_card.rank_placeholder")}
                    streakDays={activeDays}
                    subscriptions={identitySubscriptions}
                    periodConversations={summaryConversationsValue}
                    rolling={rollingUsage}
                    topModels={topModels}
                  />
                </FadeIn>
              </div>

              {activityHeatmapBlock ? (
                <div className="lg:col-span-4 min-w-0">
                  <FadeIn delay={0.17}>{activityHeatmapBlock}</FadeIn>
                </div>
              ) : null}

              <div className="lg:col-span-6 min-w-0">
                <FadeIn delay={0.23}>
                  <ProviderBreakdownCard
                    fleetData={fleetData}
                    from={usageFrom}
                    to={usageTo}
                  />
                </FadeIn>
              </div>

              <div className="lg:col-span-6 min-w-0">
                <FadeIn delay={0.29}>
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

              {isLocalMode ? (
                <div className="lg:col-span-6">
                  <WidgetOnboardingCard enterDelay={0.35} />
                </div>
              ) : null}
            </div>

            <FadeIn delay={0.41}>
              <DataDetails
                projectEntries={projectUsageEntries}
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
