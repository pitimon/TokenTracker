import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplitFlapNumber } from "../SplitFlapNumber.jsx";

describe("SplitFlapNumber", () => {
  it("renders a flip card per digit and a separator per comma", () => {
    const { container } = render(<SplitFlapNumber value="16,348,523,038" />);
    // 11 digits → 11 flip cards; 3 commas → 3 separators
    expect(container.querySelectorAll(".tt-flap").length).toBe(11);
    expect(container.querySelectorAll(".tt-flap-sep").length).toBe(3);
  });

  it("exposes the full value to assistive tech", () => {
    const { getByLabelText } = render(<SplitFlapNumber value="9,144,267" />);
    expect(getByLabelText("9,144,267")).toBeInTheDocument();
  });

  it("shows each digit glyph", () => {
    const { container } = render(<SplitFlapNumber value="10,778" />);
    const glyphs = Array.from(container.querySelectorAll(".tt-flap__glyph")).map((el) => el.textContent);
    expect(glyphs).toEqual(["1", "0", "7", "7", "8"]);
  });

  it("renders nothing but an empty row for an empty value", () => {
    const { container } = render(<SplitFlapNumber value="" />);
    expect(container.querySelectorAll(".tt-flap").length).toBe(0);
  });
});
