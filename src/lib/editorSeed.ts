export const editorSeed = `import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

type Snapshot = {
  id: string;
  text: string;
  createdAt: number;
};

type SessionUser = {
  id: string;
  name: string;
  color: string;
  cursor: number | null;
};

const doc = new Y.Doc();
const content = doc.getText("content");
const snapshots = doc.getArray<Snapshot>("snapshots");

export function createRoom(roomId: string): WebsocketProvider {
  return new WebsocketProvider("ws://localhost:1234", roomId, doc);
}

export function captureSnapshot(): void {
  const text = content.toString();
  if (!text.trim()) return;

  snapshots.push([{
    id: crypto.randomUUID(),
    text,
    createdAt: Date.now(),
  }]);
}

export function getActiveUsers(
  awareness: Map<number, SessionUser>,
): SessionUser[] {
  return Array.from(awareness.values()).filter((u) => u.cursor !== null);
}

export function getSnapshots(): Snapshot[] {
  return snapshots.toArray();
}`;
