import React from "react";
import { Card } from "../../components";
import { copy } from "../../../lib/copy";
import { ContextBreakdownPanel } from "./ContextBreakdownPanel.jsx";
import { hasProviderModels, resolveContextBreakdownSource } from "./usageFormat.js";

// Standalone bento card for the Context Breakdown, promoted out of the
// provider drill-down (ProviderBreakdownCard) so it's always visible.
// Picks the provider with the largest usage among the ones that support a
// context breakdown (claude/codex); returns null when none qualify.
export function ContextCard({ fleetData = [], from, to }) {
  const candidates = fleetData
    .filter(hasProviderModels)
    .filter((provider) => resolveContextBreakdownSource(provider) !== null);

  if (candidates.length === 0) return null;

  const primaryProvider = candidates.reduce((best, provider) =>
    (Number(provider.usage) || 0) > (Number(best.usage) || 0) ? provider : best
  );
  const contextSource = resolveContextBreakdownSource(primaryProvider);

  return (
    <Card title={copy("dashboard.context_breakdown.card_title")}>
      <ContextBreakdownPanel
        from={from}
        to={to}
        source={contextSource}
        referenceTotalTokens={primaryProvider.usage}
      />
    </Card>
  );
}
