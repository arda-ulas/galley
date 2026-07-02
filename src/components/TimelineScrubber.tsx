import { motion } from "framer-motion";
import { useRef, useState } from "react";
import type { TimelineMarker } from "../lib/timeline";
import { nearestMarkerForPosition } from "../lib/timeline";

type TimelineScrubberProps = {
  markers: TimelineMarker[];
  selectedMarkerId?: string;
  onMarkerClick?: (id: string) => void;
  onSelectNearest?: (id: string) => void;
  onReturnToNow?: () => void;
};

const TICK_COUNT = 9;
// Drag position (%) at or beyond which we snap to NOW instead of a snapshot.
const NOW_THRESHOLD = 98;

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
  onReturnToNow,
}: TimelineScrubberProps) {
  // Ref for synchronous checks inside pointer handlers (avoids stale closure).
  const isDraggingRef = useRef(false);
  // State for visual re-render on drag start/end (cursor, caret size).
  const [isDragging, setIsDragging] = useState(false);
  // Raw pointer % during drag — drives smooth visual caret/fill tracking.
  // null when not dragging; caret snaps back to selected marker on drag end.
  const [dragPct, setDragPct] = useState<number | null>(null);
  const lastEmittedId = useRef<string | null>(null);
  // Tracks the captured pointer ID so we can release it precisely.
  const capturedPointerIdRef = useRef<number | null>(null);

  const selectedMarker = markers.find((m) => m.id === selectedMarkerId);
  const isPast = !!selectedMarkerId;

  // Sorted once per render; reused by both keyboard handler and ARIA values.
  const sortedMarkers = [...markers].sort((a, b) => a.position - b.position);
  const selectedSortedIndex = selectedMarkerId
    ? sortedMarkers.findIndex((m) => m.id === selectedMarkerId)
    : -1; // -1 = live/now

  // Slider ARIA: snapshots map to 0..N-1; NOW = N.
  const ariaValueNow =
    selectedSortedIndex === -1 ? markers.length : selectedSortedIndex;
  const ariaValueText =
    selectedSortedIndex === -1
      ? "Now"
      : `Snapshot ${selectedSortedIndex + 1} of ${markers.length}`;

  // Discrete position derived from parent state (selected snapshot or 100% for NOW).
  const selectedPosition = selectedMarker ? selectedMarker.position : 100;
  // Visual position: follows pointer continuously while dragging, snaps on drag end.
  const visualPosition =
    isDragging && dragPct !== null ? dragPct : selectedPosition;

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

  // Route drag position to either onReturnToNow (>=threshold) or nearest snapshot.
  // Uses "now" sentinel in lastEmittedId so we only fire onReturnToNow once per
  // crossing, matching the same dedup pattern used for snapshot selection.
  function emitDragPosition(el: Element, clientX: number, pct: number) {
    if (pct >= NOW_THRESHOLD) {
      if (lastEmittedId.current !== "now") {
        lastEmittedId.current = "now";
        onReturnToNow?.();
      }
    } else {
      selectNearestAtClientX(el, clientX);
    }
  }

  function stopDragging(e?: React.PointerEvent<HTMLDivElement>) {
    if (e !== undefined && capturedPointerIdRef.current !== null) {
      try {
        if (typeof e.currentTarget.releasePointerCapture === "function") {
          e.currentTarget.releasePointerCapture(capturedPointerIdRef.current);
        }
      } catch {
        // Pointer may already be released; safe to ignore.
      }
    }
    capturedPointerIdRef.current = null;
    isDraggingRef.current = false;
    setIsDragging(false);
    setDragPct(null);
    lastEmittedId.current = null;
  }

  function handleRailPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (markers.length === 0) return;
    if (typeof e.currentTarget.setPointerCapture === "function") {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    capturedPointerIdRef.current = e.pointerId;
    isDraggingRef.current = true;
    setIsDragging(true);
    lastEmittedId.current = null;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct =
      rect.width === 0
        ? 0
        : Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    setDragPct(pct);
    emitDragPosition(e.currentTarget, e.clientX, pct);
  }

  function handleRailPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return;
    if (e.buttons === 0) {
      stopDragging(e);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const pct =
      rect.width === 0
        ? 0
        : Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    setDragPct(pct);
    emitDragPosition(e.currentTarget, e.clientX, pct);
  }

  function handleRailPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    stopDragging(e);
  }

  function handleRailPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    stopDragging(e);
  }

  // onClick kept as accessibility fallback; deduped by parent state comparison.
  function handleRailClick(e: React.MouseEvent<HTMLDivElement>) {
    if (markers.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    if (pct >= NOW_THRESHOLD) {
      onReturnToNow?.();
      return;
    }
    if (!onSelectNearest) return;
    const nearest = nearestMarkerForPosition(markers, pct);
    if (nearest) onSelectNearest(nearest.id);
  }

  function handleRailKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (markers.length === 0) return;
    // sortedMarkers and selectedSortedIndex are computed in render scope above.
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown": {
        e.preventDefault();
        if (selectedSortedIndex === -1) {
          // Live → jump to most recent snapshot.
          onMarkerClick?.(sortedMarkers[sortedMarkers.length - 1].id);
        } else if (selectedSortedIndex > 0) {
          onMarkerClick?.(sortedMarkers[selectedSortedIndex - 1].id);
        }
        break;
      }
      case "ArrowRight":
      case "ArrowUp": {
        e.preventDefault();
        if (
          selectedSortedIndex !== -1 &&
          selectedSortedIndex < sortedMarkers.length - 1
        ) {
          onMarkerClick?.(sortedMarkers[selectedSortedIndex + 1].id);
        } else if (selectedSortedIndex === sortedMarkers.length - 1) {
          // Most recent snapshot → return to live.
          onReturnToNow?.();
        }
        break;
      }
      case "Home": {
        e.preventDefault();
        onMarkerClick?.(sortedMarkers[0].id);
        break;
      }
      case "End":
      case "Escape": {
        e.preventDefault();
        onReturnToNow?.();
        break;
      }
    }
  }

  const railCursor = isDragging
    ? "grabbing"
    : markers.length > 0 && onSelectNearest
      ? "grab"
      : "default";

  return (
    <div className="relative h-full flex items-center px-4 bg-[var(--timeline-bg)]">
      {/* ── Rail ─────────────────────────────────────────────────────────────── */}
      <div
        aria-label={markers.length > 0 ? "Session timeline" : undefined}
        aria-valuemax={markers.length > 0 ? markers.length : undefined}
        aria-valuemin={markers.length > 0 ? 0 : undefined}
        aria-valuenow={markers.length > 0 ? ariaValueNow : undefined}
        aria-valuetext={markers.length > 0 ? ariaValueText : undefined}
        className="relative flex-1 h-8 outline-none focus-visible:ring-1 focus-visible:ring-[var(--past)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--timeline-bg)] rounded-sm"
        data-testid="timeline-rail"
        onClick={handleRailClick}
        onKeyDown={handleRailKeyDown}
        onPointerCancel={handleRailPointerCancel}
        onPointerDown={handleRailPointerDown}
        onPointerMove={handleRailPointerMove}
        onPointerUp={handleRailPointerUp}
        role={markers.length > 0 ? "slider" : undefined}
        style={{ cursor: railCursor }}
        tabIndex={markers.length > 0 ? 0 : -1}
      >
        {/* Recessed groove — the fader channel the cap rides in */}
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2"
          style={{
            height: "3px",
            background: "var(--border-subtle)",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.55)",
            borderRadius: "1px",
          }}
        />

        {/* Position-derived fill — amber in live, past-blue when scrubbing history */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2"
          style={{
            height: "3px",
            width: `${visualPosition}%`,
            background: isPast ? "var(--past)" : "var(--accent)",
            opacity: isPast ? 0.45 : 0.3,
            borderRadius: "1px 0 0 1px",
            transition: isDragging
              ? "none"
              : "width 90ms ease-out, background 200ms ease-out",
          }}
        />

        {/* Tick marks — ruler scale on the instrument surface */}
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

        {/* Snapshot marker buttons */}
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
              onClick={(e) => {
                e.stopPropagation();
                onMarkerClick?.(marker.id);
              }}
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

        {/* NOW terminus — horizontal layout keeps label clear of the fader cap */}
        <div
          className="absolute top-1/2 flex items-center gap-1 pointer-events-none"
          style={{ left: "100%", transform: "translate(3px, -50%)" }}
        >
          <div
            className="size-2 rounded-full bg-[var(--accent)]"
            style={{ boxShadow: "0 0 6px var(--accent)" }}
          />
          <span className="font-mono text-[10px] leading-none text-[var(--muted)]">
            now
          </span>
        </div>

        {/* ── Fader cap caret ────────────────────────────────────────────────── */}
        {/* Flat rectangular fader knob; pointer-events-none so rail handles input. */}
        <div
          className="absolute top-1/2 pointer-events-none"
          style={{
            left: `${visualPosition}%`,
            transform: "translate(-50%, -50%)",
            zIndex: 10,
            transition: isDragging ? "none" : "left 90ms ease-out",
          }}
        >
          <div
            style={{
              width: isDragging ? "9px" : "8px",
              height: isDragging ? "16px" : "13px",
              borderRadius: "1px",
              background: isPast
                ? "var(--past)"
                : isDragging
                  ? "rgba(232,224,208,1.0)"
                  : "rgba(232,224,208,0.85)",
              // Drop shadow only — no colored glow that reads as a button/pill.
              boxShadow: isPast
                ? "0 1px 3px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)"
                : isDragging
                  ? "0 2px 5px rgba(0,0,0,0.7)"
                  : "0 1px 3px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
              position: "relative",
              transition: "width 90ms ease-out, height 90ms ease-out",
            }}
          >
            {/* Score / notch — horizontal groove across the cap center */}
            <div
              style={{
                position: "absolute",
                left: "2px",
                right: "2px",
                top: "50%",
                height: "1px",
                background: isPast
                  ? "rgba(90,143,181,0.4)"
                  : "rgba(0,0,0,0.25)",
                transform: "translateY(-50%)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
