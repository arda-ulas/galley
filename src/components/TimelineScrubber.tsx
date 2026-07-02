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
  // Keeping Now (N) strictly greater than the newest snapshot (N-1) makes every
  // position on the range distinct — a requirement of the slider contract.
  const ariaValueNow =
    selectedSortedIndex === -1 ? markers.length : selectedSortedIndex;
  const ariaValueText =
    selectedSortedIndex === -1
      ? "Now"
      : `Snapshot ${selectedSortedIndex + 1} of ${markers.length}`;

  // Caret sits at the selected snapshot position in past mode, or at the NOW
  // terminus (100%) in live mode.
  const caretPosition = selectedMarker ? selectedMarker.position : 100;

  function selectNearestAtClientX(el: Element, clientX: number) {
    if (markers.length === 0 || !onSelectNearest) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    // With pointer capture el is always the rail, so getBoundingClientRect is
    // correct even when the pointer is outside the rail boundary.
    const pct = ((clientX - rect.left) / rect.width) * 100;
    const nearest = nearestMarkerForPosition(markers, pct);
    if (!nearest || nearest.id === lastEmittedId.current) return;
    lastEmittedId.current = nearest.id;
    onSelectNearest(nearest.id);
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
    lastEmittedId.current = null;
  }

  function handleRailPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (markers.length === 0 || !onSelectNearest) return;
    // Capture the pointer so drag continues even when the cursor leaves the rail.
    // Guard: setPointerCapture is absent in jsdom; the drag still works, just
    // without out-of-bounds tracking (covered by E2E in real Chromium).
    if (typeof e.currentTarget.setPointerCapture === "function") {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    capturedPointerIdRef.current = e.pointerId;
    isDraggingRef.current = true;
    setIsDragging(true);
    lastEmittedId.current = null;
    selectNearestAtClientX(e.currentTarget, e.clientX);
  }

  function handleRailPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return;
    // Guard against pointer-up that fires outside the element before capture.
    if (e.buttons === 0) {
      stopDragging(e);
      return;
    }
    selectNearestAtClientX(e.currentTarget, e.clientX);
  }

  function handleRailPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    stopDragging(e);
  }

  function handleRailPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    stopDragging(e);
  }

  // onClick kept as accessibility fallback; deduped by parent state comparison.
  function handleRailClick(e: React.MouseEvent<HTMLDivElement>) {
    if (markers.length === 0 || !onSelectNearest) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
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
        if (selectedSortedIndex !== -1 && selectedSortedIndex < sortedMarkers.length - 1) {
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
            width: `${caretPosition}%`,
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

        {/* NOW terminus — on the rail at the right edge, not beside it */}
        <div
          className="absolute top-1/2 flex flex-col items-center pointer-events-none"
          style={{ left: "100%", transform: "translate(-50%, -50%)" }}
        >
          <div
            className="size-2 rounded-full bg-[var(--accent)]"
            style={{ boxShadow: "0 0 8px var(--accent)" }}
          />
          <span className="font-mono text-[10px] leading-none text-[var(--muted)] mt-1">
            now
          </span>
        </div>

        {/* ── Fader cap caret ────────────────────────────────────────────────── */}
        {/* 9×15px (10×18px when dragging), radius 2px, center score line.     */}
        {/* pointer-events-none so rail/marker interactions pass through.        */}
        <div
          className="absolute top-1/2 pointer-events-none"
          style={{
            left: `${caretPosition}%`,
            transform: "translate(-50%, -50%)",
            zIndex: 10,
            transition: isDragging ? "none" : "left 90ms ease-out",
          }}
        >
          <div
            style={{
              width: isDragging ? "10px" : "9px",
              height: isDragging ? "18px" : "15px",
              borderRadius: "2px",
              background: isPast
                ? "var(--past)"
                : isDragging
                  ? "rgba(232,224,208,1.0)"
                  : "rgba(232,224,208,0.88)",
              boxShadow: isPast
                ? "0 0 10px var(--past), 0 1px 4px rgba(0,0,0,0.55)"
                : isDragging
                  ? "0 0 14px rgba(232,224,208,0.4), 0 2px 6px rgba(0,0,0,0.6)"
                  : "0 1px 5px rgba(0,0,0,0.55)",
              position: "relative",
              transition: "width 90ms ease-out, height 90ms ease-out",
            }}
          >
            {/* Score / notch — one horizontal groove across the cap center */}
            <div
              style={{
                position: "absolute",
                left: "2px",
                right: "2px",
                top: "50%",
                height: "1px",
                background: isPast
                  ? "rgba(90,143,181,0.45)"
                  : "rgba(0,0,0,0.22)",
                transform: "translateY(-50%)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
