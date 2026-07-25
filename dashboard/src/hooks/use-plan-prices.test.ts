import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_PRICES_STORAGE_KEY, usePlanPrices } from "./use-plan-prices";

describe("usePlanPrices", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts empty when nothing is stored", () => {
    const { result } = renderHook(() => usePlanPrices());
    expect(result.current.planPrices).toEqual({});
  });

  it("round-trips a price through storage", () => {
    const { result } = renderHook(() => usePlanPrices());
    act(() => result.current.setPlanPrice("claude", 20));
    expect(result.current.planPrices).toEqual({ claude: 20 });
    expect(JSON.parse(window.localStorage.getItem(PLAN_PRICES_STORAGE_KEY)!)).toEqual({
      claude: 20,
    });
  });

  it("clearing a price REMOVES it rather than storing zero", () => {
    // Absent is not zero. A stored 0 would make the card compare usage against
    // a $0 plan, which is infinitely over by construction.
    window.localStorage.setItem(PLAN_PRICES_STORAGE_KEY, JSON.stringify({ claude: 20 }));
    const { result } = renderHook(() => usePlanPrices());
    act(() => result.current.setPlanPrice("claude", null));
    expect(result.current.planPrices).toEqual({});
    expect(JSON.parse(window.localStorage.getItem(PLAN_PRICES_STORAGE_KEY)!)).toEqual({});
  });

  it("drops stored values that are not positive numbers", () => {
    window.localStorage.setItem(
      PLAN_PRICES_STORAGE_KEY,
      JSON.stringify({ claude: 20, codex: 0, kimi: "abc", zed: -5, goose: null }),
    );
    const { result } = renderHook(() => usePlanPrices());
    expect(result.current.planPrices).toEqual({ claude: 20 });
  });

  it("survives corrupt storage instead of throwing", () => {
    window.localStorage.setItem(PLAN_PRICES_STORAGE_KEY, "{not json");
    const { result } = renderHook(() => usePlanPrices());
    expect(result.current.planPrices).toEqual({});
  });

  it("survives storage that is not an object", () => {
    window.localStorage.setItem(PLAN_PRICES_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    const { result } = renderHook(() => usePlanPrices());
    expect(result.current.planPrices).toEqual({});
  });

  it("keeps the value in memory when storage refuses the write", () => {
    // Private-mode or quota-exceeded. Silently reverting under the user is
    // worse than a preference that does not persist.
    const { result } = renderHook(() => usePlanPrices());
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => result.current.setPlanPrice("claude", 20));
    expect(result.current.planPrices).toEqual({ claude: 20 });
    setItem.mockRestore();
  });

  it("normalises the provider key so CLAUDE and claude are one entry", () => {
    const { result } = renderHook(() => usePlanPrices());
    act(() => result.current.setPlanPrice("CLAUDE", 20));
    act(() => result.current.setPlanPrice("claude", 25));
    expect(result.current.planPrices).toEqual({ claude: 25 });
  });
});
