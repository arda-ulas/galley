import { AppShell } from "../components/AppShell";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { EditorPlaceholder } from "../components/EditorPlaceholder";
import { PresenceBar } from "../components/PresenceBar";
import { TimelineScrubber } from "../components/TimelineScrubber";

type RoomPageProps = {
  roomId: string;
};

const demoUsers = [
  { id: "user-a", name: "Ada", color: "#F5A623", status: "editing" },
  { id: "user-b", name: "Lin", color: "#5BB8A0", status: "viewing" },
];

const demoMarkers = [
  { id: "s1", position: 11, color: "#F5A623" },
  { id: "s2", position: 29, color: "#5BB8A0" },
  { id: "s3", position: 47, color: "#F5A623" },
  { id: "s4", position: 63, color: "#5BB8A0" },
  { id: "s5", position: 79, color: "#F5A623" },
];

export function RoomPage({ roomId }: RoomPageProps) {
  return (
    <AppShell
      connection={<ConnectionStatus status="synced" />}
      presence={<PresenceBar users={demoUsers} />}
      roomId={roomId}
      timeline={<TimelineScrubber markers={demoMarkers} />}
    >
      <EditorPlaceholder />
    </AppShell>
  );
}
