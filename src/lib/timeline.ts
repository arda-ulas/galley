import type { Snapshot } from "./snapshots";

export type TimelineMarker = {
  id: string;
  position: number; // 0–100 (percentage along the rail)
  createdAt: number;
};

const MIN_POS = 5;
const MAX_POS = 88;
const MAX_MARKERS = 30;

/**
 * Converts an ordered array of Snapshots into positioned TimelineMarkers.
 *
 * - Empty input → empty output (no layout change).
 * - Single snapshot → placed at 80% (visible but clear of the "now" knob).
 * - Multiple snapshots → linearly mapped from MIN_POS to MAX_POS by createdAt.
 * - Capped at the most recent MAX_MARKERS entries so the rail stays readable.
 */
export function snapshotsToMarkers(snapshots: Snapshot[]): TimelineMarker[] {
  if (snapshots.length === 0) return [];

  const visible =
    snapshots.length > MAX_MARKERS ? snapshots.slice(-MAX_MARKERS) : snapshots;

  if (visible.length === 1) {
    return [
      { id: visible[0].id, position: 80, createdAt: visible[0].createdAt },
    ];
  }

  const minTime = visible[0].createdAt;
  const maxTime = visible[visible.length - 1].createdAt;
  const range = maxTime - minTime;

  return visible.map((s) => ({
    id: s.id,
    position:
      range === 0
        ? MIN_POS
        : MIN_POS + ((s.createdAt - minTime) / range) * (MAX_POS - MIN_POS),
    createdAt: s.createdAt,
  }));
}
