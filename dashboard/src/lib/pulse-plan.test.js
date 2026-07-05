import { describe, expect, it } from "vitest";
import {
  buildPlan,
  dailyByDayMap,
  dailyRangeSlice,
  hourlyByDayMap,
  localHour,
  reduceDaySlices,
  reduceWindowSlices,
  shiftDayKey,
  todayKeyFor,
} from "./pulse-plan";

const TODAY = "2026-07-05";
const hourly = (day, hour, tokens, cost) => ({
  hour: `${day}T${String(hour).padStart(2, "0")}:00:00`,
  total_tokens: tokens,
  total_cost_usd: cost,
});

describe("shiftDayKey (UTC day arithmetic, month/year boundaries)", () => {
  it("crosses month and year boundaries", () => {
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDayKey("2024-02-28", 1)).toBe("2024-02-29"); // leap year
    expect(shiftDayKey("garbage", -1)).toBeNull();
  });
});

describe("buildPlan (period → fetch/compute windows)", () => {
  it("hides the pulse for total/custom/unknown", () => {
    expect(buildPlan("total", TODAY)).toBeNull();
    expect(buildPlan("custom", TODAY)).toBeNull();
    expect(buildPlan("day", "")).toBeNull();
  });

  it("day: today + 7 trailing days, prev = yesterday", () => {
    const plan = buildPlan("day", TODAY);
    expect(plan.kind).toBe("day");
    expect(plan.prevKey).toBe("2026-07-04");
    expect(plan.trailingKeys).toEqual([
      "2026-07-04",
      "2026-07-03",
      "2026-07-02",
      "2026-07-01",
      "2026-06-30",
      "2026-06-29",
      "2026-06-28",
    ]);
    // 8 distinct hourly days (today + 7 trailing).
    expect(plan.hourlyDays).toHaveLength(8);
    expect(plan.hourlyDays[0]).toBe(TODAY);
  });

  it("week: current [today-6..today], prev boundary today-7, daily spans 14d", () => {
    const plan = buildPlan("week", TODAY);
    expect(plan.kind).toBe("window");
    expect(plan.curStartKey).toBe("2026-06-29"); // today-6
    expect(plan.prevBoundaryKey).toBe("2026-06-28"); // today-7 (partial-equivalent)
    expect(plan.prevStartKey).toBe("2026-06-22"); // today-13
    expect(plan.dailyFrom).toBe("2026-06-22");
    expect(plan.dailyTo).toBe(TODAY);
    // Only the two partial/boundary days need hourly.
    expect(plan.hourlyDays).toEqual([TODAY, "2026-06-28"]);
  });

  it("month: span 29 → current today-29, prev boundary today-30, prev start today-59", () => {
    const plan = buildPlan("month", TODAY);
    expect(plan.curStartKey).toBe("2026-06-06"); // today-29
    expect(plan.prevBoundaryKey).toBe("2026-06-05"); // today-30
    expect(plan.prevStartKey).toBe("2026-05-07"); // today-59
    expect(plan.hourlyDays).toEqual([TODAY, "2026-06-05"]);
  });
});

describe("dailyRangeSlice (inclusive range sum)", () => {
  const daily = dailyByDayMap({
    data: [
      { day: "2026-07-01", total_tokens: 100, total_cost_usd: 1 },
      { day: "2026-07-02", total_tokens: 200, total_cost_usd: 2 },
      { day: "2026-07-03", total_tokens: 300, total_cost_usd: 3 },
    ],
  });
  it("sums inclusively and ignores missing/inverted ranges", () => {
    expect(dailyRangeSlice(daily, "2026-07-01", "2026-07-02")).toEqual({ tokens: 300, cost: 3 });
    expect(dailyRangeSlice(daily, "2026-07-03", "2026-07-01")).toEqual({ tokens: 0, cost: 0 }); // inverted
    expect(dailyRangeSlice(daily, null, "2026-07-03")).toEqual({ tokens: 0, cost: 0 });
  });
});

describe("reduceDaySlices (same-elapsed truncation)", () => {
  it("truncates today, yesterday, and each trailing day to the cutoff hour", () => {
    const plan = buildPlan("day", TODAY);
    // today: hours 0,1,2 (cutoff 1 keeps 0+1); yesterday only hour 0.
    const hourlyByDay = new Map([
      [TODAY, [hourly(TODAY, 0, 100, 1), hourly(TODAY, 1, 100, 1), hourly(TODAY, 5, 999, 9)]],
      ["2026-07-04", [hourly("2026-07-04", 0, 50, 0.5)]],
    ]);
    const { current, prev, trailingAvg } = reduceDaySlices(plan, hourlyByDay, 1);
    expect(current).toEqual({ tokens: 200, cost: 2 }); // hour 5 excluded by cutoff
    expect(prev).toEqual({ tokens: 50, cost: 0.5 });
    // 7 trailing days, only 2026-07-04 has data → mean over 7 = 50/7, 0.5/7.
    expect(trailingAvg.tokens).toBeCloseTo(50 / 7, 6);
    expect(trailingAvg.cost).toBeCloseTo(0.5 / 7, 6);
  });

  it("trailingFull sums each trailing day to end-of-day (captures post-cutoff hours)", () => {
    const plan = buildPlan("day", TODAY);
    // yesterday has hour-0 (before cutoff) AND hour-20 (after cutoff 1).
    const hourlyByDay = new Map([
      [TODAY, [hourly(TODAY, 0, 100, 1)]],
      ["2026-07-04", [hourly("2026-07-04", 0, 30, 0.3), hourly("2026-07-04", 20, 300, 3)]],
    ]);
    const { trailingAvg, trailingFull } = reduceDaySlices(plan, hourlyByDay, 1);
    // same-elapsed (cutoff 1) drops the hour-20 activity → 30 tok over 7 days.
    expect(trailingAvg.tokens).toBeCloseTo(30 / 7, 6);
    // full-day keeps it → (30 + 300) over 7 days; this is the "normal day" baseline.
    expect(trailingFull.tokens).toBeCloseTo(330 / 7, 6);
    expect(trailingFull.cost).toBeCloseTo(3.3 / 7, 6);
  });
});

describe("reduceWindowSlices (no double-count of today / boundary day)", () => {
  it("uses daily for completed days and hourly ONLY for today + boundary", () => {
    const plan = buildPlan("week", TODAY);
    // Uniform 100 tok / $1 for every day 2026-06-22..2026-07-05.
    const rows = [];
    for (let d = 22; d <= 30; d++) rows.push({ day: `2026-06-${d}`, total_tokens: 100, total_cost_usd: 1 });
    for (let d = 1; d <= 5; d++)
      rows.push({ day: `2026-07-0${d}`, total_tokens: 100, total_cost_usd: 1 });
    const dailyByDay = dailyByDayMap({ data: rows });
    // hourly for today + boundary (2026-06-28): hours 0,1 kept at cutoff 1 = 30 tok / $0.3.
    const hourlyByDay = new Map([
      [TODAY, [hourly(TODAY, 0, 10, 0.1), hourly(TODAY, 1, 20, 0.2), hourly(TODAY, 9, 500, 5)]],
      ["2026-06-28", [hourly("2026-06-28", 0, 10, 0.1), hourly("2026-06-28", 1, 20, 0.2)]],
    ]);
    const { current, prev, trailingAvg } = reduceWindowSlices(plan, hourlyByDay, dailyByDay, 1);
    // current = daily(06-29..07-04 = 6 days ×100 = 600) + hourly(today ≤ cutoff = 30). today's DAILY 100 must NOT be added.
    expect(current).toEqual({ tokens: 630, cost: 6.3 });
    // prev = daily(06-22..06-27 = 6 days ×100 = 600) + hourly(06-28 ≤ cutoff = 30). boundary's DAILY 100 must NOT be added.
    expect(prev).toEqual({ tokens: 630, cost: 6.3 });
    expect(trailingAvg).toBeNull();
  });
});

describe("localHour / todayKeyFor (offset fallback)", () => {
  it("derives the local hour and day from a fixed offset", () => {
    // 2026-07-05T16:30:00Z + 420min (UTC+7) = 23:30 local, same day.
    const now = new Date("2026-07-05T16:30:00Z");
    expect(localHour(now, { offsetMinutes: 420 })).toBe(23);
    expect(todayKeyFor(now, { offsetMinutes: 420 })).toBe("2026-07-05");
    // + a positive offset that rolls to the next day.
    const late = new Date("2026-07-05T20:00:00Z");
    expect(todayKeyFor(late, { offsetMinutes: 300 })).toBe("2026-07-06"); // 01:00 next day
  });
});

describe("hourlyByDayMap (defensive shape handling)", () => {
  it("maps each day to its data array, tolerating missing/nullish responses", () => {
    const map = hourlyByDayMap(["a", "b"], [{ data: [1, 2] }, null]);
    expect(map.get("a")).toEqual([1, 2]);
    expect(map.get("b")).toEqual([]);
  });
});
