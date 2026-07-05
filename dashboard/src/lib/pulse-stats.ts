// Pure, unit-testable math for the "Today's Pulse" dashboard card.
//
// Same-elapsed comparison: the partial current period (e.g. "today so far")
// is compared against baselines truncated to the SAME clock hour, so the
// numbers stay apples-to-apples at every point in the day instead of a
// full day always dwarfing a half-finished one.
//
// This module is intentionally dependency-free: callers reduce raw hourly /
// daily API rows into {tokens, cost} slices (see use-pulse.ts) and hand those
// in. Keeping it pure makes the delta semantics trivially testable.

export interface Slice {
  tokens: number;
  cost: number;
}

export interface HourlyBucket {
  hour?: string; // e.g. "2026-07-05T14:00:00"
  total_tokens?: number | string;
  total_cost_usd?: number | string;
}

export type PulsePeriod = "day" | "24h" | "week" | "month" | "total" | "custom" | string;

export interface PulseMetric {
  value: number | null;
  deltaVsPrev: number | null;
  deltaVsAvg: number | null;
  // "Day progress" — today so far as a multiple of a normal full day (1.77 = 1.8x).
  // Only meaningful for cumulative metrics (tokens/cost) on the day view; null
  // for $/MTok (a rate), non-day periods, or a zero baseline.
  progress: number | null;
}

export interface Pulse {
  period: PulsePeriod;
  tokens: PulseMetric;
  cost: PulseMetric;
  perMTok: PulseMetric;
}

function toNum(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Extract the hour-of-day (0..23) from a bucket's "YYYY-MM-DDTHH:00:00" key.
// Returns null when the shape is unexpected so the caller can skip it.
export function bucketHour(bucket: HourlyBucket | null | undefined): number | null {
  const raw = String(bucket?.hour ?? "");
  const t = raw.indexOf("T");
  if (t < 0) return null;
  const hh = Number(raw.slice(t + 1, t + 3));
  return Number.isFinite(hh) ? hh : null;
}

// Sum {tokens, cost} over the hourly buckets up to and including `cutoffHour`.
// This is the same-elapsed truncation: with cutoffHour = current local hour,
// both today and a baseline day only count activity through the same clock hour.
export function sumBucketsUpToHour(
  buckets: HourlyBucket[] | null | undefined,
  cutoffHour: number,
): Slice {
  let tokens = 0;
  let cost = 0;
  if (Array.isArray(buckets)) {
    for (const bucket of buckets) {
      const hh = bucketHour(bucket);
      if (hh == null || hh > cutoffHour) continue;
      tokens += toNum(bucket.total_tokens);
      cost += toNum(bucket.total_cost_usd);
    }
  }
  return { tokens, cost };
}

export function addSlices(...slices: Array<Slice | null | undefined>): Slice {
  return slices.reduce<Slice>(
    (acc, slice) => ({
      tokens: acc.tokens + toNum(slice?.tokens),
      cost: acc.cost + toNum(slice?.cost),
    }),
    { tokens: 0, cost: 0 },
  );
}

// Mean of N day-slices — used for the "vs trailing 7-day average" baseline.
// Returns null for an empty set so deltas resolve to null rather than NaN.
export function meanSlice(slices: Array<Slice | null | undefined>): Slice | null {
  if (!Array.isArray(slices) || slices.length === 0) return null;
  const sum = addSlices(...slices);
  return { tokens: sum.tokens / slices.length, cost: sum.cost / slices.length };
}

// Cost per million tokens for a slice. Ratio-of-sums (Σcost / Σtokens), NOT a
// mean of per-day ratios — that would over-weight low-volume days. null when
// there are no tokens (division would be Inf/NaN).
export function perMTok(slice: Slice | null | undefined): number | null {
  if (!slice) return null;
  const tokens = toNum(slice.tokens);
  if (tokens <= 0) return null;
  return toNum(slice.cost) / (tokens / 1_000_000);
}

// Relative change of `current` vs `baseline` as a fraction (0.12 = +12%).
// null when either side is missing or the baseline is zero, so the card
// renders "—" instead of Infinity / NaN.
export function relDelta(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null;
  if (baseline === 0) return null;
  return (current - baseline) / baseline;
}

// Assemble the three-metric pulse from already-reduced, same-elapsed slices.
//
// - period "total" (or a missing current slice) → null; the card is hidden.
// - deltaVsAvg is only meaningful for the day view (vs a trailing 7-day average);
//   for week / month, callers pass trailingAvg = null and it resolves to null so
//   the card shows a single "vs previous period" delta.
export function computePulse({
  current,
  prev = null,
  trailingAvg = null,
  trailingFull = null,
  period,
}: {
  current: Slice | null;
  prev?: Slice | null;
  trailingAvg?: Slice | null;
  // Full-day 7-day average (each baseline day summed to end-of-day, not
  // truncated to the cutoff). Powers the "day progress" multiple. Day view only.
  trailingFull?: Slice | null;
  period: PulsePeriod;
}): Pulse | null {
  if (period === "total" || !current) return null;

  // today-so-far as a multiple of a normal full day; null when there's no
  // full-day baseline or it's zero (avoids Inf).
  const progressOf = (value: number, fullValue: number | null): number | null => {
    if (fullValue == null || !(fullValue > 0)) return null;
    return value / fullValue;
  };

  const buildMetric = (
    value: number | null,
    prevValue: number | null,
    avgValue: number | null,
    progress: number | null,
  ): PulseMetric => ({
    value,
    deltaVsPrev: relDelta(value, prevValue),
    deltaVsAvg: trailingAvg ? relDelta(value, avgValue) : null,
    progress,
  });

  return {
    period,
    tokens: buildMetric(
      toNum(current.tokens),
      prev ? toNum(prev.tokens) : null,
      trailingAvg ? toNum(trailingAvg.tokens) : null,
      trailingFull ? progressOf(toNum(current.tokens), toNum(trailingFull.tokens)) : null,
    ),
    cost: buildMetric(
      toNum(current.cost),
      prev ? toNum(prev.cost) : null,
      trailingAvg ? toNum(trailingAvg.cost) : null,
      trailingFull ? progressOf(toNum(current.cost), toNum(trailingFull.cost)) : null,
    ),
    perMTok: buildMetric(perMTok(current), perMTok(prev), perMTok(trailingAvg), null),
  };
}
