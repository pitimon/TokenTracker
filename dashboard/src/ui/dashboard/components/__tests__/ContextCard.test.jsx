import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextCard } from "../ContextCard.jsx";

// Stub the data-fetching panel so the card's selection/order logic is what's
// under test, not the breakdown fetch. Expose source + referenceTotalTokens
// via data attributes for assertions.
vi.mock("../ContextBreakdownPanel.jsx", () => ({
  ContextBreakdownPanel: (props) => (
    <div
      data-testid="ctx-panel"
      data-source={props.source}
      data-ref={String(props.referenceTotalTokens)}
    />
  ),
}));

function provider(label, usage, { source } = {}) {
  return { label, source: source ?? label, usage, models: [{ id: `${label}-m`, name: `${label}-model` }] };
}

function panels() {
  return screen.queryAllByTestId("ctx-panel");
}

describe("ContextCard", () => {
  it("renders one panel per context-capable source, ordered by usage desc", () => {
    render(
      <ContextCard
        from="2026-05-01"
        to="2026-05-02"
        fleetData={[
          provider("claude", 21_000_000),
          provider("codex", 33_000_000),
          provider("gemini", 50_000_000), // no context source → must be excluded
        ]}
      />,
    );
    const rendered = panels();
    expect(rendered).toHaveLength(2);
    // codex usage (33M) > claude (21M) → codex first
    expect(rendered.map((el) => el.dataset.source)).toEqual(["codex", "claude"]);
    // multi mode shows a provider header per panel
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("excludes providers without a context source (gemini/copilot)", () => {
    render(
      <ContextCard
        from="2026-05-01"
        to="2026-05-02"
        fleetData={[provider("gemini", 10_000_000), provider("copilot", 5_000_000)]}
      />,
    );
    expect(panels()).toHaveLength(0);
  });

  it("dedupes to the largest provider per source", () => {
    render(
      <ContextCard
        from="2026-05-01"
        to="2026-05-02"
        fleetData={[
          provider("claude", 5_000_000),
          provider("claude", 12_000_000),
        ]}
      />,
    );
    const rendered = panels();
    expect(rendered).toHaveLength(1);
    // keeps the larger usage as the reference total
    expect(rendered[0].dataset.ref).toBe("12000000");
  });

  it("renders a single panel without the multi-column grid when one source qualifies", () => {
    const { container } = render(
      <ContextCard from="2026-05-01" to="2026-05-02" fleetData={[provider("claude", 8_000_000)]} />,
    );
    expect(panels()).toHaveLength(1);
    // single mode: no per-provider header, no 2-col grid
    expect(screen.queryByText("Claude")).not.toBeInTheDocument();
    expect(container.querySelector(".lg\\:grid-cols-2")).toBeNull();
  });

  it("renders nothing when no provider qualifies", () => {
    const { container } = render(<ContextCard from="2026-05-01" to="2026-05-02" fleetData={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
