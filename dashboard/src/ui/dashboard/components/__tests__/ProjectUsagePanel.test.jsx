import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../../../../lib/copy";
import { formatCompactNumber } from "../../../../lib/format";
import { render } from "../../../../test/test-utils";
import { ProjectUsagePanel } from "../ProjectUsagePanel.jsx";

describe("ProjectUsagePanel", () => {
  const entry = {
    project_key: "octo/hello",
    project_ref: "https://github.com/octo/hello",
    total_tokens: 12345,
  };

  beforeEach(() => {
    document.documentElement.classList.add("screenshot-capture");
  });

  afterEach(() => {
    document.documentElement.classList.remove("screenshot-capture");
  });

  it("renders a non-clickable repo card with repository identity and usage", () => {
    // f299a3c0 (v0.11.1) intentionally removed the <a> wrapper from
    // ProjectUsagePanel: synthetic source-only rows had bogus URLs
    // (https://codex.ai etc.) that opened unrelated websites. The card is
    // now display-only — regression-test the no-link contract here.
    const { container } = render(<ProjectUsagePanel entries={[entry]} />);

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText(/★/)).toBeInTheDocument();
    expect(container.querySelector("a[href]")).toBeNull();
  });

  it("prefers total tokens when billable tokens are zero", () => {
    const entryWithBillableZero = {
      project_key: "octo/alpha",
      project_ref: "https://github.com/octo/alpha",
      total_tokens: 12345,
      billable_total_tokens: 0,
    };

    render(<ProjectUsagePanel entries={[entryWithBillableZero]} />);

    const expected = formatCompactNumber("12345", {
      thousandSuffix: copy("shared.unit.thousand_abbrev"),
      millionSuffix: copy("shared.unit.million_abbrev"),
      billionSuffix: copy("shared.unit.billion_abbrev"),
      decimals: 1,
    });

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("defaults to showing the top 10 projects", () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      project_key: `octo/repo-${String(index + 1).padStart(2, "0")}`,
      project_ref: `https://github.com/octo/repo-${String(index + 1).padStart(2, "0")}`,
      total_tokens: 12 - index,
    }));

    render(<ProjectUsagePanel entries={entries} />);

    expect(screen.getByText("repo-01")).toBeInTheDocument();
    expect(screen.getByText("repo-10")).toBeInTheDocument();
    expect(screen.queryByText("repo-11")).not.toBeInTheDocument();
  });

  it("closes the limit popup on Escape", async () => {
    const limitAria = copy("dashboard.projects.limit_aria");
    const onLimitChange = vi.fn();
    const user = userEvent.setup();

    render(<ProjectUsagePanel entries={[entry]} onLimitChange={onLimitChange} />);

    await act(async () => {
      await user.click(screen.getByLabelText(limitAria));
    });
    expect(screen.getByRole("listbox", { name: limitAria })).toBeVisible();

    await act(async () => {
      await user.keyboard("{Escape}");
    });
    expect(screen.queryByRole("listbox", { name: limitAria })).not.toBeInTheDocument();
  });
});
