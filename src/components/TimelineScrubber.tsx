import { motion } from "framer-motion";

type TimelineMarker = {
  id: string;
  position: number;
  label: string;
};

type TimelineScrubberProps = {
  markers: TimelineMarker[];
};

export function TimelineScrubber({ markers }: TimelineScrubberProps) {
  return (
    <div className="grid h-full grid-rows-[24px_1fr] gap-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--text)]">Session timeline</span>
        <span className="text-[var(--muted)]">static scaffold · markers only</span>
      </div>

      <div className="relative rounded-md border border-[var(--border)] bg-[var(--timeline-bg)] px-4 py-4">
        <div className="absolute left-4 right-4 top-1/2 h-px -translate-y-1/2 bg-[var(--border)]" />
        <div className="absolute left-4 right-4 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-[var(--accent)] via-[var(--past)] to-[var(--success)] opacity-50" />

        {markers.map((marker, index) => (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-2"
            initial={{ opacity: 0, y: 4 }}
            key={marker.id}
            style={{ left: `${marker.position}%` }}
            transition={{ delay: index * 0.04, duration: 0.24 }}
          >
            <span className="size-3 rounded-full border border-[var(--bg)] bg-[var(--accent)] shadow-[0_0_18px_rgba(115,215,255,0.38)]" />
            <span className="translate-y-1 whitespace-nowrap text-[10px] text-[var(--muted)]">
              {marker.label}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
