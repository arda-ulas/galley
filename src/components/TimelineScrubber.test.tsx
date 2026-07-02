import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TimelineMarker } from "../lib/timeline";
import { TimelineScrubber } from "./TimelineScrubber";

function marker(id: string, position: number, createdAt = Date.now()): TimelineMarker {
  return { id, position, createdAt };
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
    expect(() =>
      fireEvent.click(screen.getByTestId("timeline-marker")),
    ).not.toThrow();
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it("renders markers as buttons", () => {
    render(
      <TimelineScrubber markers={[marker("a", 30), marker("b", 70)]} />,
    );
    // button role is implicit from the <button> element
    const buttons = screen.getAllByRole("button");
    // The Share button from AppShell is NOT rendered here; only marker buttons
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("marker aria-label includes a recognisable time description", () => {
    // Use a timestamp that is just a few seconds old so formatRelative returns "just now"
    const recentTs = Date.now() - 5_000;
    render(<TimelineScrubber markers={[marker("m", 50, recentTs)]} />);

    const btn = screen.getByTestId("timeline-marker");
    expect(btn).toHaveAttribute("aria-label", "View snapshot from just now");
  });

  it("selected marker exposes aria-current", () => {
    render(
      <TimelineScrubber
        markers={[marker("x", 20), marker("y", 60)]}
        selectedMarkerId="y"
      />,
    );

    const [first, second] = screen.getAllByTestId("timeline-marker");
    expect(first).not.toHaveAttribute("aria-current");
    expect(second).toHaveAttribute("aria-current", "true");
  });

  // ── Rail-click / nearest selection ────────────────────────────────────────

  it("calls onSelectNearest with the nearest marker id when rail is clicked", () => {
    const onSelectNearest = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("left", 20), marker("right", 70)]}
        onSelectNearest={onSelectNearest}
      />,
    );

    const rail = screen.getByTestId("timeline-rail");
    // Simulate a 400px-wide rail so we can compute a meaningful click percentage
    vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 400, width: 400,
      top: 0, bottom: 32, height: 32,
      x: 0, y: 0, toJSON: () => ({}),
    });

    // clientX=60 → 15% along rail; left(20%) is closer than right(70%)
    fireEvent.click(rail, { clientX: 60 });
    expect(onSelectNearest).toHaveBeenCalledOnce();
    expect(onSelectNearest).toHaveBeenCalledWith("left");
  });

  it("does not call onSelectNearest when rail has no markers", () => {
    const onSelectNearest = vi.fn();
    render(<TimelineScrubber markers={[]} onSelectNearest={onSelectNearest} />);
    fireEvent.click(screen.getByTestId("timeline-rail"));
    expect(onSelectNearest).not.toHaveBeenCalled();
  });

  it("marker click fires onMarkerClick but not onSelectNearest", () => {
    const onMarkerClick = vi.fn();
    const onSelectNearest = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("m", 40)]}
        onMarkerClick={onMarkerClick}
        onSelectNearest={onSelectNearest}
      />,
    );

    fireEvent.click(screen.getByTestId("timeline-marker"));
    expect(onMarkerClick).toHaveBeenCalledWith("m");
    expect(onSelectNearest).not.toHaveBeenCalled();
  });

  // ── Pointer drag ──────────────────────────────────────────────────────────

  function mockRailRect(rail: HTMLElement) {
    vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 400, width: 400,
      top: 0, bottom: 32, height: 32,
      x: 0, y: 0, toJSON: () => ({}),
    });
  }

  it("pointer down on rail immediately selects nearest marker", () => {
    const onSelectNearest = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("left", 20), marker("right", 70)]}
        onSelectNearest={onSelectNearest}
      />,
    );
    const rail = screen.getByTestId("timeline-rail");
    mockRailRect(rail);

    // clientX=60 → 15% along 400px rail; left(20%) closer than right(70%)
    fireEvent.pointerDown(rail, { clientX: 60, pointerId: 1 });
    expect(onSelectNearest).toHaveBeenCalledOnce();
    expect(onSelectNearest).toHaveBeenCalledWith("left");
  });

  it("pointer up stops drag — subsequent pointer move is ignored", () => {
    const onSelectNearest = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("a", 30), marker("b", 70)]}
        onSelectNearest={onSelectNearest}
      />,
    );
    const rail = screen.getByTestId("timeline-rail");
    mockRailRect(rail);

    fireEvent.pointerDown(rail, { clientX: 100, pointerId: 1 }); // selects "a" at 30%
    fireEvent.pointerUp(rail, { pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 300, pointerId: 1 }); // ignored — not dragging
    expect(onSelectNearest).toHaveBeenCalledTimes(1);
    expect(onSelectNearest).toHaveBeenCalledWith("a");
  });

  it("pointer down on empty rail does nothing", () => {
    const onSelectNearest = vi.fn();
    render(<TimelineScrubber markers={[]} onSelectNearest={onSelectNearest} />);
    fireEvent.pointerDown(screen.getByTestId("timeline-rail"), { clientX: 100, pointerId: 1 });
    expect(onSelectNearest).not.toHaveBeenCalled();
  });

  // ── Rail a11y: tabIndex / slider role / ARIA values ──────────────────────

  it("empty rail has tabIndex -1 — not an inert tab stop", () => {
    render(<TimelineScrubber markers={[]} />);
    expect(screen.getByTestId("timeline-rail")).toHaveAttribute("tabindex", "-1");
  });

  it("rail with markers has tabIndex 0 and slider role", () => {
    render(<TimelineScrubber markers={[marker("a", 50)]} />);
    const rail = screen.getByTestId("timeline-rail");
    expect(rail).toHaveAttribute("tabindex", "0");
    expect(rail).toHaveAttribute("role", "slider");
    expect(rail).toHaveAttribute("aria-label", "Session timeline");
  });

  it("rail aria values in live mode reflect Now / full range", () => {
    render(
      <TimelineScrubber markers={[marker("a", 20), marker("b", 70)]} />,
    );
    const rail = screen.getByTestId("timeline-rail");
    expect(rail).toHaveAttribute("aria-valuemin", "0");
    expect(rail).toHaveAttribute("aria-valuemax", "2");
    expect(rail).toHaveAttribute("aria-valuenow", "2");
    expect(rail).toHaveAttribute("aria-valuetext", "Now");
  });

  it("oldest snapshot aria-valuenow equals 0", () => {
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        selectedMarkerId="old"
      />,
    );
    const rail = screen.getByTestId("timeline-rail");
    // "old" sorts first (position 20 < 70) → sorted index 0 → aria-valuenow=0
    expect(rail).toHaveAttribute("aria-valuenow", "0");
    expect(rail).toHaveAttribute("aria-valuetext", "Snapshot 1 of 2");
  });

  it("newest snapshot aria-valuenow equals markers.length - 1 (distinct from live)", () => {
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        selectedMarkerId="new"
      />,
    );
    const rail = screen.getByTestId("timeline-rail");
    // "new" sorts last (index 1 = N-1 = 1) → aria-valuenow=1; live would be 2
    expect(rail).toHaveAttribute("aria-valuenow", "1");
    expect(rail).toHaveAttribute("aria-valuetext", "Snapshot 2 of 2");
  });

  it("empty rail has no slider role or aria-label", () => {
    render(<TimelineScrubber markers={[]} />);
    const rail = screen.getByTestId("timeline-rail");
    expect(rail).not.toHaveAttribute("role");
    expect(rail).not.toHaveAttribute("aria-label");
  });

  // ── Keyboard navigation ───────────────────────────────────────────────────

  it("ArrowLeft from live calls onMarkerClick with newest snapshot", () => {
    const onMarkerClick = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        onMarkerClick={onMarkerClick}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "ArrowLeft" });
    expect(onMarkerClick).toHaveBeenCalledWith("new");
  });

  it("ArrowLeft from past navigates to older snapshot", () => {
    const onMarkerClick = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        onMarkerClick={onMarkerClick}
        selectedMarkerId="new"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "ArrowLeft" });
    expect(onMarkerClick).toHaveBeenCalledWith("old");
  });

  it("ArrowRight from newest snapshot calls onReturnToNow", () => {
    const onReturnToNow = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        onReturnToNow={onReturnToNow}
        selectedMarkerId="new"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "ArrowRight" });
    expect(onReturnToNow).toHaveBeenCalledOnce();
  });

  it("ArrowRight from non-newest navigates to next snapshot", () => {
    const onMarkerClick = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        onMarkerClick={onMarkerClick}
        selectedMarkerId="old"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "ArrowRight" });
    expect(onMarkerClick).toHaveBeenCalledWith("new");
  });

  it("ArrowDown is an alias for ArrowLeft — navigates to older snapshot", () => {
    const onMarkerClick = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        onMarkerClick={onMarkerClick}
        selectedMarkerId="new"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "ArrowDown" });
    expect(onMarkerClick).toHaveBeenCalledWith("old");
  });

  it("ArrowUp is an alias for ArrowRight — navigates to newer snapshot", () => {
    const onMarkerClick = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        onMarkerClick={onMarkerClick}
        selectedMarkerId="old"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "ArrowUp" });
    expect(onMarkerClick).toHaveBeenCalledWith("new");
  });

  it("ArrowUp from newest snapshot calls onReturnToNow", () => {
    const onReturnToNow = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        onReturnToNow={onReturnToNow}
        selectedMarkerId="new"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "ArrowUp" });
    expect(onReturnToNow).toHaveBeenCalledOnce();
  });

  it("ArrowDown from live calls onMarkerClick with newest snapshot", () => {
    const onMarkerClick = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("old", 20), marker("new", 70)]}
        onMarkerClick={onMarkerClick}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "ArrowDown" });
    expect(onMarkerClick).toHaveBeenCalledWith("new");
  });

  it("Home selects the oldest snapshot", () => {
    const onMarkerClick = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("mid", 50), marker("old", 10), marker("new", 80)]}
        onMarkerClick={onMarkerClick}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "Home" });
    expect(onMarkerClick).toHaveBeenCalledWith("old"); // lowest position
  });

  it("End calls onReturnToNow", () => {
    const onReturnToNow = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("a", 50)]}
        onReturnToNow={onReturnToNow}
        selectedMarkerId="a"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "End" });
    expect(onReturnToNow).toHaveBeenCalledOnce();
  });

  it("Escape calls onReturnToNow", () => {
    const onReturnToNow = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("a", 50)]}
        onReturnToNow={onReturnToNow}
        selectedMarkerId="a"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("timeline-rail"), { key: "Escape" });
    expect(onReturnToNow).toHaveBeenCalledOnce();
  });

  it("keyboard is inert when no markers", () => {
    const onMarkerClick = vi.fn();
    const onReturnToNow = vi.fn();
    render(
      <TimelineScrubber
        markers={[]}
        onMarkerClick={onMarkerClick}
        onReturnToNow={onReturnToNow}
      />,
    );
    const rail = screen.getByTestId("timeline-rail");
    fireEvent.keyDown(rail, { key: "ArrowLeft" });
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    fireEvent.keyDown(rail, { key: "ArrowUp" });
    fireEvent.keyDown(rail, { key: "ArrowDown" });
    fireEvent.keyDown(rail, { key: "Home" });
    fireEvent.keyDown(rail, { key: "End" });
    fireEvent.keyDown(rail, { key: "Escape" });
    expect(onMarkerClick).not.toHaveBeenCalled();
    expect(onReturnToNow).not.toHaveBeenCalled();
  });

  // ── NOW terminus threshold (>=98%) ───────────────────────────────────────
  // Pointer-down/move threshold is covered by the e2e drag-to-NOW test.
  // jsdom's PointerEvent does not propagate getBoundingClientRect spies the same
  // way as MouseEvent, so only the click path is unit-tested here.

  it("rail click at >=98% calls onReturnToNow not onSelectNearest", () => {
    const onReturnToNow = vi.fn();
    const onSelectNearest = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("a", 20), marker("b", 70)]}
        onReturnToNow={onReturnToNow}
        onSelectNearest={onSelectNearest}
      />,
    );
    const rail = screen.getByTestId("timeline-rail");
    vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 400, width: 400,
      top: 0, bottom: 32, height: 32,
      x: 0, y: 0, toJSON: () => ({}),
    });

    // clientX=395 → 98.75% → past NOW_THRESHOLD
    fireEvent.click(rail, { clientX: 395 });
    expect(onReturnToNow).toHaveBeenCalledOnce();
    expect(onSelectNearest).not.toHaveBeenCalled();
  });

  it("pointer down on marker button does not trigger rail drag", () => {
    const onMarkerClick = vi.fn();
    const onSelectNearest = vi.fn();
    render(
      <TimelineScrubber
        markers={[marker("m", 40)]}
        onMarkerClick={onMarkerClick}
        onSelectNearest={onSelectNearest}
      />,
    );
    // pointerdown on the marker — stopPropagation prevents rail handler
    fireEvent.pointerDown(screen.getByTestId("timeline-marker"), { pointerId: 1 });
    fireEvent.click(screen.getByTestId("timeline-marker"));
    expect(onMarkerClick).toHaveBeenCalledWith("m");
    expect(onSelectNearest).not.toHaveBeenCalled();
  });
});
