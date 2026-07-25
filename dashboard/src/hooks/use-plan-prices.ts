import { useCallback, useEffect, useState } from "react";

// What the user pays each provider, per month, entered by them.
//
// Stored in localStorage like every other preference here and NEVER sent
// anywhere — there is no plan catalogue to maintain and go stale, and a plan
// price is exactly the kind of thing this product promises not to transmit.
//
// The value is a plain map so a provider the user has not priced is simply
// absent. Absent is not zero: treating it as zero would make every unpriced
// provider look infinitely over its plan.

const STORAGE_KEY = "tokentracker.plan_prices.v1";

export type PlanPrices = Record<string, number>;

function readStored(): PlanPrices {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: PlanPrices = {};
    for (const [source, value] of Object.entries(parsed)) {
      const price = Number(value);
      // Anything that is not a positive finite number is dropped rather than
      // coerced. A stored "0" or "abc" must not become a plan the card compares
      // against.
      if (Number.isFinite(price) && price > 0) out[String(source).toLowerCase()] = price;
    }
    return out;
  } catch {
    // Corrupt or unreadable storage is the same as none set.
    return {};
  }
}

export function usePlanPrices() {
  const [prices, setPrices] = useState<PlanPrices>({});

  useEffect(() => {
    setPrices(readStored());
  }, []);

  const setPlanPrice = useCallback((source: string, price: number | null) => {
    setPrices((current) => {
      const key = String(source || "").toLowerCase();
      if (!key) return current;
      const next = { ...current };
      const value = Number(price);
      if (Number.isFinite(value) && value > 0) next[key] = value;
      else delete next[key];
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked — keep the in-memory value so the card still
        // works this session rather than silently reverting under the user.
      }
      return next;
    });
  }, []);

  return { planPrices: prices, setPlanPrice, PLAN_PRICES_STORAGE_KEY: STORAGE_KEY };
}

export { STORAGE_KEY as PLAN_PRICES_STORAGE_KEY };
