import { motion } from "framer-motion";
import { useRef } from "react";
import type { TimelineMarker } from "../lib/timeline";
import { nearestMarkerForPosition } from "../lib/timeline";

type TimelineScrubberProps = {
  markers: TimelineMarker[];
  selectedMarkerId?: string;
  onMarkerClick?: (id: string) => void;
  onSelectNearest?: (id: string) => void;
};

const TICK_COUNT = 9;

function formatRelative(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

export function TimelineScrubber({
  markers,
  selectedMarkerId,
  onMarkerClick,
  onSelectNearest,
}: TimelineScrubberProps) {
  const isDragging = useRef(false);
  // Tracks the last emitted marker id during a drag to suppress duplicate calls.
  const lastEmittedId = useRef<string | null>(null);

  function selectNearestAtClientX(el: Element, clientX: number) {
    if (markers.length === 0 || !onSelectNearest) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    const nearest = nearestMarkerForPosition(markers, pct);
    if (!nearest || nearest.id === lastEmittedId.current) return;
    lastEmittedId.current = nearest.id;
    onSelectNearest(nearest.id);
  }

  function stopDragging() {
    isDragging.current = false;
    lastEmittedId.current = null;
  }

  function handleRailPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (markers.length === 0 || !onSelectNearest) return;
    isDragging.current = true;
    lastEmittedId.current = null; // reset so the first pointerdown always fires
    selectNearestAtClientX(e.currentTarget, e.clientX);
  }

  function handleRailPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    // If no button is pressed (pointer released outside rail), clean up drag state.
    if (e.buttons === 0) {
      stopDragging();
      return;
    }
    selectNearestAtClientX(e.currentTarget, e.clientX);
  }

  // Keep onClick as an accessibility/keyboard fallback (deduped by React state in parent).
  function handleRailClick(e: React.MouseEvent<HTMLDivElement>) {
    if (markers.length === 0 || !onSelectNearest) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const nearest = nearestMarkerForPosition(markers, pct);
    if (nearest) onSelectNearest(nearest.id);
  }

  return (
    <div className="relative h-full flex items-center px-4 gap-4 bg-[var(--timeline-bg)]">
      <div
        className="relative flex-1 h-8"
        data-testid="timeline-rail"
        onClick={handleRailClick}
        onPointerCancel={stopDragging}
        onPointerDown={handleRailPointerDown}
        onPointerMove={handleRailPointerMove}
        onPointerUp={stopDragging}
        style={{ cursor: markers.length > 0 && onSelectNearest ? "pointer" : "default" }}
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--border)]" />
        <div
          className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-[var(--accent)]"
          style={{ width: "84%", opacity: 0.3 }}
        />

        {Array.from({ length: TICK_COUNT }).map((_, i) => (
          <div
            className="absolute top-1/2 w-px -translate-y-1/2 bg-[var(--border)]"
            key={i}
            style={{
              left: `${(i / (TICK_COUNT - 1)) * 100}%`,
              height: i === 0 || i === TICK_COUNT - 1 ? "10px" : "6px",
              marginTop: i === 0 || i === TICK_COUNT - 1 ? "-5px" : "-3px",
            }}
          />
        ))}

        {markers.map((marker, i) => {
          const isSelected = marker.id === selectedMarkerId;
          const color =
            i % 2 === 0 ? "var(--accent)" : "var(--presence-teal)";
          const label = formatRelative(marker.createdAt);
          return (
            <motion.button
              animate={{ opacity: 1 }}
              aria-current={isSelected ? "true" : undefined}
              aria-label={`View snapshot from ${label}`}
              className="absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-[var(--past)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--timeline-bg)]"
              data-selected={isSelected ? "true" : undefined}
              data-testid="timeline-marker"
              initial={{ opacity: 0 }}
              key={marker.id}
              onClick={(e) => { e.stopPropagation(); onMarkerClick?.(marker.id); }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{ left: `${marker.position}%` }}
              title={label}
              transition={{ duration: 0.2 }}
              type="button"
            >
              <motion.span
                animate={{ scale: isSelected ? 1.5 : 1 }}
                className="block size-[7px] rounded-full"
                initial={{ scale: 0.5 }}
                style={{
                  background: color,
                  outline: isSelected ? "2px solid var(--past)" : "none",
                  outlineOffset: isSelected ? "2px" : undefined,
                  boxShadow: isSelected
                    ? `0 0 12px ${color}`
                    : `0 0 6px ${color}`,
                }}
                transition={{ duration: 0.2 }}
              />
            </motion.button>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1">
        <div className="size-2 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
        <span className="font-mono text-[10px] leading-none text-[var(--muted)]">
          now
        </span>
      </div>
    </div>
  );
}
