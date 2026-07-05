// Pure planning + reduction for the "Today's Pulse" hook (use-pulse.ts).
//
// Split out from the React hook so the highest-risk parts — day-key arithmetic,
// window off-by-one, and the daily+hourly reduction — are unit-testable without
// mounting a component or mocking fetch. The hook stays responsible only for
// state, caching, and issuing the requests this module describes.

import { addSlices, meanSlice, sumBucketsUpToHour, type Slice } from "./pulse-stats";

const DAY_MS = 86_400_000;

export function parseDayKey(key: string): number | null {
  const parts = String(key).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

export function formatDayKey(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftDayKey(key: string, deltaDays: number): string | null {
  const ms = parseDayKey(key);
  return ms == null ? null : formatDayKey(ms + deltaDays * DAY_MS);
}

// Current wall-clock hour (0..23) in the user's timezone — the inclusive cutoff
// for same-elapsed truncation. Prefers the IANA zone, falls back to a fixed
// offset, then to the host clock.
export function localHour(now: Date, { timeZone, offsetMinutes }: any): number {
  const dt = now instanceof Date ? now : new Date(now);
  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false });
      let hh = Number(fmt.format(dt).slice(0, 2));
      if (hh === 24) hh = 0; // some engines render midnight as "24"
      if (Number.isFinite(hh)) return Math.min(23, Math.max(0, hh));
    } catch (_e) {
      // fall through
    }
  }
  if (typeof offsetMinutes === "number" && Number.isFinite(offsetMinutes)) {
    return new Date(dt.getTime() + offsetMinutes * 60000).getUTCHours();
  }
  return dt.getHours();
}

// Local day key (YYYY-MM-DD) for the user's timezone.
export function todayKeyFor(now: Date, { timeZone, offsetMinutes }: any): string {
  const dt = now instanceof Date ? now : new Date(now);
  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const s = fmt.format(dt); // en-CA => YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    } catch (_e) {
      // fall through
    }
  }
  if (typeof offsetMinutes === "number" && Number.isFinite(offsetMinutes)) {
    return formatDayKey(dt.getTime() + offsetMinutes * 60000);
  }
  return formatDayKey(dt.getTime());
}

export const tokensOf = (row: any): number => Number(row?.total_tokens ?? 0) || 0;
export const costOf = (row: any): number => Number(row?.total_cost_usd ?? 0) || 0;

// Sum daily {tokens, cost} over an inclusive day-key range from a keyed map.
export function dailyRangeSlice(
  dailyByDay: Map<string, Slice>,
  startKey: string | null,
  endKeyInclusive: string | null,
): Slice {
  let out: Slice = { tokens: 0, cost: 0 };
  const start = startKey ? parseDayKey(startKey) : null;
  const end = endKeyInclusive ? parseDayKey(endKeyInclusive) : null;
  if (start == null || end == null || start > end) return out;
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const slice = dailyByDay.get(formatDayKey(ms));
    if (slice) out = addSlices(out, slice);
  }
  return out;
}

export type PulsePlan =
  | {
      kind: "day";
      hourlyDays: string[];
      dailyFrom: null;
      dailyTo: null;
      todayKey: string;
      prevKey: string | null;
      trailingKeys: string[];
    }
  | {
      kind: "window";
      hourlyDays: string[];
      dailyFrom: string | null;
      dailyTo: string;
      todayKey: string;
      curStartKey: string | null;
      prevBoundaryKey: string | null;
      prevStartKey: string | null;
    };

// Describe what to fetch/compute for a period, or null when the pulse is hidden.
// Windows include today-partial (see date-range.getRangeForPeriod), so the
// previous equivalent window shifts back by windowLen and its boundary day
// (the partial-equivalent) is truncated to the cutoff; completed days are full.
export function buildPlan(period: string, todayKey: string): PulsePlan | null {
  if (!todayKey || period === "total") return null;

  if (period === "day" || period === "24h") {
    const trailingKeys: string[] = [];
    for (let d = 1; d <= 7; d++) {
      const k = shiftDayKey(todayKey, -d);
      if (k) trailingKeys.push(k);
    }
    return {
      kind: "day",
      hourlyDays: [todayKey, ...trailingKeys],
      dailyFrom: null,
      dailyTo: null,
      todayKey,
      prevKey: shiftDayKey(todayKey, -1),
      trailingKeys,
    };
  }

  const span = period === "week" ? 6 : period === "month" ? 29 : null;
  if (span == null) return null; // custom & anything else: no pulse in v1

  const windowLen = span + 1;
  const prevBoundaryKey = shiftDayKey(todayKey, -windowLen); // partial-equivalent day of prev window
  return {
    kind: "window",
    hourlyDays: [todayKey, prevBoundaryKey].filter(Boolean) as string[],
    dailyFrom: shiftDayKey(todayKey, -(windowLen * 2 - 1)),
    dailyTo: todayKey,
    todayKey,
    curStartKey: shiftDayKey(todayKey, -span),
    prevBoundaryKey,
    prevStartKey: shiftDayKey(todayKey, -(windowLen * 2 - 1)),
  };
}

export function hourlyByDayMap(days: string[], responses: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  days.forEach((day, i) => {
    map.set(day, Array.isArray(responses[i]?.data) ? responses[i].data : []);
  });
  return map;
}

export function dailyByDayMap(dailyRes: any): Map<string, Slice> {
  const map = new Map<string, Slice>();
  for (const row of Array.isArray(dailyRes?.data) ? dailyRes.data : []) {
    if (row?.day) map.set(String(row.day), { tokens: tokensOf(row), cost: costOf(row) });
  }
  return map;
}

// Day view: current = today so far, prev = yesterday so far, trailingAvg = mean
// of the 7 prior days each truncated to the same clock hour.
export function reduceDaySlices(plan: any, hourlyByDay: Map<string, any[]>, cutoffHour: number) {
  return {
    current: sumBucketsUpToHour(hourlyByDay.get(plan.todayKey), cutoffHour),
    prev: plan.prevKey ? sumBucketsUpToHour(hourlyByDay.get(plan.prevKey), cutoffHour) : null,
    trailingAvg: meanSlice(
      plan.trailingKeys.map((k: string) => sumBucketsUpToHour(hourlyByDay.get(k), cutoffHour)),
    ),
  };
}

// Week/month view: each window = completed days (daily aggregates) + the
// partial/boundary day truncated to the cutoff hour (hourly). No trailing avg.
export function reduceWindowSlices(
  plan: any,
  hourlyByDay: Map<string, any[]>,
  dailyByDay: Map<string, Slice>,
  cutoffHour: number,
) {
  const current = addSlices(
    dailyRangeSlice(dailyByDay, plan.curStartKey, shiftDayKey(plan.todayKey, -1)),
    sumBucketsUpToHour(hourlyByDay.get(plan.todayKey), cutoffHour),
  );
  const prev = addSlices(
    dailyRangeSlice(
      dailyByDay,
      plan.prevStartKey,
      plan.prevBoundaryKey ? shiftDayKey(plan.prevBoundaryKey, -1) : null,
    ),
    plan.prevBoundaryKey
      ? sumBucketsUpToHour(hourlyByDay.get(plan.prevBoundaryKey), cutoffHour)
      : { tokens: 0, cost: 0 },
  );
  return { current, prev, trailingAvg: null };
}
