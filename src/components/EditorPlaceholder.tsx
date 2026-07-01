const starterCode = `import { WebsocketProvider } from "y-websocket";
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

export function EditorPlaceholder() {
  const lines = starterCode.split("\n");

  return (
    <div className="h-full min-h-0 overflow-auto bg-[var(--editor-bg)] py-4 font-mono text-[13px] leading-6">
      {lines.map((line, index) => (
        <div className="grid grid-cols-[3ch_1fr] gap-4 px-4" key={index}>
          <span className="select-none text-right text-[var(--editor-line)]">
            {index + 1}
          </span>
          <code className="whitespace-pre text-[var(--editor-text)]">{line}</code>
        </div>
      ))}
    </div>
  );
}
