import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  LimitChips,
  limitIdForLabel,
  getCardLimitWindows,
  getCardTierClasses,
  getWindowCounts,
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

describe("getWindowCounts", () => {
  const win = { used_percent: 52.7, used: 158, limit: 300, reset_at: null };

  it("reports consumed units in Used mode and remaining ones in Remaining mode", () => {
    // The whole point of the counts: "142 left" is a decision, "47% left" is a
    // calculation. The flip has to follow the mode toggle or one of the two
    // readings is a lie.
    expect(getWindowCounts(win, USED)).toEqual({ used: 158, limit: 300 });
    expect(getWindowCounts(win, REMAINING)).toEqual({ used: 142, limit: 300 });
  });

  it("returns null for providers that report no countable units", () => {
    expect(getWindowCounts({ used_percent: 52.7 }, USED)).toBeNull();
    expect(getWindowCounts({ used_percent: 10, used: 5 }, USED)).toBeNull();
    expect(getWindowCounts({ used_percent: 10, limit: 0, used: 0 }, USED)).toBeNull();
    expect(getWindowCounts(null, USED)).toBeNull();
  });

  it("never renders an impossible count from an unclamped payload", () => {
    // The current server clamps, but a newer dashboard talks to whatever server
    // is installed. Codex QA on PR #98 found that clamping only the low end
    // lets BOTH directions overflow: over-quota renders "312/300" in Used mode,
    // and a negative `used` renders "312/300" in Remaining mode.
    expect(getWindowCounts({ used: 312, limit: 300 }, USED)).toEqual({ used: 300, limit: 300 });
    expect(getWindowCounts({ used: 312, limit: 300 }, REMAINING)).toEqual({ used: 0, limit: 300 });
    expect(getWindowCounts({ used: -12, limit: 300 }, REMAINING)).toEqual({ used: 300, limit: 300 });
    expect(getWindowCounts({ used: -12, limit: 300 }, USED)).toEqual({ used: 0, limit: 300 });
  });
});

describe("getCardLimitWindows with counts", () => {
  const copilot = {
    primary_window: { used_percent: 52.7, used: 158, limit: 300, reset_at: null },
    secondary_window: { used_percent: 20, reset_at: null },
  };

  it("attaches counts only to the window that has them", () => {
    const windows = getCardLimitWindows("copilot", copilot, USED);
    expect(windows).toHaveLength(2);
    expect(windows[0].counts).toEqual({ used: 158, limit: 300 });
    expect(windows[1].counts).toBeNull();
    // The percentage is still carried — the chip falls back to it, and the
    // severity tier is computed from it either way.
    expect(windows[0].displayPct).toBeCloseTo(52.7);
  });

  it("flips the counts with the percentage in Remaining mode", () => {
    const [premium] = getCardLimitWindows("copilot", copilot, REMAINING);
    expect(premium.counts).toEqual({ used: 142, limit: 300 });
    expect(premium.displayPct).toBeCloseTo(47.3);
  });
});


describe("LimitChips — the three states a provider can be in", () => {
  function chips(codex) {
    return render(<LimitChips label="CODEX" usageLimits={{ codex }} />);
  }

  it("renders nothing when the provider is not configured", () => {
    // Correct: no credential means no quota to report and nothing broken. A
    // status line here would put a permanent message under a tool the user does
    // not even use.
    const { container } = chips({ configured: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders a status line when the fetch failed", () => {
    chips({ configured: true, error: "Codex API returned 500" });
    expect(screen.getByText(/Codex API returned 500/)).toBeTruthy();
  });

  it("renders the NOTICE when there is no error and no windows", () => {
    // The state that did not exist. issue 52 asked for "a neutral empty state
    // instead of a red Fetch failed"; with no error and no windows the
    // component fell through to `return null` and the chip disappeared —
    // which issue 105 records as worse than never having had a chip.
    chips({
      configured: true,
      error: null,
      notice: "No usage data for this sign-in. Run `codex` to sign in again.",
      primary_window: null,
      secondary_window: null,
    });
    expect(screen.getByText(/sign in again/)).toBeTruthy();
  });

  it("still renders nothing when there is no error, no windows AND no notice", () => {
    // The old behaviour, kept deliberately: a provider with genuinely nothing to
    // say should not occupy space. The fix is that a FAILURE now always carries
    // either an error or a notice, so it never lands here.
    const { container } = chips({
      configured: true,
      error: null,
      primary_window: null,
      secondary_window: null,
    });
    expect(container.firstChild).toBeNull();
  });
});
