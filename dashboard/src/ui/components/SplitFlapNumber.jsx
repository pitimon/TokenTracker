import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

// Thousands separators / decimal point are rendered as thin static glyphs
// between the flip cards, like a real departure board.
const SEPARATORS = new Set([",", ".", " "]);

const isTestEnv =
  (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "")) ||
  (typeof process !== "undefined" &&
    (process.env?.NODE_ENV === "test" || process.env?.VITEST === "true"));

// A single flip card. On mount it flaps in from blank to its glyph (staggered
// by `index` so the row settles left-to-right like a departure board); on later
// `char` changes it plays the same short rotateX flip and swaps at the midpoint.
function Flap({ char, reduceMotion, index }) {
  const [shown, setShown] = useState(reduceMotion ? char : "");
  const [flipping, setFlipping] = useState(false);
  const prev = useRef(char);
  const mounted = useRef(false);

  useEffect(() => {
    // Mount: cascade the board into place (skip when motion is reduced).
    if (!mounted.current) {
      mounted.current = true;
      prev.current = char;
      if (reduceMotion) {
        setShown(char);
        return undefined;
      }
      const delay = Math.min(index * 45, 520);
      const start = setTimeout(() => setFlipping(true), delay);
      const swap = setTimeout(() => setShown(char), delay + 130);
      const done = setTimeout(() => setFlipping(false), delay + 300);
      return () => {
        clearTimeout(start);
        clearTimeout(swap);
        clearTimeout(done);
      };
    }
    // Later updates: flip only the digits that actually changed.
    if (char === prev.current) return undefined;
    prev.current = char;
    if (reduceMotion) {
      setShown(char);
      return undefined;
    }
    setFlipping(true);
    const swap = setTimeout(() => setShown(char), 130);
    const done = setTimeout(() => setFlipping(false), 300);
    return () => {
      clearTimeout(swap);
      clearTimeout(done);
    };
  }, [char, reduceMotion, index]);

  return (
    <span className={`tt-flap${flipping ? " tt-flap--flip" : ""}`} aria-hidden="true">
      <span className="tt-flap__glyph">{shown}</span>
    </span>
  );
}

// Split-flap ("departure board") number readout. Digits/letters get flip cards;
// separators stay inline. The full value is exposed to assistive tech via
// aria-label while the cards themselves are decorative.
export function SplitFlapNumber({ value, fontSize = 56, className = "" }) {
  const reduceMotion = useReducedMotion() || isTestEnv;
  const text = String(value ?? "");
  const chars = Array.from(text);

  return (
    <span
      className={`tt-flaprow ${className}`}
      // Scale with the container so a long total (e.g. 11 digits) never
      // overflows the hero card on narrower screens, capped at `fontSize`.
      // Needs a `container-type: inline-size` ancestor.
      style={{ fontSize: `clamp(30px, 9cqi, ${fontSize}px)` }}
      role="text"
      aria-label={text}
    >
      {chars.map((char, index) =>
        SEPARATORS.has(char) ? (
          <span key={index} className="tt-flap-sep" aria-hidden="true">
            {char}
          </span>
        ) : (
          <Flap key={index} char={char} reduceMotion={reduceMotion} index={index} />
        ),
      )}
    </span>
  );
}

export default SplitFlapNumber;
