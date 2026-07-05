import { describe, expect, it } from "vitest";
import {
  bucketHour,
  sumBucketsUpToHour,
  addSlices,
  meanSlice,
  perMTok,
  relDelta,
  computePulse,
} from "./pulse-stats";

const bucket = (hour, tokens, cost) => ({
  hour: `2026-07-05T${String(hour).padStart(2, "0")}:00:00`,
  total_tokens: tokens,
  total_cost_usd: cost,
});

describe("bucketHour", () => {
  it("extracts the hour-of-day from a bucket key", () => {
    expect(bucketHour(bucket(14, 0, 0))).toBe(14);
    expect(bucketHour(bucket(0, 0, 0))).toBe(0);
    expect(bucketHour(bucket(23, 0, 0))).toBe(23);
  });

  it("returns null for malformed or missing hours", () => {
    expect(bucketHour(null)).toBeNull();
    expect(bucketHour({})).toBeNull();
    expect(bucketHour({ hour: "not-a-date" })).toBeNull();
  });
});

describe("sumBucketsUpToHour (same-elapsed truncation)", () => {
  const buckets = [bucket(8, 100, 1), bucket(14, 200, 2), bucket(20, 400, 4)];

  it("sums only buckets up to and including the cutoff hour", () => {
    expect(sumBucketsUpToHour(buckets, 14)).toEqual({ tokens: 300, cost: 3 });
  });

  it("includes the whole day when cutoff is end-of-day", () => {
    expect(sumBucketsUpToHour(buckets, 23)).toEqual({ tokens: 700, cost: 7 });
  });

  it("excludes everything before the first bucket hour", () => {
    expect(sumBucketsUpToHour(buckets, 7)).toEqual({ tokens: 0, cost: 0 });
  });

  it("coerces string numerics and tolerates empty input", () => {
    expect(sumBucketsUpToHour([bucket(1, "50", "0.5")], 5)).toEqual({ tokens: 50, cost: 0.5 });
    expect(sumBucketsUpToHour(null, 12)).toEqual({ tokens: 0, cost: 0 });
    expect(sumBucketsUpToHour([], 12)).toEqual({ tokens: 0, cost: 0 });
  });
});

describe("addSlices / meanSlice", () => {
  it("adds slices field-wise", () => {
    expect(addSlices({ tokens: 10, cost: 1 }, { tokens: 5, cost: 0.5 })).toEqual({
      tokens: 15,
      cost: 1.5,
    });
  });

  it("means N slices and returns null for an empty set", () => {
    expect(meanSlice([{ tokens: 10, cost: 2 }, { tokens: 20, cost: 4 }])).toEqual({
      tokens: 15,
      cost: 3,
    });
    expect(meanSlice([])).toBeNull();
  });
});

describe("perMTok (ratio-of-sums, guarded)", () => {
  it("computes cost per million tokens", () => {
    // $3 over 6M tokens = $0.50/MTok
    expect(perMTok({ tokens: 6_000_000, cost: 3 })).toBeCloseTo(0.5, 10);
  });

  it("returns null when tokens are zero or missing", () => {
    expect(perMTok({ tokens: 0, cost: 5 })).toBeNull();
    expect(perMTok(null)).toBeNull();
  });
});

describe("relDelta (guarded against Inf/NaN)", () => {
  it("computes the fractional change", () => {
    expect(relDelta(120, 100)).toBeCloseTo(0.2, 10);
    expect(relDelta(80, 100)).toBeCloseTo(-0.2, 10);
  });

  it("returns null when the baseline is zero or a side is missing", () => {
    expect(relDelta(100, 0)).toBeNull();
    expect(relDelta(100, null)).toBeNull();
    expect(relDelta(null, 100)).toBeNull();
  });
});

describe("computePulse", () => {
  it("is hidden (null) for the total period", () => {
    expect(computePulse({ current: { tokens: 1, cost: 1 }, period: "total" })).toBeNull();
  });

  it("day view carries both deltas (vs prev + vs trailing avg)", () => {
    const pulse = computePulse({
      current: { tokens: 2_000_000, cost: 2 }, // $1.00/MTok
      prev: { tokens: 1_000_000, cost: 1 }, // $1.00/MTok
      trailingAvg: { tokens: 4_000_000, cost: 2 }, // $0.50/MTok
      period: "day",
    });
    expect(pulse.tokens.value).toBe(2_000_000);
    expect(pulse.tokens.deltaVsPrev).toBeCloseTo(1.0, 10); // doubled vs yesterday
    expect(pulse.tokens.deltaVsAvg).toBeCloseTo(-0.5, 10); // half the 7d-avg day
    expect(pulse.perMTok.value).toBeCloseTo(1.0, 10);
    expect(pulse.perMTok.deltaVsPrev).toBeCloseTo(0, 10); // same $/MTok as prev
    expect(pulse.perMTok.deltaVsAvg).toBeCloseTo(1.0, 10); // pricier than the cheap avg
  });

  it("week/month view suppresses the trailing-avg delta", () => {
    const pulse = computePulse({
      current: { tokens: 3_000_000, cost: 3 },
      prev: { tokens: 2_000_000, cost: 2 },
      trailingAvg: null,
      period: "week",
    });
    expect(pulse.tokens.deltaVsPrev).toBeCloseTo(0.5, 10);
    expect(pulse.tokens.deltaVsAvg).toBeNull();
    expect(pulse.cost.deltaVsAvg).toBeNull();
    expect(pulse.perMTok.deltaVsAvg).toBeNull();
  });

  it("null-safes a missing previous period (fresh account, no history)", () => {
    const pulse = computePulse({
      current: { tokens: 1_000_000, cost: 1 },
      prev: null,
      trailingAvg: null,
      period: "day",
    });
    expect(pulse.tokens.value).toBe(1_000_000);
    expect(pulse.tokens.deltaVsPrev).toBeNull();
    expect(pulse.tokens.deltaVsAvg).toBeNull();
  });

  it("returns a zero-token current slice with null perMTok, not NaN", () => {
    const pulse = computePulse({
      current: { tokens: 0, cost: 0 },
      prev: { tokens: 1_000_000, cost: 1 },
      trailingAvg: null,
      period: "day",
    });
    expect(pulse.tokens.value).toBe(0);
    expect(pulse.tokens.deltaVsPrev).toBeCloseTo(-1, 10); // 0 vs prev = -100%
    expect(pulse.perMTok.value).toBeNull();
    expect(pulse.perMTok.deltaVsPrev).toBeNull();
  });
});

describe("computePulse — day progress (multiple of a normal full day)", () => {
  it("computes tokens/cost progress vs the full-day baseline; perMTok stays null", () => {
    const pulse = computePulse({
      current: { tokens: 5_770_000, cost: 4.52 },
      prev: { tokens: 1, cost: 1 },
      trailingAvg: { tokens: 1, cost: 1 },
      trailingFull: { tokens: 3_260_000, cost: 2.13 }, // a "normal full day"
      period: "day",
    });
    expect(pulse.tokens.progress).toBeCloseTo(5_770_000 / 3_260_000, 6); // ~1.77x
    expect(pulse.cost.progress).toBeCloseTo(4.52 / 2.13, 6); // ~2.12x
    expect(pulse.perMTok.progress).toBeNull(); // a rate has no day-total
  });

  it("is null when no full-day baseline is supplied (all metrics)", () => {
    const pulse = computePulse({
      current: { tokens: 2_000_000, cost: 2 },
      trailingAvg: { tokens: 1_000_000, cost: 1 },
      period: "day",
    });
    expect(pulse.tokens.progress).toBeNull();
    expect(pulse.cost.progress).toBeNull();
  });

  it("guards a zero full-day baseline (no Inf)", () => {
    const pulse = computePulse({
      current: { tokens: 2_000_000, cost: 2 },
      trailingFull: { tokens: 0, cost: 0 },
      period: "day",
    });
    expect(pulse.tokens.progress).toBeNull();
    expect(pulse.cost.progress).toBeNull();
  });
});
