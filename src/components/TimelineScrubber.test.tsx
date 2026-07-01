import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("calls onMarkerClick with the marker id when a marker is clicked", () => {
    const onMarkerClick = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("snap-1", 30), marker("snap-2", 70)]}
        onMarkerClick={onMarkerClick}
      />,
    );

    const [first] = screen.getAllByTestId("timeline-marker");
    fireEvent.click(first);

    expect(onMarkerClick).toHaveBeenCalledOnce();
    expect(onMarkerClick).toHaveBeenCalledWith("snap-1");
  });

  it("marks the selected marker with data-selected", () => {
    render(
      <TimelineScrubber
        markers={[marker("a", 20), marker("b", 50)]}
        selectedMarkerId="b"
      />,
    );

    const allMarkers = screen.getAllByTestId("timeline-marker");
    expect(allMarkers[0]).not.toHaveAttribute("data-selected");
    expect(allMarkers[1]).toHaveAttribute("data-selected", "true");
  });

  it("does not call onMarkerClick when no handler is provided", () => {
    render(<TimelineScrubber markers={[marker("z", 50)]} />);
    // Should not throw when marker clicked with no handler
    expect(() =>
      fireEvent.click(screen.getByTestId("timeline-marker")),
    ).not.toThrow();
  });
});
