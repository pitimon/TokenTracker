import React from "react";
import { copy } from "../../../lib/copy";
import { Card, Badge } from "../../components";

function normalizeBadgePart(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toTitleWords(value) {
  const normalized = normalizeBadgePart(value);
  if (!normalized) return "";
  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function buildSubscriptionItems(subscriptions) {
  if (!Array.isArray(subscriptions)) return [];
  const deduped = new Map();
  for (const entry of subscriptions) {
    if (!entry || typeof entry !== "object") continue;
    const toolRaw = normalizeBadgePart(entry.tool);
    const planRaw = normalizeBadgePart(entry.planType) || normalizeBadgePart(entry.plan_type);
    if (!toolRaw || !planRaw) continue;
    const tool = toTitleWords(toolRaw) || toolRaw;
    const plan = toTitleWords(planRaw) || planRaw;
    deduped.set(`${toolRaw.toLowerCase()}::${planRaw.toLowerCase()}`, { tool, plan });
  }
  return Array.from(deduped.values());
}

export function StatsPanel({
  rankLabel,
  streakDays,
  subscriptions = [],
  className = "",
}) {
  const rankValue = rankLabel ?? copy("identity_card.rank_placeholder");
  const streakDaysNum = Number.isFinite(Number(streakDays)) ? Number(streakDays) : 0;
  const streakValue = streakDaysNum
    ? copy("identity_card.streak_value", { days: streakDaysNum })
    : copy("identity_card.rank_placeholder");
  const subscriptionItems = buildSubscriptionItems(subscriptions);

  return (
    <Card className={`h-full ${className}`}>
        {/* Subscriptions */}
        {subscriptionItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {subscriptionItems.map((entry, index) => (
              <Badge
                key={`${entry.tool}:${entry.plan}:${index}`}
                variant="secondary"
                size="sm"
              >
                {entry.tool} {entry.plan}
              </Badge>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className={`${subscriptionItems.length > 0 ? "mt-3 pt-3 border-t border-oai-gray-100 dark:border-oai-gray-800 " : ""}flex items-center justify-between text-xs text-oai-gray-400 dark:text-oai-gray-400`}>
          <div className="flex items-center gap-1.5">
            <span>{copy("identity_card.rank_label")}</span>
            <span className="text-oai-gray-500 dark:text-oai-gray-300 tabular-nums">{rankValue}</span>
          </div>
          <div className="flex items-center gap-1">
            <span>{copy("identity_card.streak_label")}</span>
            <span className="text-oai-gray-500 dark:text-oai-gray-300 tabular-nums">{streakValue}</span>
          </div>
        </div>
      </Card>
  );
}
