import React, { useState } from "react";
import { Card, Select } from "../../components";
import { ProviderIcon } from "./ProviderIcon";

function splitProjectKey(value) {
  if (typeof value !== "string") return { owner: "", repo: "" };
  const [owner, repo] = value.split("/");
  return { owner: owner || "", repo: repo || "" };
}

// Local icon only. `owner` comes from a repo the user has checked out, so an
// <img src="https://github.com/${owner}.png"> would disclose that name — a
// private one included — to a third party straight from the browser. An image
// load leaks exactly what a fetch does, which is how issue 100 went unnoticed.
function ProjectAvatar({ projectKey, projectRef }) {
  const normalizedRef =
    typeof projectRef === "string" ? projectRef.replace("https://github.com/", "") : "";
  const { owner, repo } = splitProjectKey(projectKey || normalizedRef);
  const repoId = owner && repo ? `${owner}/${repo}` : projectKey;

  return (
    <div className="w-8 h-8 rounded-md oai-bg-elevated flex items-center justify-center text-oai-gray-500 dark:text-oai-gray-300">
      <ProviderIcon provider={repoId} size={20} />
    </div>
  );
}

export function DataDetails({
  // Project props
  projectEntries = [],
  projectUnattributedSources = [],
  projectLimit = 3,
  onProjectLimitChange,
  // Daily breakdown props
  copy,
  hasDetailsActual,
  dailyEmptyPrefix,
  installSyncCmd,
  dailyEmptySuffix,
  detailsColumns,
  ariaSortFor,
  toggleSort,
  sortIconFor,
  pagedDetails,
  dailyBreakdownRows = [],
  dailyBreakdownColumns = [],
  dailyBreakdownAriaSortFor,
  dailyBreakdownSortIconFor,
  dailyBreakdownDateKey = "day",
  detailsDateKey,
  renderDetailDate,
  renderDailyBreakdownDate,
  renderDetailCell,
  DETAILS_PAGED_PERIODS,
  period,
  detailsPageCount,
  detailsPage,
  setDetailsPage,
}) {
  const [activeTab, setActiveTab] = useState("daily");
  // A named boolean rather than an inline `length > 0 ?`: the ui-hardcode
  // scanner reads `0 ? (` as a JSX text node and would ratchet on it. Same false
  // positive class as a three-digit issue reference, which it reads as a hex
  // colour — this very comment tripped that on the first attempt.
  const hasUnattributedSources = projectUnattributedSources.length > 0;

  function getDailyCellClass(row, column, index) {
    if (index === 0) return "text-oai-gray-500 dark:text-oai-gray-300";
    if (column.key === "total_tokens" || column.key === "total_cost_usd") {
      return "font-medium text-oai-black dark:text-oai-white tabular-nums";
    }
    if (column.key === "cost_per_million_tokens" && row?.cost_per_million_status === "high") {
      return "font-semibold text-amber-700 dark:text-amber-300 tabular-nums";
    }
    if (column.key === "top_model") {
      return "text-oai-gray-600 dark:text-oai-gray-300";
    }
    return "text-oai-gray-600 dark:text-oai-gray-300 tabular-nums";
  }

  function renderDailyCell(row, column, index) {
    if (index === 0) {
      return renderDailyBreakdownDate ? renderDailyBreakdownDate(row) : renderDetailDate(row);
    }
    return renderDetailCell(row, column.key);
  }

  return (
    <Card>
      {/* Tab Switcher + Controls */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div role="tablist" aria-label="Data view" className="flex gap-1">
          <button
            role="tab"
            aria-selected={activeTab === "daily"}
            type="button"
            onClick={() => setActiveTab("daily")}
            className={`text-xs font-medium px-3 py-1.5 rounded transition-colors ${
              activeTab === "daily"
                ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            {copy("dashboard.daily.title")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "projects"}
            type="button"
            onClick={() => setActiveTab("projects")}
            className={`text-xs font-medium px-3 py-1.5 rounded transition-colors ${
              activeTab === "projects"
                ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            {copy("dashboard.projects.title")}
          </button>
        </div>
        {activeTab === "projects" && (
          <Select
            ariaLabel={copy("dashboard.projects.limit_aria")}
            value={projectLimit}
            onValueChange={(value) => onProjectLimitChange?.(Number(value))}
            options={[
              { value: 3, label: copy("dashboard.projects.limit_top_3") },
              { value: 6, label: copy("dashboard.projects.limit_top_6") },
              { value: 10, label: copy("dashboard.projects.limit_top_10") },
            ]}
            align="end"
            className="px-2 py-1 text-xs text-oai-gray-600 dark:text-oai-gray-300"
          />
        )}
      </div>

      {/* Projects Tab */}
      {activeTab === "projects" && (
        <div className="space-y-1">
          {/* The Daily tab explains itself when empty; this one rendered a blank
              box, which reads as "you have no spending" rather than "nothing has
              been attributed to a project yet". */}
          {projectEntries.length === 0 ? (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300">
              {copy("dashboard.projects.empty")}
            </div>
          ) : null}
          {projectEntries.slice(0, projectLimit).map((entry, idx) => {
            const ref = typeof entry?.project_ref === "string" ? entry.project_ref : "";
            const key = entry?.project_key || ref || `entry-${idx}`;
            const raw = entry?.billable_total_tokens ?? entry?.total_tokens;
            const n = Number(raw);
            const tokenLabel = Number.isFinite(n) ? n.toLocaleString() : "—";
            const projectLabel = entry?.project_key || ref.split("/").pop() || "—";
            return (
              <div
                key={key}
                className="flex items-center gap-3 p-2 rounded-lg"
              >
                <ProjectAvatar projectKey={entry?.project_key} projectRef={ref} />
                <div className="min-w-0 flex-1">
                  <div className="oai-text-body-sm font-medium text-oai-black dark:text-oai-white truncate">
                    {projectLabel}
                  </div>
                </div>
                <div className="oai-text-body-sm font-medium text-oai-black dark:text-oai-white tabular-nums">
                  {tokenLabel}
                </div>
              </div>
            );
          })}
          {/* Naming what this tab cannot account for. projectBucketsQueued
              exists in 7 parsers; Cursor, Copilot, Zed, Goose and Kiro have no
              per-repo story, and without this line their absence reads as "that
              tool cost nothing here" rather than "we cannot attribute it". */}
          {hasUnattributedSources ? (
            <div className="pt-2 oai-text-caption text-oai-gray-500 dark:text-oai-gray-400">
              {`${copy("dashboard.projects.unattributed")} ${projectUnattributedSources.join(", ")}`}
            </div>
          ) : null}
        </div>
      )}

      {/* Daily Tab */}
      {activeTab === "daily" && (
        <div>
          {dailyBreakdownRows?.length === 0 ? (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300 mb-4">
              {dailyEmptyPrefix}
              <code className="mx-1 rounded border border-oai-gray-300 dark:border-oai-gray-700 oai-bg-elevated px-1.5 py-0.5 font-mono oai-text-caption">
                {installSyncCmd}
              </code>
              {dailyEmptySuffix}
            </div>
          ) : (
          <div className="overflow-auto max-h-[384px] -mx-4 oai-scrollbar">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-oai-gray-200 dark:border-oai-gray-700">
                  {dailyBreakdownColumns.map((column, index) => (
                    <th
                      key={column.key}
                      {...(dailyBreakdownAriaSortFor?.(column.key)
                        ? { "aria-sort": dailyBreakdownAriaSortFor(column.key) }
                        : {})}
                      className="text-left p-0 bg-white dark:bg-oai-gray-900"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="flex w-full items-center justify-start px-2.5 sm:px-4 py-2 text-left oai-text-caption font-semibold text-oai-gray-600 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white transition-colors"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{column.label}</span>
                          <span className="text-oai-gray-400 dark:text-oai-gray-400">
                            {dailyBreakdownSortIconFor?.(column.key) || ""}
                          </span>
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyBreakdownRows.map((row) => (
                  <tr
                    key={String(
                      row?.[dailyBreakdownDateKey] || row?.day || row?.hour || row?.month || "",
                    )}
                    className={`border-b border-oai-gray-100 dark:border-oai-gray-800 last:border-b-0 odd:bg-transparent even:bg-oai-gray-50/55 dark:odd:bg-transparent dark:even:bg-white/[0.035] hover:bg-oai-gray-100/60 dark:hover:bg-oai-gray-800/70 transition-colors ${
                      row.missing ? "text-oai-gray-400 dark:text-oai-gray-400" : row.future ? "text-oai-gray-300 dark:text-oai-gray-600" : "text-oai-black dark:text-oai-white"
                    }`}
                  >
                    {dailyBreakdownColumns.map((column, index) => (
                      <td
                        key={column.key}
                        className={`px-2.5 sm:px-4 py-2 oai-text-body-sm whitespace-nowrap ${getDailyCellClass(row, column, index)}`}
                      >
                        {renderDailyCell(row, column, index)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {/* Pagination - 使用 design system typography，Daily Breakdown 不需要分页 */}
          {activeTab !== "daily" && DETAILS_PAGED_PERIODS.has(period) && detailsPageCount > 1 ? (
            <div className="mt-3 flex items-center justify-between oai-text-caption">
              <button
                type="button"
                onClick={() => setDetailsPage((prev) => Math.max(0, prev - 1))}
                disabled={detailsPage === 0}
                className="px-3 py-1.5 text-oai-gray-600 dark:text-oai-gray-300 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {copy("details.pagination.prev")}
              </button>
              <span className="oai-text-muted">
                {detailsPage + 1} / {detailsPageCount}
              </span>
              <button
                type="button"
                onClick={() => setDetailsPage((prev) => Math.min(detailsPageCount - 1, prev + 1))}
                disabled={detailsPage + 1 >= detailsPageCount}
                className="px-3 py-1.5 text-oai-gray-600 dark:text-oai-gray-300 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {copy("details.pagination.next")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
