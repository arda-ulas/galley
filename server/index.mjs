import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

/** @type {Map<string, { doc: Y.Doc, awareness: awarenessProtocol.Awareness, clients: Map<import('ws').WebSocket, Set<number>> }>} */
const rooms = new Map();

function getRoom(name) {
  const existing = rooms.get(name);
  if (existing) return existing;

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null); // server has no presence of its own
  /** @type {Map<import('ws').WebSocket, Set<number>>} */
  const clients = new Map();

  doc.on('update', (update, origin) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    clients.forEach((_, client) => {
      if (client !== origin && client.readyState === 1 /* OPEN */) {
        client.send(msg);
      }
    });
  });

  // Track which awareness clientIds each WebSocket connection owns so we can
  // clean them up on disconnect (prevents stale states poisoning Step 10 awareness).
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin !== null && clients.has(origin)) {
      const ids = clients.get(origin);
      for (const id of added) ids.add(id);
      for (const id of updated) ids.add(id);
      for (const id of removed) ids.delete(id);
    }

    const changed = [...added, ...updated, ...removed];
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const msg = encoding.toUint8Array(enc);
    clients.forEach((_, client) => {
      if (client.readyState === 1 /* OPEN */) client.send(msg);
    });
  });

  const room = { doc, awareness, clients };
  rooms.set(name, room);
  return room;
}

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? '1234');

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on('connection', (ws, req) => {
  const rawPath = req.url ?? '/demo';
  const roomName = rawPath.split('?')[0].replace(/^\//, '') || 'demo';
  const { doc, awareness, clients } = getRoom(roomName);

  clients.set(ws, new Set());

  // Initiate sync: send step 1 so client shares its state vector
  const syncEnc = encoding.createEncoder();
  encoding.writeVarUint(syncEnc, MSG_SYNC);
  syncProtocol.writeSyncStep1(syncEnc, doc);
  ws.send(encoding.toUint8Array(syncEnc));

  // Send current awareness states to the new client
  const awarenessStates = awareness.getStates();
  if (awarenessStates.size > 0) {
    const awEnc = encoding.createEncoder();
    encoding.writeVarUint(awEnc, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      awEnc,
      awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys())),
    );
    ws.send(encoding.toUint8Array(awEnc));
  }

  ws.on('message', (rawData) => {
    const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const msgType = decoding.readVarUint(decoder);

    if (msgType === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, enc, doc, ws);
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
    } else if (msgType === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
    }
  });

  ws.on('close', () => {
    const ownedIds = clients.get(ws);
    clients.delete(ws);
    if (ownedIds && ownedIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(awareness, Array.from(ownedIds), null);
    }
  });
});

console.log(`Echo/Rewind WS server → ws://${HOST}:${PORT}`);
