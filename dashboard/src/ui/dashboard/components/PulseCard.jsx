import React from "react";
import { formatCompactNumber, formatUsdCurrency } from "../../../lib/format";
import { deviationMark, toneVar } from "../../../lib/pulse-mark";

// Compact-number suffixes (K/M/B). Passed as JS args, not JSX text.
const COMPACT_CONFIG = { thousandSuffix: "K", millionSuffix: "M", billionSuffix: "B" };

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

// One delta as a bar diverging from a centre "normal" line: side = direction,
// length = magnitude (so +142% visibly outweighs +19%). Colour follows the
// metric's JOB — usage is value-neutral (cool-blue slate, darker for a big
// swing), $/MTok carries a verdict (red = pricier/worse, green = cheaper) and
// ships with an arrow so direction never rides on colour alone.
function DeviationBar({ label, delta, kind }) {
  const mark = deviationMark(delta, kind);
  const color = toneVar(mark.tone);
  const barStyle =
    mark.side === "up"
      ? { left: "50%", width: `${mark.widthPct}%`, background: color }
      : { right: "50%", width: `${mark.widthPct}%`, background: color };

  return (
    <div className="grid grid-cols-[2.3rem_1fr_3rem] items-center gap-2">
      <span className="text-[8.5px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-400 text-right">
        {label}
      </span>
      <span className="pulse-devtrack">
        <span className="pulse-devtick" />
        {mark.hasBar ? <span className="pulse-devbar" style={barStyle} /> : null}
      </span>
      <span className="flex items-center justify-end gap-1 text-[10.5px] font-bold tabular-nums text-right text-oai-gray-600 dark:text-oai-gray-300">
        {mark.arrow ? (
          <span className="text-[8px]" style={{ color }}>
            {mark.arrow}
          </span>
        ) : null}
        <span>{mark.labelText}</span>
      </span>
    </div>
  );
}

// "Day progress" gauge — today so far as a multiple of a normal full day. The
// track spans 0–2x so the midpoint marks a "normal day" (1x); a fill past it
// means today already burned more than a whole typical day. Amber = the day
// axis (a fuel gauge), deliberately distinct from the cool-blue deviation bars.
function ProgressBar({ ratio }) {
  const fillPct = (Math.min(Math.max(ratio, 0), 2) / 2) * 100;
  return (
    <div className="mt-2.5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[8.5px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-400">
          of a normal day
        </span>
        <span className="text-[11px] font-bold tabular-nums text-oai-brand-600 dark:text-oai-brand-light">
          {ratio.toFixed(1)}×
        </span>
      </div>
      <div
        className="relative h-[7px] rounded-full"
        style={{ background: "var(--pulse-track)" }}
      >
        <div
          className="absolute left-0 top-0 bottom-0 rounded-full bg-gradient-to-r from-oai-brand-500 to-oai-brand-light"
          style={{ width: `${fillPct}%` }}
        />
        <div
          className="absolute -top-[3px] -bottom-[3px] w-[2px] rounded-full"
          style={{ left: "50%", background: "var(--pulse-tick)" }}
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
    <div className={`pulse-card h-full flex flex-col gap-1.5 ${className}`}>
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
            className="py-2 border-b border-dashed border-oai-gray-200/40 dark:border-oai-gray-700/50 last:border-b-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                {metric.label}
              </span>
              <span className="text-xl font-bold text-oai-black dark:text-oai-white tabular-nums truncate">
                {metric.format(cell.value)}
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {deltaCols.map((col) => (
                <DeviationBar
                  key={col.field}
                  label={col.label}
                  delta={cell[col.field]}
                  kind={metric.kind}
                />
              ))}
            </div>
            {showProgress ? <ProgressBar ratio={cell.progress} /> : null}
          </div>
        );
      })}

      <div className="flex items-center gap-1.5 text-[10px] text-oai-gray-400 dark:text-oai-gray-400 pt-0.5">
        <span aria-hidden="true">⌚</span>
        <span>{footerText}</span>
      </div>
    </div>
  );
}

export default PulseCard;
