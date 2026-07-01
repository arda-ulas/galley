import { motion } from "framer-motion";
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
  function handleRailClick(e: React.MouseEvent<HTMLDivElement>) {
    if (markers.length === 0 || !onSelectNearest) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const clickPct = ((e.clientX - rect.left) / rect.width) * 100;
    const nearest = nearestMarkerForPosition(markers, clickPct);
    if (nearest) onSelectNearest(nearest.id);
  }

  return (
    <div className="relative h-full flex items-center px-4 gap-4 bg-[var(--timeline-bg)]">
      {/* Rail + ticks + markers */}
      <div
        className="relative flex-1 h-8"
        data-testid="timeline-rail"
        onClick={handleRailClick}
        style={{ cursor: markers.length > 0 && onSelectNearest ? "pointer" : "default" }}
      >
        {/* Amber rail */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--border)]" />
        <div
          className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-[var(--accent)]"
          style={{ width: "84%", opacity: 0.3 }}
        />

        {/* Decorative ticks */}
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

        {/* Snapshot markers — rendered as buttons for full keyboard/a11y support */}
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

      {/* Now indicator */}
      <div className="flex shrink-0 flex-col items-center gap-1">
        <div className="size-2 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
        <span className="font-mono text-[10px] leading-none text-[var(--muted)]">
          now
        </span>
      </div>
    </div>
  );
}
