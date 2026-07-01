import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export const doc = new Y.Doc();

// connect: false — connection is started explicitly via connectRoom().
// This avoids eager WebSocket instantiation before the component mounts.
export const provider = new WebsocketProvider(
  'ws://localhost:1234',
  'demo',
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
