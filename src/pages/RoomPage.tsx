import { AppShell } from "../components/AppShell";
import { CollaborativeEditor } from "../components/CollaborativeEditor";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { PresenceBar } from "../components/PresenceBar";
import { TimelineScrubber } from "../components/TimelineScrubber";
import { usePresence } from "../lib/usePresence";
import { useProviderStatus } from "../lib/useProviderStatus";
import { useSessionIdentity } from "../lib/useSessionIdentity";

type RoomPageProps = {
  roomId: string;
};

const demoMarkers = [
  { id: "s1", position: 11, color: "#F5A623" },
  { id: "s2", position: 29, color: "#5BB8A0" },
  { id: "s3", position: 47, color: "#F5A623" },
  { id: "s4", position: 63, color: "#5BB8A0" },
  { id: "s5", position: 79, color: "#F5A623" },
];

export function RoomPage({ roomId }: RoomPageProps) {
  const identity = useSessionIdentity();
  const users = usePresence(identity);
  const connectionStatus = useProviderStatus();

  return (
    <AppShell
      connection={<ConnectionStatus status={connectionStatus} />}
      presence={<PresenceBar users={users} />}
      roomId={roomId}
      timeline={<TimelineScrubber markers={demoMarkers} />}
    >
      <CollaborativeEditor />
    </AppShell>
  );
}
