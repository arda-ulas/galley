import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export const doc = new Y.Doc();

const DEFAULT_ROOM_ID = "demo";
const E2E_ROOM_PARAM = "__e2eRoom";

function getProviderRoomId(): string {
  if (import.meta.env.VITE_ECHO_REWIND_E2E !== "1") return DEFAULT_ROOM_ID;

  const candidate = new URLSearchParams(window.location.search).get(E2E_ROOM_PARAM);
  return candidate && /^[a-z0-9-]+$/i.test(candidate)
    ? candidate
    : DEFAULT_ROOM_ID;
}

// connect: false — connection is started explicitly via connectRoom().
// This avoids eager WebSocket instantiation before the component mounts.
export const provider = new WebsocketProvider(
  'ws://127.0.0.1:1234',
  getProviderRoomId(),
  doc,
  { connect: false },
);

let connected = false;

export function connectRoom(): void {
  if (!connected) {
    connected = true;
    provider.connect();
  }
}
