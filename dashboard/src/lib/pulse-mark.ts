// Pure presentation logic for the Pulse deviation bars — kept out of the JSX
// so the magnitude/direction/tone rules are unit-testable. The component only
// maps a tone to a CSS var and a side to left/right.

export type MarkKind = "usage" | "price";

export interface DeviationMark {
  hasBar: boolean; // false when the delta is missing or flat (no bar drawn)
  side: "up" | "down" | null; // above / below the "normal" centre line
  widthPct: number; // 0..50 — length within one half of the 0–200% track
  tone: "neutral" | "neutral-strong" | "good" | "bad" | null;
  labelText: string; // "+55%" | "−42%" | "0%" | "—"
  arrow: "▲" | "▼" | null; // price metric only (value verdict)
}

const CAP_FRACTION = 2; // a bar maxes out at ±200% from "normal"
const STRONG_THRESHOLD = 0.75; // usage swing this large gets the stronger tone
const FLAT_THRESHOLD = 0.005; // below this reads as flat — no bar

// delta is a fraction (0.55 = +55%). kind picks the colour job:
// usage = value-neutral (neutral / neutral-strong by magnitude); price = a
// verdict (pricier = bad, cheaper = good) and always carries an arrow.
export function deviationMark(
  delta: number | null | undefined,
  kind: MarkKind,
): DeviationMark {
  const has = typeof delta === "number" && Number.isFinite(delta);
  if (!has) {
    return { hasBar: false, side: null, widthPct: 0, tone: null, labelText: "—", arrow: null };
  }
  if (Math.abs(delta) < FLAT_THRESHOLD) {
    return { hasBar: false, side: null, widthPct: 0, tone: null, labelText: "0%", arrow: null };
  }
  const up = delta > 0;
  const widthPct = (Math.min(Math.abs(delta), CAP_FRACTION) / CAP_FRACTION) * 50;
  let tone: DeviationMark["tone"];
  if (kind === "price") {
    tone = up ? "bad" : "good";
  } else {
    tone = Math.abs(delta) >= STRONG_THRESHOLD ? "neutral-strong" : "neutral";
  }
  const pct = Math.abs(Math.round(delta * 100));
  return {
    hasBar: true,
    side: up ? "up" : "down",
    widthPct,
    tone,
    labelText: `${up ? "+" : "−"}${pct}%`,
    arrow: kind === "price" ? (up ? "▲" : "▼") : null,
  };
}

// Map a tone to its CSS custom property (the component sets the bar background).
export function toneVar(tone: DeviationMark["tone"]): string | null {
  switch (tone) {
    case "neutral":
      return "var(--pulse-neutral)";
    case "neutral-strong":
      return "var(--pulse-neutral-strong)";
    case "good":
      return "var(--pulse-good)";
    case "bad":
      return "var(--pulse-bad)";
    default:
      return null;
  }
}
