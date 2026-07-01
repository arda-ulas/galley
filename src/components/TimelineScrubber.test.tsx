import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TimelineMarker } from "../lib/timeline";
import { TimelineScrubber } from "./TimelineScrubber";

function marker(id: string, position: number): TimelineMarker {
  return { id, position, createdAt: Date.now() };
}

describe("TimelineScrubber", () => {
  it("renders no markers when the list is empty", () => {
    render(<TimelineScrubber markers={[]} />);
    expect(screen.queryAllByTestId("timeline-marker")).toHaveLength(0);
  });

  it("renders one marker element per entry", () => {
    render(
      <TimelineScrubber
        markers={[marker("a", 20), marker("b", 50), marker("c", 80)]}
      />,
    );
    expect(screen.getAllByTestId("timeline-marker")).toHaveLength(3);
  });

  it("always renders the now label", () => {
    render(<TimelineScrubber markers={[]} />);
    expect(screen.getByText("now")).toBeInTheDocument();
  });

  it("renders exactly one marker when given a single entry", () => {
    render(<TimelineScrubber markers={[marker("x", 80)]} />);
    expect(screen.getAllByTestId("timeline-marker")).toHaveLength(1);
  });
});
