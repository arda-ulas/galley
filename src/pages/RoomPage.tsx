import { AppShell } from "../components/AppShell";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { EditorPlaceholder } from "../components/EditorPlaceholder";
import { PresenceBar } from "../components/PresenceBar";
import { TimelineScrubber } from "../components/TimelineScrubber";

type RoomPageProps = {
  roomId: string;
};

const demoUsers = [
  {
    id: "user-ada",
    name: "Ada",
    color: "var(--presence-blue)",
    status: "editing",
  },
  {
    id: "user-linus",
    name: "Linus",
    color: "var(--presence-gold)",
    status: "viewing",
  },
];

const demoMarkers = [
  { id: "snapshot-1", position: 9, label: "Seed" },
  { id: "snapshot-2", position: 31, label: "+ parser" },
  { id: "snapshot-3", position: 58, label: "+ diff" },
  { id: "snapshot-4", position: 83, label: "latest" },
];

export function RoomPage({ roomId }: RoomPageProps) {
  return (
    <AppShell
      roomId={roomId}
      connection={<ConnectionStatus status="synced" />}
      presence={<PresenceBar users={demoUsers} />}
      timeline={<TimelineScrubber markers={demoMarkers} />}
    >
      <EditorPlaceholder />
    </AppShell>
  );
}
