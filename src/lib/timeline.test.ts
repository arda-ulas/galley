import { describe, expect, it } from "vitest";
import type { Snapshot } from "./snapshots";
import { snapshotsToMarkers } from "./timeline";

function snap(id: string, createdAt: number): Snapshot {
  return { id, text: "x", createdAt };
}

describe("snapshotsToMarkers", () => {
  it("returns empty array for no snapshots", () => {
    expect(snapshotsToMarkers([])).toEqual([]);
  });

  it("places a single snapshot at position 80", () => {
    const result = snapshotsToMarkers([snap("a", 1000)]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].position).toBe(80);
    expect(result[0].createdAt).toBe(1000);
  });

  it("maps the oldest snapshot to MIN_POS and the newest to MAX_POS", () => {
    const result = snapshotsToMarkers([
      snap("a", 1000),
      snap("b", 2000),
      snap("c", 3000),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].position).toBeCloseTo(5);
    expect(result[2].position).toBeCloseTo(88);
  });

  it("places a middle snapshot proportionally between MIN_POS and MAX_POS", () => {
    const result = snapshotsToMarkers([
      snap("a", 0),
      snap("b", 500),
      snap("c", 1000),
    ]);
    expect(result[1].position).toBeCloseTo(46.5); // midpoint of 5–88
  });

  it("caps at the most recent 30 snapshots when more are given", () => {
    const many = Array.from({ length: 35 }, (_, i) => snap(`s${i}`, i * 1000));
    const result = snapshotsToMarkers(many);
    expect(result).toHaveLength(30);
    expect(result[0].id).toBe("s5");
    expect(result[29].id).toBe("s34");
  });

  it("preserves createdAt on every marker", () => {
    const result = snapshotsToMarkers([snap("x", 42_000)]);
    expect(result[0].createdAt).toBe(42_000);
  });

  it("handles simultaneous timestamps without NaN", () => {
    const result = snapshotsToMarkers([snap("a", 1000), snap("b", 1000)]);
    expect(result).toHaveLength(2);
    result.forEach((m) => expect(Number.isFinite(m.position)).toBe(true));
  });
});
