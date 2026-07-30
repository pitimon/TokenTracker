import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { copy } from "../../../../lib/copy";
import { IngestHealthNotice } from "../IngestHealthNotice.jsx";

function makeIngestHealth(overrides = {}) {
  return {
    transcript_suppressed: {
      supported: true,
      checked: true,
      count: 2,
      models: ["glm-5-turbo"],
      reason: null,
      ...overrides,
    },
    checked_at: "2026-07-29T23:40:00.000Z",
  };
}

describe("IngestHealthNotice", () => {
  it("renders the notice when suppressed sessions were found", () => {
    render(<IngestHealthNotice ingestHealth={makeIngestHealth()} />);

    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(copy("dashboard.ingestHealth.suppressed.title"))).toBeInTheDocument();
    expect(
      screen.getByText(
        copy("dashboard.ingestHealth.suppressed.body", { count: 2, models: "glm-5-turbo" }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(copy("dashboard.ingestHealth.suppressed.remedy")),
    ).toBeInTheDocument();
  });

  it("renders nothing when count is 0", () => {
    const { container } = render(
      <IngestHealthNotice ingestHealth={makeIngestHealth({ count: 0 })} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("renders nothing when checked is false", () => {
    const { container } = render(
      <IngestHealthNotice
        ingestHealth={makeIngestHealth({ checked: false, count: 0, reason: "unsupported_platform" })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("renders nothing when ingestHealth is null", () => {
    const { container } = render(<IngestHealthNotice ingestHealth={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  // `--model` is optional, so the detector can legitimately report a count with
  // no models. The model-bearing sentence would render an empty "()" here.
  it("uses the no-model sentence when no model could be identified", () => {
    render(<IngestHealthNotice ingestHealth={makeIngestHealth({ count: 1, models: [] })} />);

    const note = screen.getByRole("note");
    expect(note.textContent).toContain("1 running Claude CLI session(s) write no session transcript");
    expect(note.textContent).not.toContain("()");
  });

  // Asserted against literal text on purpose. Every other assertion here builds
  // its expectation with copy(), which cannot fail when the CSV row itself is
  // malformed — both sides read the same broken value. This sentence contains a
  // comma, so an unquoted copy.csv field silently truncates it at "this," and
  // validate:copy still passes, because all six required columns stay non-empty.
  it("renders the remedy sentence past its comma", () => {
    render(<IngestHealthNotice ingestHealth={makeIngestHealth()} />);

    expect(screen.getByRole("note").textContent).toContain(
      "The tool that launched Claude chose this, not TokenTracker. Run tokentracker doctor for details.",
    );
  });
});
