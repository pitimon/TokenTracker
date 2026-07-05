import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

// Thousands separators / decimal point are rendered as thin static glyphs
// between the flip cards, like a real departure board.
const SEPARATORS = new Set([",", ".", " "]);

const isTestEnv =
  (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "")) ||
  (typeof process !== "undefined" &&
    (process.env?.NODE_ENV === "test" || process.env?.VITEST === "true"));

// A single flip card. When `char` changes it plays a short rotateX flip and
// swaps the glyph at the mid-point, so the digit reads as mechanically turning.
function Flap({ char, reduceMotion }) {
  const [shown, setShown] = useState(char);
  const [flipping, setFlipping] = useState(false);
  const prev = useRef(char);

  useEffect(() => {
    if (char === prev.current) return;
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
  }, [char, reduceMotion]);

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
          <Flap key={index} char={char} reduceMotion={reduceMotion} />
        ),
      )}
    </span>
  );
}

export default SplitFlapNumber;
