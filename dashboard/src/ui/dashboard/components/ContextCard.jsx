import React from "react";
import { Card } from "../../components";
import { copy } from "../../../lib/copy";
import { ContextBreakdownPanel } from "./ContextBreakdownPanel.jsx";
import { hasProviderModels, resolveContextBreakdownSource, formatTokens } from "./usageFormat.js";

const SOURCE_LABEL = { claude: "Claude", codex: "Codex" };

// Standalone bento card for the Context Breakdown, promoted out of the
// provider drill-down (ProviderBreakdownCard) so it's always visible.
// Renders one panel per context-capable provider — claude and codex are the
// only sources with a context breakdown — largest usage first, side by side.
// Returns null when none qualify. Providers without context data (gemini,
// copilot, …) appear only in the provider breakdown, never here.
export function ContextCard({ fleetData = [], from, to }) {
  const candidates = fleetData
    .filter(hasProviderModels)
    .filter((provider) => resolveContextBreakdownSource(provider) !== null);

  if (candidates.length === 0) return null;

  // Collapse to one provider per source (keep the largest), then order by
  // usage so the heaviest reads first. Guards against duplicate source rows.
  const bySource = new Map();
  for (const provider of candidates) {
    const source = resolveContextBreakdownSource(provider);
    const current = bySource.get(source);
    if (!current || (Number(provider.usage) || 0) > (Number(current.usage) || 0)) {
      bySource.set(source, provider);
    }
  }
  const panels = Array.from(bySource.values()).sort(
    (a, b) => (Number(b.usage) || 0) - (Number(a.usage) || 0),
  );
  const multi = panels.length > 1;

  return (
    <Card title={copy("dashboard.context_breakdown.card_title")}>
      <div className={multi ? "grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6" : ""}>
        {panels.map((provider) => {
          const source = resolveContextBreakdownSource(provider);
          return (
            <div key={source} className="min-w-0">
              {multi ? (
                <div className="mb-3 flex items-center justify-between gap-2 border-b border-oai-gray-200 pb-2 dark:border-oai-gray-800">
                  <span className="text-sm font-semibold text-oai-black dark:text-oai-white">
                    {SOURCE_LABEL[source] ?? source}
                  </span>
                  <span className="text-xs font-medium tabular-nums text-oai-gray-500 dark:text-oai-gray-300">
                    {formatTokens(provider.usage)}
                  </span>
                </div>
              ) : null}
              <ContextBreakdownPanel
                from={from}
                to={to}
                source={source}
                referenceTotalTokens={provider.usage}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
