import { motion } from "framer-motion";
import type { TimelineMarker } from "../lib/timeline";

type TimelineScrubberProps = {
  markers: TimelineMarker[];
};

const TICK_COUNT = 9;

function formatRelative(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

export function TimelineScrubber({ markers }: TimelineScrubberProps) {
  return (
    <div className="relative h-full flex items-center px-4 gap-4 bg-[var(--timeline-bg)]">
      {/* Rail + ticks + markers */}
      <div className="relative flex-1 h-8">
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

        {/* Snapshot markers */}
        {markers.map((marker, i) => {
          const color =
            i % 2 === 0 ? "var(--accent)" : "var(--presence-teal)";
          return (
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              className="absolute top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              data-testid="timeline-marker"
              initial={{ opacity: 0, scale: 0.5 }}
              key={marker.id}
              style={{
                left: `${marker.position}%`,
                background: color,
                boxShadow: `0 0 6px ${color}`,
              }}
              title={formatRelative(marker.createdAt)}
              transition={{ duration: 0.2 }}
            />
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
