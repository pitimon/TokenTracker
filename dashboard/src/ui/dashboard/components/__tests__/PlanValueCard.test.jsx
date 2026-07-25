import { fireEvent, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../../../../test/test-utils";
import { PlanValueCard } from "../PlanValueCard.jsx";

// Copy that interpolates the way the real registry does, so the assertions see
// the sentence a user would.
function copy(key, vars = {}) {
  const text = {
    "dashboard.plan_value.title": "Plan vs list price",
    "dashboard.plan_value.empty": "Enter what you pay for a plan to compare it against list price.",
    "dashboard.plan_value.headline": "{{plan}}/mo of plans · {{list}} of usage at API list price",
    "dashboard.plan_value.row": "{{plan}}/mo · {{list}} at list price",
    "dashboard.plan_value.floor_note":
      "At least this much — some usage could not be priced ({{models}}).",
    "dashboard.plan_value.disclaimer":
      "List-price-equivalent for this window — not a bill you would have paid.",
    "dashboard.plan_value.input_aria": "Monthly plan price for {{source}}",
  }[key];
  return String(text ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars[name] ?? ""));
}

const claudeSource = (over = {}) => ({
  source: "claude",
  totals: { total_cost_usd: "47.000000" },
  models: [{ model: "claude-sonnet-5", pricing_tier: "litellm:exact" }],
  ...over,
});

function card(props = {}) {
  return render(<PlanValueCard copy={copy} sources={[claudeSource()]} {...props} />);
}

describe("PlanValueCard", () => {
  it("prompts rather than guessing when no plan price is set", () => {
    card({ planPrices: {} });
    expect(screen.getByText(/Enter what you pay/)).toBeTruthy();
  });

  it("shows both sides of the comparison", () => {
    card({ planPrices: { claude: 20 } });
    expect(screen.getByText(/\$20\.00\/mo of plans · \$47\.00 of usage/)).toBeTruthy();
  });

  it("never says saved, wasted or worth it", () => {
    // The number is easy to over-claim, and this is the assertion that stops a
    // future edit from turning it into "you saved $27".
    const { container } = card({ planPrices: { claude: 20 } });
    expect(container.textContent).not.toMatch(/saved|savings|wasted|worth it|bargain/i);
  });

  it("reads identically when usage is BELOW the plan price", () => {
    // Under-usage is a downgrade signal, not a failure, so it gets no different
    // treatment — same sentence, different numbers.
    const { container } = render(
      <PlanValueCard
        copy={copy}
        sources={[claudeSource({ totals: { total_cost_usd: "3.00" } })]}
        planPrices={{ claude: 20 }}
      />,
    );
    expect(screen.getByText(/\$20\.00\/mo of plans · \$3\.00 of usage/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/over|under|too much|too little/i);
  });

  it("always carries the list-price-equivalent disclaimer", () => {
    card({ planPrices: { claude: 20 } });
    expect(screen.getByText(/not a bill you would have paid/)).toBeTruthy();
  });

  it("calls the figure a floor and names the models when pricing is incomplete", () => {
    render(
      <PlanValueCard
        copy={copy}
        sources={[
          claudeSource({
            models: [
              { model: "claude-sonnet-5", pricing_tier: "litellm:exact" },
              { model: "mystery-model", pricing_tier: "miss" },
            ],
          }),
        ]}
        planPrices={{ claude: 20 }}
      />,
    );
    expect(screen.getByText(/At least this much/)).toBeTruthy();
    expect(screen.getByText(/mystery-model/)).toBeTruthy();
  });

  it("omits the floor note when everything priced exactly", () => {
    card({ planPrices: { claude: 20 } });
    expect(screen.queryByText(/At least this much/)).toBeNull();
  });

  it("rolls up across providers and lists each one", () => {
    render(
      <PlanValueCard
        copy={copy}
        sources={[
          claudeSource(),
          { source: "codex", totals: { total_cost_usd: "5.00" }, models: [] },
        ]}
        planPrices={{ claude: 20, codex: 25 }}
      />,
    );
    expect(screen.getByText(/\$45\.00\/mo of plans · \$52\.00 of usage/)).toBeTruthy();
    expect(screen.getByText("claude")).toBeTruthy();
    expect(screen.getByText("codex")).toBeTruthy();
  });

  it("ignores a provider the user has not priced", () => {
    // Folding its usage in would inflate the list-price side against a smaller
    // plan side, which is the flattering direction.
    render(
      <PlanValueCard
        copy={copy}
        sources={[
          claudeSource(),
          { source: "codex", totals: { total_cost_usd: "500.00" }, models: [] },
        ]}
        planPrices={{ claude: 20 }}
      />,
    );
    expect(screen.getByText(/\$20\.00\/mo of plans · \$47\.00 of usage/)).toBeTruthy();
    expect(screen.queryByText("codex")).toBeNull();
  });
});


describe("PlanValueCard — entering the price", () => {
  it("offers an input in the EMPTY state, which is the only way out of it", () => {
    // A card that says "enter a price" with nowhere to enter it is not a
    // feature. The empty state is exactly where the input matters most.
    render(
      <PlanValueCard copy={copy} sources={[claudeSource()]} planPrices={{}} onPlanPriceChange={() => {}} />,
    );
    expect(screen.getByLabelText("Monthly plan price for claude")).toBeTruthy();
  });

  it("reports the number the user typed", () => {
    const onPlanPriceChange = vi.fn();
    render(
      <PlanValueCard
        copy={copy}
        sources={[claudeSource()]}
        planPrices={{}}
        onPlanPriceChange={onPlanPriceChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Monthly plan price for claude"), {
      target: { value: "20" },
    });
    expect(onPlanPriceChange).toHaveBeenCalledWith("claude", 20);
  });

  it("clearing the field reports null, not zero", () => {
    // Zero is a plan price the comparison would divide by. Absent is not zero.
    const onPlanPriceChange = vi.fn();
    render(
      <PlanValueCard
        copy={copy}
        sources={[claudeSource()]}
        planPrices={{ claude: 20 }}
        onPlanPriceChange={onPlanPriceChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Monthly plan price for claude"), {
      target: { value: "" },
    });
    expect(onPlanPriceChange).toHaveBeenCalledWith("claude", null);
  });

  it("shows an input for a provider with usage but no price yet", () => {
    render(
      <PlanValueCard
        copy={copy}
        sources={[claudeSource(), { source: "codex", totals: { total_cost_usd: "5.00" }, models: [] }]}
        planPrices={{ claude: 20 }}
        onPlanPriceChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Monthly plan price for codex")).toBeTruthy();
  });

  it("renders read-only when no handler is supplied", () => {
    render(<PlanValueCard copy={copy} sources={[claudeSource()]} planPrices={{ claude: 20 }} />);
    expect(screen.queryByLabelText("Monthly plan price for claude")).toBeNull();
  });
});
