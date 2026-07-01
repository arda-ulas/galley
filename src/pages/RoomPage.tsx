import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { CollaborativeEditor } from "../components/CollaborativeEditor";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { PresenceBar } from "../components/PresenceBar";
import { TimelineScrubber } from "../components/TimelineScrubber";
import { doc } from "../lib/room";
import type { Snapshot } from "../lib/snapshots";
import { createSnapshotRecorder } from "../lib/snapshots";
import { snapshotsToMarkers } from "../lib/timeline";
import { usePresence } from "../lib/usePresence";
import { useProviderStatus } from "../lib/useProviderStatus";
import { useSessionIdentity } from "../lib/useSessionIdentity";
import { useSnapshots } from "../lib/useSnapshots";

type RoomPageProps = {
  roomId: string;
};

function formatRelative(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

export function RoomPage({ roomId }: RoomPageProps) {
  const identity = useSessionIdentity();
  const users = usePresence(identity);
  const connectionStatus = useProviderStatus();
  const snapshots = useSnapshots(doc.getArray("snapshots"));
  const markers = snapshotsToMarkers(snapshots);

  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(
    null,
  );

  useEffect(() => {
    return createSnapshotRecorder(
      doc.getText("content"),
      doc.getArray("snapshots"),
    );
  }, []);

  function handleMarkerClick(markerId: string) {
    const snapshot = snapshots.find((s) => s.id === markerId) ?? null;
    setSelectedSnapshot(snapshot);
  }

  function handleReturnToNow() {
    setSelectedSnapshot(null);
  }

  return (
    <AppShell
      connection={<ConnectionStatus status={connectionStatus} />}
      isPast={!!selectedSnapshot}
      presence={<PresenceBar users={users} />}
      roomId={roomId}
      timeline={
        <TimelineScrubber
          markers={markers}
          onMarkerClick={handleMarkerClick}
          onSelectNearest={handleMarkerClick}
          selectedMarkerId={selectedSnapshot?.id}
        />
      }
    >
      {/* Relative wrapper so the past pill can be absolutely positioned */}
      <div className="relative h-full">
        <CollaborativeEditor pastSnapshot={selectedSnapshot} />

        <AnimatePresence>
          {selectedSnapshot && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--panel)] px-4 py-1.5 font-mono text-[11px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: -4 }}
              key="past-pill"
              style={{ borderColor: "rgba(90,143,181,0.35)" }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <span className="text-[var(--past)]">Viewing the past</span>
              <span className="text-[var(--border)]" aria-hidden>·</span>
              <span className="text-[var(--muted)]">
                {formatRelative(selectedSnapshot.createdAt)}
              </span>
              <span className="text-[var(--border)]" aria-hidden>·</span>
              <button
                className="text-[var(--text)] underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--panel)]"
                data-testid="return-to-now"
                onClick={handleReturnToNow}
                type="button"
              >
                Return to now
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}
