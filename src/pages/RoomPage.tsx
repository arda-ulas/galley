import { useEffect } from "react";
import { AppShell } from "../components/AppShell";
import { CollaborativeEditor } from "../components/CollaborativeEditor";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { PresenceBar } from "../components/PresenceBar";
import { TimelineScrubber } from "../components/TimelineScrubber";
import { doc } from "../lib/room";
import { createSnapshotRecorder } from "../lib/snapshots";
import { snapshotsToMarkers } from "../lib/timeline";
import { usePresence } from "../lib/usePresence";
import { useProviderStatus } from "../lib/useProviderStatus";
import { useSessionIdentity } from "../lib/useSessionIdentity";
import { useSnapshots } from "../lib/useSnapshots";

type RoomPageProps = {
  roomId: string;
};

export function RoomPage({ roomId }: RoomPageProps) {
  const identity = useSessionIdentity();
  const users = usePresence(identity);
  const connectionStatus = useProviderStatus();
  const snapshots = useSnapshots(doc.getArray("snapshots"));
  const markers = snapshotsToMarkers(snapshots);

  useEffect(() => {
    return createSnapshotRecorder(
      doc.getText("content"),
      doc.getArray("snapshots"),
    );
  }, []);

  return (
    <AppShell
      connection={<ConnectionStatus status={connectionStatus} />}
      presence={<PresenceBar users={users} />}
      roomId={roomId}
      timeline={<TimelineScrubber markers={markers} />}
    >
      <CollaborativeEditor />
    </AppShell>
  );
}
