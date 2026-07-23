import { describe, expect, it } from "vitest";
import {
  limitIdForLabel,
  getCardLimitWindows,
  getCardTierClasses,
} from "../limitDisplay.jsx";
import { LIMIT_DISPLAY_MODES } from "../../../../hooks/use-limits-display-prefs.js";

const USED = LIMIT_DISPLAY_MODES.USED;
const REMAINING = LIMIT_DISPLAY_MODES.REMAINING;

describe("limitIdForLabel", () => {
  it("maps dashboard provider labels (uppercase / punctuated) to limits ids", () => {
    expect(limitIdForLabel("CLAUDE")).toBe("claude");
    expect(limitIdForLabel("CODEX")).toBe("codex");
    expect(limitIdForLabel("Z.AI")).toBe("zai");
    expect(limitIdForLabel("GitHub Copilot")).toBe("copilot");
    expect(limitIdForLabel("Gemini")).toBe("gemini");
  });

  it("returns null for providers with no quota support", () => {
    expect(limitIdForLabel("OPENCODE")).toBeNull();
    expect(limitIdForLabel("Zed")).toBeNull();
    expect(limitIdForLabel("")).toBeNull();
    expect(limitIdForLabel(undefined)).toBeNull();
  });
});

describe("getCardTierClasses", () => {
  it("assigns the 4 used-tiers at their boundaries", () => {
    expect(getCardTierClasses(49, USED).dot).toContain("oai-gray"); // < 50 neutral
    expect(getCardTierClasses(50, USED).dot).toBe("bg-amber-500");
    expect(getCardTierClasses(74, USED).dot).toBe("bg-amber-500");
    expect(getCardTierClasses(75, USED).dot).toBe("bg-orange-500");
    expect(getCardTierClasses(89, USED).dot).toBe("bg-orange-500");
    expect(getCardTierClasses(90, USED).dot).toBe("bg-red-500");
  });

  it("uses the raw (unrounded) percentage for tier boundaries", () => {
    // 74.6 must stay amber, not round up into the 75 orange band; 89.6 stays orange
    expect(getCardTierClasses(74.6, USED).dot).toBe("bg-amber-500");
    expect(getCardTierClasses(89.6, USED).dot).toBe("bg-orange-500");
  });

  it("mirrors the scale in remaining mode (low remaining = critical)", () => {
    // 8% remaining => 92% used-equivalent => red
    expect(getCardTierClasses(8, REMAINING).dot).toBe("bg-red-500");
    // 95% remaining => 5% used-equivalent => neutral
    expect(getCardTierClasses(95, REMAINING).dot).toContain("oai-gray");
  });
});

describe("getCardLimitWindows", () => {
  it("returns Claude's 5h + 7d from utilization fields", () => {
    const data = {
      configured: true,
      five_hour: { utilization: 82, resets_at: "2999-01-01T00:00:00Z" },
      seven_day: { utilization: 95, resets_at: "2999-01-01T00:00:00Z" },
      seven_day_opus: { utilization: 40, resets_at: "2999-01-01T00:00:00Z" },
    };
    const out = getCardLimitWindows("claude", data, USED);
    expect(out).toHaveLength(2); // tertiary (opus) dropped
    expect(out[0]).toMatchObject({ label: "5h", displayPct: 82 });
    expect(out[1]).toMatchObject({ label: "7d", displayPct: 95 });
  });

  it("drops the 3rd window for providers that have one", () => {
    const data = {
      configured: true,
      primary_window: { used_percent: 61, reset_at: "2999-01-01T00:00:00Z" },
      secondary_window: { used_percent: 42, reset_at: "2999-01-01T00:00:00Z" },
      tertiary_window: { used_percent: 12, reset_at: "2999-01-01T00:00:00Z" },
    };
    expect(getCardLimitWindows("zai", data, USED)).toHaveLength(2);
  });

  it("flips percentages in remaining mode", () => {
    const data = { configured: true, five_hour: { utilization: 82 } };
    expect(getCardLimitWindows("claude", data, REMAINING)[0].displayPct).toBe(18);
  });

  it("keeps the raw percentage (rounding is display-only)", () => {
    const data = { configured: true, five_hour: { utilization: 74.6 } };
    expect(getCardLimitWindows("claude", data, USED)[0].displayPct).toBeCloseTo(74.6);
  });

  it("skips absent windows and unknown providers", () => {
    const data = { configured: true, five_hour: { utilization: 30 } };
    expect(getCardLimitWindows("claude", data, USED)).toHaveLength(1);
    expect(getCardLimitWindows("opencode", data, USED)).toEqual([]);
    expect(getCardLimitWindows("claude", null, USED)).toEqual([]);
  });
});
