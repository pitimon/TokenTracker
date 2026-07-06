import { describe, expect, it } from "vitest";
import { deviationMark, toneVar } from "./pulse-mark";

describe("deviationMark — usage (value-neutral)", () => {
  it("small rise: neutral tone, up side, magnitude on the 0–200% half-scale", () => {
    const m = deviationMark(0.55, "usage");
    expect(m).toMatchObject({ hasBar: true, side: "up", tone: "neutral", labelText: "+55%", arrow: null });
    expect(m.widthPct).toBeCloseTo((0.55 / 2) * 50, 6); // 13.75
  });

  it("large swing (>=75%) escalates to the stronger neutral tone", () => {
    expect(deviationMark(1.42, "usage").tone).toBe("neutral-strong");
    expect(deviationMark(-0.9, "usage").tone).toBe("neutral-strong");
  });

  it("a drop is visible: down side, minus label, still neutral (no good/bad)", () => {
    const m = deviationMark(-0.42, "usage");
    expect(m).toMatchObject({ side: "down", tone: "neutral", labelText: "−42%", arrow: null });
  });

  it("caps the bar length at ±200%", () => {
    expect(deviationMark(3, "usage").widthPct).toBe(50); // min(3,2)/2*50
    expect(deviationMark(-5, "usage").widthPct).toBe(50);
  });
});

describe("deviationMark — price (value verdict)", () => {
  it("pricier ▲ = bad, cheaper ▼ = good, both carry an arrow", () => {
    expect(deviationMark(0.19, "price")).toMatchObject({ tone: "bad", arrow: "▲", labelText: "+19%" });
    expect(deviationMark(-0.08, "price")).toMatchObject({ tone: "good", arrow: "▼", labelText: "−8%" });
  });
});

describe("deviationMark — guards", () => {
  it("missing delta → no bar, em-dash", () => {
    expect(deviationMark(null, "usage")).toMatchObject({ hasBar: false, tone: null, labelText: "—", arrow: null });
    expect(deviationMark(undefined, "price").hasBar).toBe(false);
    expect(deviationMark(NaN, "usage").hasBar).toBe(false);
  });

  it("flat (<0.5%) → no bar, 0% (no arrow even for price)", () => {
    const m = deviationMark(0.002, "price");
    expect(m).toMatchObject({ hasBar: false, labelText: "0%", arrow: null });
  });
});

describe("toneVar", () => {
  it("maps each tone to its CSS var; null tone → null", () => {
    expect(toneVar("neutral")).toBe("var(--pulse-neutral)");
    expect(toneVar("neutral-strong")).toBe("var(--pulse-neutral-strong)");
    expect(toneVar("good")).toBe("var(--pulse-good)");
    expect(toneVar("bad")).toBe("var(--pulse-bad)");
    expect(toneVar(null)).toBeNull();
  });
});
