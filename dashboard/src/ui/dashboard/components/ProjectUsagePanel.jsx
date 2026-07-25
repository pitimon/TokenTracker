import React, { useMemo } from "react";

import { Select } from "../../components";
import { copy } from "../../../lib/copy";
import { formatCompactNumber, toDisplayNumber, toFiniteNumber } from "../../../lib/format";
import { ProviderIcon } from "./ProviderIcon";

const LIMIT_OPTIONS = [3, 6, 10];
const DEFAULT_LIMIT = 10;
function splitRepoKey(value) {
  if (typeof value !== "string") return { owner: "", repo: "" };
  const [owner, repo] = value.split("/");
  return { owner: owner || "", repo: repo || "" };
}

function resolveTokens(entry) {
  if (!entry) return null;
  const total = entry.total_tokens ?? null;
  const billable = entry.billable_total_tokens ?? null;
  const billableValue = toFiniteNumber(billable);
  const totalValue = toFiniteNumber(total);
  if (billableValue === 0 && totalValue != null && totalValue > 0) {
    return total;
  }
  return billable ?? total ?? null;
}


export function ProjectUsagePanel({
  entries = [],
  limit = DEFAULT_LIMIT,
  onLimitChange,
  loading = false,
  error = null,
  className = "",
}) {
  const placeholder = copy("shared.placeholder.short");
  const tokensLabel = copy("dashboard.projects.tokens_label");
  const emptyLabel = copy("dashboard.projects.empty");
  const limitLabel = copy("dashboard.projects.limit_label");
  const limitAria = copy("dashboard.projects.limit_aria");
  const optionLabels = {
    3: copy("dashboard.projects.limit_top_3"),
    6: copy("dashboard.projects.limit_top_6"),
    10: copy("dashboard.projects.limit_top_10"),
  };
  const resolvedLimit = LIMIT_OPTIONS.includes(limit) ? limit : DEFAULT_LIMIT;

  const sortedEntries = useMemo(() => {
    const list = Array.isArray(entries) ? entries.slice() : [];
    return list.sort((a, b) => {
      const aValue = toFiniteNumber(resolveTokens(a)) ?? 0;
      const bValue = toFiniteNumber(resolveTokens(b)) ?? 0;
      return bValue - aValue;
    });
  }, [entries]);

  const displayEntries = sortedEntries.slice(0, Math.max(1, resolvedLimit));

  const tokenFormatOptions = {
    thousandSuffix: copy("shared.unit.thousand_abbrev"),
    millionSuffix: copy("shared.unit.million_abbrev"),
    billionSuffix: copy("shared.unit.billion_abbrev"),
    decimals: 1,
  };

  return (
    <div className={`rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">
          {copy("dashboard.projects.title")}
        </h3>
        <Select
          value={resolvedLimit}
          onValueChange={(value) => {
            if (typeof onLimitChange === "function" && value != null) {
              onLimitChange(value);
            }
          }}
          options={LIMIT_OPTIONS.map((value) => ({ value, label: optionLabels[value] }))}
          ariaLabel={limitAria}
          align="end"
          className="px-2 py-1 text-xs text-oai-gray-600 dark:text-oai-gray-300"
        />
      </div>

      {displayEntries.length === 0 ? (
        <div className="text-sm text-oai-gray-400 dark:text-oai-gray-400">{emptyLabel}</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {displayEntries.map((entry) => (
            <ProjectUsageCard
              key={`${entry?.project_key || "repo"}-${entry?.project_ref || ""}`}
              entry={entry}
              placeholder={placeholder}
              tokensLabel={tokensLabel}
              tokenFormatOptions={tokenFormatOptions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectUsageCard({
  entry,
  placeholder,
  tokensLabel,
  tokenFormatOptions,
}) {
  const repoKey = typeof entry?.project_key === "string" ? entry.project_key : "";
  const projectRef = typeof entry?.project_ref === "string" ? entry.project_ref : "";
  const { repo } = splitRepoKey(
    repoKey || projectRef.replace("https://github.com/", "")
  );
  const tokensRaw = resolveTokens(entry);
  const tokensFull =
    tokensRaw == null ? placeholder : toDisplayNumber(tokensRaw);
  const tokensCompact =
    tokensRaw == null
      ? placeholder
      : formatCompactNumber(tokensRaw, tokenFormatOptions);

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-oai-gray-200 dark:border-oai-gray-700">
      {/* Local icon only. This row is keyed by a repo you have checked out, so
          fetching a remote avatar would send that name — including a private
          one — to a third party from the user's browser. See issue 100. */}
      <div className="w-10 h-10 rounded bg-oai-gray-100 dark:bg-oai-gray-800 flex items-center justify-center">
        <ProviderIcon provider={repoKey} size={24} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-oai-black dark:text-oai-white truncate">
          {repo || repoKey || placeholder}
        </div>
        <div className="flex items-center gap-3 text-xs text-oai-gray-400 dark:text-oai-gray-400 mt-0.5">
          <span>{tokensCompact}</span>
        </div>
      </div>
    </div>
  );
}
