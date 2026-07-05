import React from "react";
import { Card } from "../../components";
import { formatCompactNumber, formatUsdCurrency } from "../../../lib/format";

// Compact-number suffixes (K/M/B). Passed as JS args, not JSX text.
const COMPACT_CONFIG = { thousandSuffix: "K", millionSuffix: "M", billionSuffix: "B" };

// Below this magnitude a delta reads as "flat" — no attention colour, no arrow.
const FLAT_THRESHOLD = 0.005;

const fmtTokens = (value) =>
  value == null ? "—" : formatCompactNumber(value, COMPACT_CONFIG);
const fmtCost = (value) =>
  value == null ? "—" : formatUsdCurrency(value, { decimals: value >= 100 ? 0 : 2 });
const fmtPerMTok = (value) => (value == null ? "—" : formatUsdCurrency(value, { decimals: 2 }));

const METRICS = [
  { key: "tokens", label: "Tokens", kind: "usage", format: fmtTokens },
  { key: "cost", label: "Cost", kind: "usage", format: fmtCost },
  { key: "perMTok", label: "$/MTok", kind: "price", format: fmtPerMTok },
];

// Map a delta (fraction) to arrow + colour. Semantics, not raw direction:
// usage up = attention (amber), usage down = quieter (muted); price up = worse
// (red), price down = cheaper (green). Missing / flat = muted "—" or "0%".
function deltaMeta(delta, kind) {
  const mutedCls = "text-oai-gray-400 dark:text-oai-gray-400";
  if (delta == null || !Number.isFinite(delta)) {
    return { text: "—", cls: mutedCls };
  }
  if (Math.abs(delta) < FLAT_THRESHOLD) {
    return { text: "0%", cls: mutedCls };
  }
  const up = delta > 0;
  const pct = Math.round(Math.abs(delta) * 100);
  const arrow = up ? "▲" : "▼";
  let cls;
  if (kind === "price") {
    cls = up ? "text-oai-error" : "text-oai-success";
  } else {
    cls = up ? "text-oai-brand-500 dark:text-oai-brand-light" : mutedCls;
  }
  return { text: `${arrow}${pct}%`, cls };
}

// "Day progress" gauge — today so far as a multiple of a normal full day.
// The track spans 0–2x so the midpoint marks a "normal day" (1x); a fill past
// it means today has already burned more than a whole typical day. Read as a
// fuel gauge (it climbs through the day), not a vs-normal alarm.
function ProgressBar({ ratio }) {
  const fillPct = (Math.min(Math.max(ratio, 0), 2) / 2) * 100;
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[8.5px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-400">
          of a normal day
        </span>
        <span className="text-[11px] font-bold tabular-nums text-oai-brand-600 dark:text-oai-brand-light">
          {ratio.toFixed(1)}×
        </span>
      </div>
      <div className="relative h-[7px] rounded-full bg-oai-gray-100 dark:bg-oai-gray-800">
        <div
          className="absolute left-0 top-0 bottom-0 rounded-full bg-gradient-to-r from-oai-brand-500 to-oai-brand-light"
          style={{ width: `${fillPct}%` }}
        />
        {/* "normal day" (1x) tick — the 0–2x track puts it at the midpoint */}
        <div
          className="absolute -top-[3px] -bottom-[3px] w-[2px] rounded-full bg-oai-gray-500/60 dark:bg-oai-gray-300/50"
          style={{ left: "50%" }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// "Today's Pulse" rail card. Renders nothing when there's no pulse (total
// period, or data unavailable) so the caller can drop it from the grid.
export function PulseCard({ pulse, period, comparedAtLabel, className = "" }) {
  if (!pulse) return null;

  const isDay = period === "day" || period === "24h";
  const prevWindowLabel = period === "month" ? "prev 30d" : "prev 7d";
  const deltaCols = isDay
    ? [
        { label: "yest", field: "deltaVsPrev" },
        { label: "7d avg", field: "deltaVsAvg" },
      ]
    : [{ label: prevWindowLabel, field: "deltaVsPrev" }];

  const comparisonLabel = isDay ? "vs yest · 7d avg" : `vs ${prevWindowLabel}`;
  const footerText = isDay
    ? `same time of day${comparedAtLabel ? ` · ${comparedAtLabel}` : ""}`
    : `same elapsed vs ${prevWindowLabel}`;

  return (
    <Card
      className={`h-full !border-oai-brand-200 dark:!border-oai-brand-900/60 !bg-oai-brand-50 dark:!bg-oai-brand-950/40 ${className}`}
      bodyClassName="flex flex-col gap-2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-oai-brand-600 dark:text-oai-brand-light">
          Today's pulse
        </span>
        <span className="text-[9px] text-oai-gray-400 dark:text-oai-gray-400 tracking-wide">
          {comparisonLabel}
        </span>
      </div>

      {METRICS.map((metric) => {
        const cell = pulse[metric.key] || {};
        const showProgress = typeof cell.progress === "number" && Number.isFinite(cell.progress);
        return (
          <div
            key={metric.key}
            className="py-1.5 border-b border-dashed border-oai-brand-200/70 dark:border-oai-brand-900/50 last:border-b-0"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                  {metric.label}
                </span>
                <span className="text-xl font-bold text-oai-black dark:text-oai-white tabular-nums mt-0.5 truncate">
                  {metric.format(cell.value)}
                </span>
              </div>
              <div className="flex gap-3 flex-shrink-0">
                {deltaCols.map((col) => {
                  const meta = deltaMeta(cell[col.field], metric.kind);
                  return (
                    <div key={col.field} className="flex flex-col items-end min-w-[3.25rem]">
                      <span className="text-[8.5px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-400">
                        {col.label}
                      </span>
                      <span className={`text-xs font-bold tabular-nums mt-0.5 ${meta.cls}`}>
                        {meta.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            {showProgress ? <ProgressBar ratio={cell.progress} /> : null}
          </div>
        );
      })}

      <div className="flex items-center gap-1.5 text-[10.5px] text-oai-gray-400 dark:text-oai-gray-400 pt-0.5">
        <span aria-hidden="true">⌚</span>
        <span>{footerText}</span>
      </div>
    </Card>
  );
}

export default PulseCard;
