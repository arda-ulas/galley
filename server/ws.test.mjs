// Integration tests for the strict, durable-hydrated collaboration WebSocket
// boundary (M4 commit 2): canonical `/ws/:sheetId` routing, validate+hydrate
// through the shared loadValidatedSheet() boundary, terminal close codes, the
// synchronous single-initialization concurrency guarantee, and lifecycle
// disposal. Uses a real file-backed server on an ephemeral port; a fresh client
// Y.Doc is driven over the same two-step Yjs sync protocol the server speaks.

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { createServerApplication } from "./app.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";
import {
  MAX_CANONICAL_STATE_BYTES,
  MAX_WS_AWARENESS_BYTES,
  MAX_WS_FRAME_BYTES,
  MAX_WS_SYNC_UPDATE_BYTES,
  MAX_WS_TRANSPORT_PAYLOAD_BYTES,
} from "./limits.mjs";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

/** A well-formed but arbitrary 16-char sheet id (matches the minted shape). */
const VALID_ID = "sheetWS000000001";
const MISSING_ID = "sheetMISSING0001";

/** @type {Array<{ cleanup: () => Promise<void> }>} */
const temps = [];
const apps = [];
/** @type {Array<{ ws: WebSocket, doc?: Y.Doc }>} */
const clients = [];

afterEach(async () => {
  while (clients.length) {
    const c = clients.pop();
    try {
      c.ws.close();
    } catch {
      // already closing
    }
    c.awareness?.destroy();
    c.doc?.destroy();
  }
  while (apps.length) {
    try {
      await apps.pop().shutdown();
    } catch {
      // ignore
    }
  }
  while (temps.length) await temps.pop().cleanup();
});

async function startApp(dbPath) {
  let t;
  if (!dbPath) {
    t = await createTempDb();
    temps.push(t);
    dbPath = t.dbPath;
  }
  const app = await createServerApplication({
    ECHO_REWIND_TEST: "1",
    GALLEY_TEST_DB_PATH: dbPath,
    HOST: "127.0.0.1",
    PORT: "0",
  });
  await app.start();
  apps.push(app);
  return { app, port: app.address().port, dbPath };
}

let tokenCounter = 0;
function createDurableSheet(app, { sheetId = VALID_ID, text = "hello world" } = {}) {
  const doc = new Y.Doc();
  if (text) doc.getText("content").insert(0, text);
  const canonicalUpdate = Y.encodeStateAsUpdate(doc);
  const canonicalStateVector = Y.encodeStateVector(doc);
  doc.destroy();
  app.db.createSheet({
    sheetId,
    creationToken: `ws-tok-${tokenCounter++}`,
    canonicalUpdate,
    canonicalStateVector,
    title: "notes",
    language: "typescript",
    schemaVersion: 0,
    committedAt: 4242,
  });
  return sheetId;
}

/** Corrupt persisted rows on a throwaway connection (separate handle, same file). */
function raw(dbPath, fn) {
  const c = new DatabaseSync(dbPath);
  try {
    return fn(c);
  } finally {
    c.close();
  }
}

/** A raw WebSocket to an arbitrary path — used to observe the close code. */
function connectRaw(port, path) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  clients.push({ ws });
  return ws;
}

/**
 * A minimal Yjs client that speaks the same two-step sync protocol as the
 * server, so persisted content converges through NORMAL sync (no shortcuts).
 */
function connectYjsClient(port, sheetId) {
  const doc = new Y.Doc();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${sheetId}`);
  clients.push({ ws, doc });
  ws.on("open", () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    ws.send(encoding.toUint8Array(enc));
  });
  ws.on("message", (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const decoder = decoding.createDecoder(new Uint8Array(buf));
    const type = decoding.readVarUint(decoder);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, enc, doc, ws);
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
    }
    // MSG_AWARENESS is ignored by this content-focused harness.
  });
  return { doc, ws };
}

/**
 * A fuller provider-lite client: bidirectional Yjs sync (forwards LOCAL edits,
 * never echoes server-applied updates) plus awareness relay (applies inbound
 * awareness and broadcasts local awareness changes). Used for live two-client
 * sync and awareness-relay regressions.
 */
function connectFullClient(port, sheetId) {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null); // no presence until the test sets it
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${sheetId}`);
  clients.push({ ws, doc, awareness });

  ws.on("open", () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    ws.send(encoding.toUint8Array(enc));
  });
  ws.on("message", (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const decoder = decoding.createDecoder(new Uint8Array(buf));
    const type = decoding.readVarUint(decoder);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, enc, doc, ws);
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(decoder),
        ws,
      );
    }
  });
  doc.on("update", (update, origin) => {
    if (origin === ws || ws.readyState !== ws.OPEN) return; // only local edits
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  });
  awareness.on("update", ({ added, updated, removed }, origin) => {
    if (origin === ws || ws.readyState !== ws.OPEN) return; // only local changes
    const changed = [...added, ...updated, ...removed];
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    );
    ws.send(encoding.toUint8Array(enc));
  });
  return { doc, ws, awareness };
}

/** Open a raw ws to a valid /ws/:sheetId and resolve once it is open. */
async function openRaw(port, sheetId) {
  const ws = connectRaw(port, `/ws/${sheetId}`);
  await opened(ws);
  return ws;
}

/** A raw binary frame from byte literals. */
function bin(...bytes) {
  return new Uint8Array(bytes);
}

/** Frame a SYNC update (subtype 2) carrying `updateBytes`. */
function syncUpdateFrame(updateBytes) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  encoding.writeVarUint(enc, syncProtocol.messageYjsUpdate);
  encoding.writeVarUint8Array(enc, updateBytes);
  return encoding.toUint8Array(enc);
}

/** Frame an AWARENESS message carrying an already-encoded awareness body. */
function awarenessFrame(bodyBytes) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_AWARENESS);
  encoding.writeVarUint8Array(enc, bodyBytes);
  return encoding.toUint8Array(enc);
}

function opened(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

/** Resolves with the close CODE the peer received. */
function closedCode(ws) {
  return new Promise((resolve) => ws.once("close", (code) => resolve(code)));
}

async function waitForText(doc, expected, timeout = 3000) {
  const start = Date.now();
  while (doc.getText("content").toString() !== expected) {
    if (Date.now() - start > timeout) {
      throw new Error(
        `timeout waiting for "${expected}"; got "${doc.getText("content").toString()}"`,
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("ws routing — canonical /ws/:sheetId only", () => {
  it("accepts a valid /ws/:sheetId and syncs persisted content", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: "accepted body" });
    const { doc } = connectYjsClient(port, VALID_ID);
    await waitForText(doc, "accepted body");
    expect(app.rooms.size).toBe(1);
    expect(app.rooms.has(VALID_ID)).toBe(true);
  });

  it("closes 4400 on a malformed sheet id", async () => {
    const { port } = await startApp();
    expect(await closedCode(connectRaw(port, "/ws/short"))).toBe(4400);
  });

  it("closes 4400 on an arbitrary (non-/ws) path", async () => {
    const { port } = await startApp();
    expect(await closedCode(connectRaw(port, "/foo/bar"))).toBe(4400);
  });

  it("closes 4400 on a trailing slash", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app);
    expect(await closedCode(connectRaw(port, `/ws/${VALID_ID}/`))).toBe(4400);
    expect(app.rooms.size).toBe(0);
  });

  it("closes 4400 on a query string", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app);
    expect(await closedCode(connectRaw(port, `/ws/${VALID_ID}?x=1`))).toBe(4400);
    expect(app.rooms.size).toBe(0);
  });

  it("closes 4400 on an extra path segment", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app);
    expect(await closedCode(connectRaw(port, `/ws/${VALID_ID}/extra`))).toBe(4400);
    expect(app.rooms.size).toBe(0);
  });

  it("rejects the legacy /r/demo route with 4400 (no room created)", async () => {
    const { app, port } = await startApp();
    expect(await closedCode(connectRaw(port, "/r/demo"))).toBe(4400);
    expect(app.rooms.size).toBe(0);
    expect(app.rooms.has("demo")).toBe(false);
  });
});

describe("ws durable validation — terminal codes, no room created", () => {
  it("closes 4404 for a missing sheet", async () => {
    const { app, port } = await startApp();
    expect(await closedCode(connectRaw(port, `/ws/${MISSING_ID}`))).toBe(4404);
    expect(app.rooms.size).toBe(0);
    expect(app.hydrationCount).toBe(0);
  });

  it("closes 4500 for corrupt durable state", async () => {
    const { app, port, dbPath } = await startApp();
    createDurableSheet(app);
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE sheets SET state = ? WHERE id = ?")
        .run(new Uint8Array([0xff, 0xff, 0xff, 0xff]), VALID_ID),
    );
    expect(await closedCode(connectRaw(port, `/ws/${VALID_ID}`))).toBe(4500);
    expect(app.rooms.size).toBe(0);
    expect(app.hydrationCount).toBe(0);
  });

  it("closes 1011 for an operational database failure", async () => {
    const { app, port, dbPath } = await startApp();
    createDurableSheet(app);
    // A stored integer too large to materialize as a JS number surfaces as a
    // RangeError while reading the row — an operational (not content) failure.
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE sheets SET server_revision = ? WHERE id = ?")
        .run(9007199254740993n, VALID_ID),
    );
    expect(await closedCode(connectRaw(port, `/ws/${VALID_ID}`))).toBe(1011);
    expect(app.rooms.size).toBe(0);
    expect(app.hydrationCount).toBe(0);
  });

  it("a failed hydration leaves no room, and a later valid join still works", async () => {
    const { app, port } = await startApp();
    expect(await closedCode(connectRaw(port, `/ws/${MISSING_ID}`))).toBe(4404);
    expect(app.rooms.size).toBe(0);

    createDurableSheet(app, { text: "recovered" });
    const { doc } = connectYjsClient(port, VALID_ID);
    await waitForText(doc, "recovered");
    expect(app.rooms.size).toBe(1);
    expect(app.hydrationCount).toBe(1);
  });
});

describe("ws hydration — durable canonical state only", () => {
  it("delivers persisted content and injects no starter/metadata into the doc", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: "persisted body only" });
    const { doc } = connectYjsClient(port, VALID_ID);
    await waitForText(doc, "persisted body only");

    // Exactly the persisted text — no starter code prefix/suffix.
    expect(doc.getText("content").toString()).toBe("persisted body only");
    // Title/language live in the metadata record, never the Y.Doc.
    expect(doc.share.has("title")).toBe(false);
    expect(doc.share.has("language")).toBe(false);
    expect([...doc.share.keys()]).toEqual(["content"]);
  });

  it("hydrates content created through the M3 HTTP API", async () => {
    const { app, port } = await startApp();
    const cdoc = new Y.Doc();
    cdoc.getText("content").insert(0, "via http api");
    const submittedUpdate = Buffer.from(Y.encodeStateAsUpdate(cdoc)).toString("base64");
    const submittedStateVector = Buffer.from(Y.encodeStateVector(cdoc)).toString("base64");
    cdoc.destroy();
    const res = await fetch(`http://127.0.0.1:${port}/api/sheets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creationToken: crypto.randomUUID(),
        submittedUpdate,
        submittedStateVector,
        title: "t",
        language: "typescript",
        schemaVersion: 0,
      }),
    });
    expect(res.status).toBe(201);
    const { sheetId } = await res.json();

    const { doc } = connectYjsClient(port, sheetId);
    await waitForText(doc, "via http api");
    expect(app.rooms.has(sheetId)).toBe(true);
  });

  it("rehydrates identical content after a server restart (file-backed)", async () => {
    const first = await startApp();
    createDurableSheet(first.app, { text: "survives restart" });
    await first.app.shutdown();
    apps.pop(); // already shut down

    const second = await startApp(first.dbPath);
    const { doc } = connectYjsClient(second.port, VALID_ID);
    await waitForText(doc, "survives restart");
    expect(doc.getText("content").toString()).toBe("survives restart");
  });
});

describe("ws hydration — partial construction cleanup", () => {
  it("destroys both partials, closes 1011, and stays alive when build fails after Awareness", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: "post-fault content" });

    // Arm the one-shot construction fault and observe the partials it hands us.
    let observed = null;
    let docDestroyed = false;
    let awarenessDestroyed = false;
    app.__test.failNextRoomBuild(({ doc, awareness }) => {
      observed = { doc, awareness };
      doc.once("destroy", () => {
        docDestroyed = true;
      });
      awareness.once("destroy", () => {
        awarenessDestroyed = true;
      });
    });

    // First join: construction throws after Awareness exists → terminal 1011.
    expect(await closedCode(connectRaw(port, `/ws/${VALID_ID}`))).toBe(1011);

    // The partial Awareness AND Y.Doc were both explicitly destroyed…
    expect(observed).not.toBeNull();
    expect(awarenessDestroyed).toBe(true);
    expect(docDestroyed).toBe(true);
    // …nothing entered the `rooms` map (so no room, no client map, no relay
    // listeners survive), and the counter did not move.
    expect(app.rooms.size).toBe(0);
    expect(app.rooms.has(VALID_ID)).toBe(false);
    expect(app.hydrationCount).toBe(0);

    // A second join (the fault is consumed) hydrates successfully and content
    // reaches the client; hydrationCount rises to 1 only after real success.
    const { doc } = connectYjsClient(port, VALID_ID);
    await waitForText(doc, "post-fault content");
    expect(app.rooms.size).toBe(1);
    expect(app.hydrationCount).toBe(1);
  });
});

describe("ws concurrency — synchronous single initialization", () => {
  it("two concurrent first joins share exactly one hydrated room", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: "converge" });

    const a = connectYjsClient(port, VALID_ID);
    const b = connectYjsClient(port, VALID_ID);
    await Promise.all([opened(a.ws), opened(b.ws)]);
    await Promise.all([waitForText(a.doc, "converge"), waitForText(b.doc, "converge")]);

    expect(app.rooms.size).toBe(1);
    const room = app.rooms.get(VALID_ID);
    expect(room.clients.size).toBe(2); // both attached to the SAME room
    expect(app.hydrationCount).toBe(1); // initialized exactly once
  });
});

describe("ws lifecycle — disposal and client removal", () => {
  it("removes a closed client but leaves the (existing) room semantics intact", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: "lifecycle" });

    const a = connectYjsClient(port, VALID_ID);
    await waitForText(a.doc, "lifecycle");
    const room = app.rooms.get(VALID_ID);
    expect(room.clients.size).toBe(1);

    a.ws.close();
    await new Promise((resolve) => a.ws.once("close", resolve));
    // The room lingers (existing semantics: no auto-disposal on empty), and the
    // client was removed from its map.
    await waitForCondition(() => room.clients.size === 0);
    expect(app.rooms.size).toBe(1);

    // A rejoin reuses the same room — no second hydration.
    const b = connectYjsClient(port, VALID_ID);
    await waitForText(b.doc, "lifecycle");
    expect(app.hydrationCount).toBe(1);
  });

  it("destroys a hydrated room's Awareness and Y.Doc on shutdown", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: "dispose me" });
    const { doc } = connectYjsClient(port, VALID_ID);
    await waitForText(doc, "dispose me");

    const room = app.rooms.get(VALID_ID);
    let docDestroyed = false;
    let awarenessDestroyed = false;
    room.doc.once("destroy", () => {
      docDestroyed = true;
    });
    room.awareness.once("destroy", () => {
      awarenessDestroyed = true;
    });

    await app.shutdown();
    apps.pop(); // already shut down

    expect(docDestroyed).toBe(true);
    expect(awarenessDestroyed).toBe(true);
    expect(app.rooms.size).toBe(0);
  });

  it("destroys a hydrated room's Awareness and Y.Doc on durable reset", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: "reset me" });
    const { doc } = connectYjsClient(port, VALID_ID);
    await waitForText(doc, "reset me");

    const room = app.rooms.get(VALID_ID);
    let docDestroyed = false;
    let awarenessDestroyed = false;
    room.doc.once("destroy", () => {
      docDestroyed = true;
    });
    room.awareness.once("destroy", () => {
      awarenessDestroyed = true;
    });

    const res = await fetch(`http://127.0.0.1:${port}/__test/reset`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(docDestroyed).toBe(true);
    expect(awarenessDestroyed).toBe(true);
    expect(app.rooms.size).toBe(0);
  });
});

// --- M4 commit 3: per-message containment ----------------------------------

const SEED = "seed";

/**
 * Connect a healthy peer + a raw offender, let the offender send one crafted
 * frame, and assert it is contained: the offender closes with `expectedCode`,
 * the healthy peer stays open, the room survives, the process is alive (a later
 * client still joins + syncs), and the room's live doc is unchanged.
 */
async function expectContained(app, port, sheetId, sendOffender, expectedCode) {
  const healthy = connectYjsClient(port, sheetId);
  await waitForText(healthy.doc, SEED);

  const offender = await openRaw(port, sheetId);
  const codeP = closedCode(offender);
  sendOffender(offender);
  expect(await codeP).toBe(expectedCode);

  // Only the offender is affected.
  expect(healthy.ws.readyState).toBe(WebSocket.OPEN);
  expect(app.rooms.has(sheetId)).toBe(true);
  expect(app.rooms.get(sheetId).doc.getText("content").toString()).toBe(SEED);

  // The server is still alive: a later client joins and syncs the intact room.
  const later = connectYjsClient(port, sheetId);
  await waitForText(later.doc, SEED);
}

describe("ws message boundary — malformed input (contained, 4400)", () => {
  it("rejects a zero-length binary frame", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    await expectContained(app, port, VALID_ID, (ws) => ws.send(new Uint8Array(0)), 4400);
  });

  it("rejects an invalid top-level varuint type encoding", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    // 0x80 = a continuation byte with no terminating byte → unexpected EOF.
    await expectContained(app, port, VALID_ID, (ws) => ws.send(bin(0x80)), 4400);
  });

  it("rejects a truncated sync message (before any doc mutation)", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    // [SYNC, subtype=update(2), claimed-length=5] with no payload bytes.
    await expectContained(app, port, VALID_ID, (ws) => ws.send(bin(MSG_SYNC, 2, 5)), 4400);
  });

  it("rejects an unknown sync subtype", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    await expectContained(app, port, VALID_ID, (ws) => ws.send(bin(MSG_SYNC, 9)), 4400);
  });

  it("rejects a truncated awareness payload", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    // [AWARENESS, claimed-length=5] with no payload bytes.
    await expectContained(app, port, VALID_ID, (ws) => ws.send(bin(MSG_AWARENESS, 5)), 4400);
  });

  it("rejects a text frame explicitly", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    await expectContained(app, port, VALID_ID, (ws) => ws.send("not binary"), 4400);
  });

  it("rejects a malformed multi-entry awareness update before any entry is applied (no ghost)", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    // A healthy peer with no presence keeps the room's awareness empty.
    const healthy = connectYjsClient(port, VALID_ID);
    await waitForText(healthy.doc, SEED);
    const room = app.rooms.get(VALID_ID);
    expect(room.awareness.getStates().size).toBe(0);

    // A body that claims 2 entries: entry 1 is a valid NEW client, entry 2 is
    // truncated (clientID only, no clock/state). Full preflight rejects the whole
    // payload, so entry 1 is never applied — no ghost identity appears.
    const ghost = 987654;
    const body = encoding.createEncoder();
    encoding.writeVarUint(body, 2);
    encoding.writeVarUint(body, ghost);
    encoding.writeVarUint(body, 1);
    encoding.writeVarString(body, JSON.stringify({ user: "ghost" }));
    encoding.writeVarUint(body, ghost + 1); // truncated entry 2
    const frameBytes = awarenessFrame(encoding.toUint8Array(body));

    const offender = await openRaw(port, VALID_ID);
    const codeP = closedCode(offender);
    offender.send(frameBytes);
    expect(await codeP).toBe(4400);

    // The ghost identity was never applied — awareness is not poisoned.
    expect(room.awareness.getStates().has(ghost)).toBe(false);
    expect(room.awareness.getStates().size).toBe(0);
    expect(healthy.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("stays alive across many malformed frames; a later peer still syncs", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    const healthy = connectYjsClient(port, VALID_ID);
    await waitForText(healthy.doc, SEED);

    const bads = [
      new Uint8Array(0),
      bin(0x80),
      bin(MSG_SYNC, 2, 5),
      bin(MSG_SYNC, 9),
      bin(MSG_AWARENESS, 5),
    ];
    for (const b of bads) {
      const offender = await openRaw(port, VALID_ID);
      const codeP = closedCode(offender);
      offender.send(b);
      expect(await codeP).toBe(4400);
    }
    expect(healthy.ws.readyState).toBe(WebSocket.OPEN);

    const later = connectYjsClient(port, VALID_ID);
    await waitForText(later.doc, SEED);
    expect(app.rooms.size).toBe(1);
  });
});

describe("ws message boundary — oversized input (contained, 4409)", () => {
  it("rejects a raw frame over the frame limit", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    await expectContained(
      app,
      port,
      VALID_ID,
      (ws) => ws.send(new Uint8Array(MAX_WS_FRAME_BYTES + 1)),
      4409,
    );
  });

  it("rejects an oversized sync update WITHOUT mutating the doc", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    const oversized = syncUpdateFrame(new Uint8Array(MAX_WS_SYNC_UPDATE_BYTES + 1));
    // Frame is within the raw limit, but its decoded update exceeds the sync cap.
    expect(oversized.byteLength).toBeLessThan(MAX_WS_FRAME_BYTES);
    await expectContained(app, port, VALID_ID, (ws) => ws.send(oversized), 4409);
  });

  it("rejects an oversized awareness payload, leaving no awareness state", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    const healthy = connectYjsClient(port, VALID_ID);
    await waitForText(healthy.doc, SEED);
    const room = app.rooms.get(VALID_ID);

    const oversized = awarenessFrame(new Uint8Array(MAX_WS_AWARENESS_BYTES + 1));
    expect(oversized.byteLength).toBeLessThan(MAX_WS_FRAME_BYTES);

    const offender = await openRaw(port, VALID_ID);
    const codeP = closedCode(offender);
    offender.send(oversized);
    expect(await codeP).toBe(4409);

    expect(room.awareness.getStates().size).toBe(0);
    expect(healthy.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("ws transport boundary — maxPayload (contained, 1009)", () => {
  it("contains a peer whose message exceeds the transport cap; server, room, and healthy peer survive", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    // One byte over the transport cap (2× the application frame cap). The `ws`
    // receiver rejects this on the reassembled message at the transport layer
    // (close 1009) BEFORE our per-message 4409 boundary runs. expectContained
    // proves the offender is closed with 1009, the healthy peer stays OPEN, the
    // room's live doc is unchanged, and the process is still alive (a later
    // client joins and syncs). The per-socket 'error' listener keeps the
    // oversized-message error from crashing the process.
    await expectContained(
      app,
      port,
      VALID_ID,
      (ws) => ws.send(new Uint8Array(MAX_WS_TRANSPORT_PAYLOAD_BYTES + 1)),
      1009,
    );
  });

  it("keeps the application 4409 boundary authoritative below the transport cap", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    // A frame over the application cap but under the transport cap passes the
    // transport layer and is contained by our per-message boundary as 4409 —
    // proving the two tiers are distinct and the application boundary remains
    // the operative limit for anything below the transport backstop.
    const overAppUnderTransport = MAX_WS_FRAME_BYTES + 1;
    expect(overAppUnderTransport).toBeLessThan(MAX_WS_TRANSPORT_PAYLOAD_BYTES);
    await expectContained(
      app,
      port,
      VALID_ID,
      (ws) => ws.send(new Uint8Array(overAppUnderTransport)),
      4409,
    );
  });
});

describe("ws message boundary — valid regressions", () => {
  it("normal two-client live sync still works", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    const a = connectFullClient(port, VALID_ID);
    const b = connectFullClient(port, VALID_ID);
    await Promise.all([opened(a.ws), opened(b.ws)]);
    await waitForText(a.doc, SEED);
    await waitForText(b.doc, SEED);

    a.doc.getText("content").insert(SEED.length, " more");
    await waitForText(b.doc, "seed more");
  });

  it("normal awareness relay still works", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    const a = connectFullClient(port, VALID_ID);
    const b = connectFullClient(port, VALID_ID);
    await Promise.all([opened(a.ws), opened(b.ws)]);
    await waitForText(a.doc, SEED);
    await waitForText(b.doc, SEED);

    a.awareness.setLocalState({ user: "Ada" });
    await waitForCondition(() => {
      for (const st of b.awareness.getStates().values()) {
        if (st && st.user === "Ada") return true;
      }
      return false;
    });
  });

  it("accepts a large (sub-cap) valid sync update and relays it", async () => {
    const { app, port } = await startApp();
    // Empty durable sheet so the large content arrives as an inbound client push.
    createDurableSheet(app, { sheetId: VALID_ID, text: "" });
    const a = connectFullClient(port, VALID_ID);
    const b = connectFullClient(port, VALID_ID);
    await Promise.all([opened(a.ws), opened(b.ws)]);
    await waitForText(a.doc, "");
    await waitForText(b.doc, "");

    // 200k code units — under the 250k visible-content cap AND the 512 KiB
    // sync-update byte cap: a large but fully valid live sync.
    const big = "x".repeat(200_000);
    a.doc.getText("content").insert(0, big);

    await waitForCondition(
      () => b.doc.getText("content").length === big.length,
      5000,
    );
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("reconnect after a malformed peer succeeds", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    const healthy = connectYjsClient(port, VALID_ID);
    await waitForText(healthy.doc, SEED);

    const offender = await openRaw(port, VALID_ID);
    const codeP = closedCode(offender);
    offender.send(bin(0x80));
    expect(await codeP).toBe(4400);

    // A brand-new client can still join and sync the same room.
    const rejoin = connectYjsClient(port, VALID_ID);
    await waitForText(rejoin.doc, SEED);
    expect(app.rooms.size).toBe(1);
  });
});

describe("ws message boundary — resource cleanup", () => {
  it("removes the offender's owned awareness states on close; reset/shutdown still work", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });

    // A full client publishes presence, then sends one malformed frame and is
    // closed. Its owned awareness state must be gone afterward.
    const bad = connectFullClient(port, VALID_ID);
    await waitForText(bad.doc, SEED);
    bad.awareness.setLocalState({ user: "leaver" });

    const room = app.rooms.get(VALID_ID);
    await waitForCondition(() => room.awareness.getStates().size === 1);
    const badClientId = bad.doc.clientID;
    expect(room.awareness.getStates().has(badClientId)).toBe(true);

    const closed = closedCode(bad.ws);
    bad.ws.send(bin(0x80)); // malformed → server closes this socket
    expect(await closed).toBe(4400);

    // The close-cleanup path removed the offender's owned awareness state.
    await waitForCondition(() => !room.awareness.getStates().has(badClientId));
    expect(room.clients.has(bad.ws)).toBe(false);

    // Durable reset still tears the hydrated room down cleanly.
    const res = await fetch(`http://127.0.0.1:${port}/__test/reset`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(app.rooms.size).toBe(0);

    // And shutdown (via afterEach) still completes without hanging.
    await app.shutdown();
    apps.pop();
    expect(app.state).toBe("stopped");
  });
});

describe("ws message boundary — poisoning regressions (preflight)", () => {
  it("sync: a partial-mutation update leaves the authoritative doc + vector unchanged", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    const healthy = connectYjsClient(port, VALID_ID);
    await waitForText(healthy.doc, SEED);

    // Fixture: a valid update carrying structs AND a delete set, truncated in the
    // delete-set tail so Y.applyUpdate integrates its structs (mutating a target)
    // and THEN throws. The outer frame stays length-framed.
    const src = new Y.Doc();
    const st = src.getText("content");
    st.insert(0, "hello world");
    st.delete(0, 5);
    const full = Y.encodeStateAsUpdate(src);
    src.destroy();
    const fixture = full.slice(0, full.length - 1);

    // Prove the fixture WOULD poison a naive direct-apply target — so the
    // preflight is demonstrably necessary, not incidental.
    const naive = new Y.Doc();
    naive.getText("content");
    let naiveThrew = false;
    try {
      Y.applyUpdate(naive, fixture);
    } catch {
      naiveThrew = true;
    }
    expect(naiveThrew).toBe(true);
    expect(naive.getText("content").toString().length).toBeGreaterThan(0);
    naive.destroy();

    // Snapshot authoritative state, and watch for any relayed (poisoned) update.
    const room = app.rooms.get(VALID_ID);
    const textBefore = room.doc.getText("content").toString();
    const vectorBefore = Y.encodeStateVector(room.doc);
    let healthyChanged = false;
    healthy.doc.getText("content").observe(() => {
      healthyChanged = true;
    });

    const offender = await openRaw(port, VALID_ID);
    const codeP = closedCode(offender);
    offender.send(syncUpdateFrame(fixture));
    expect(await codeP).toBe(4400);

    // Authoritative doc text AND state vector are byte-for-byte unchanged.
    expect(room.doc.getText("content").toString()).toBe(textBefore);
    expect([...Y.encodeStateVector(room.doc)]).toEqual([...vectorBefore]);
    // The healthy peer received no poisoned update and stays connected.
    expect(healthyChanged).toBe(false);
    expect(healthy.ws.readyState).toBe(WebSocket.OPEN);

    // A later valid peer still joins and syncs the ORIGINAL content.
    const later = connectYjsClient(port, VALID_ID);
    await waitForText(later.doc, SEED);
  });

  it("sync: rejects an update whose MERGE exceeds the canonical state cap (each part under its own cap)", async () => {
    const { app, port } = await startApp();

    // Room (client A): structural growth (many non-mergeable 1-char inserts) that
    // stays UNDER both the canonical-byte and visible-content caps, so it is a
    // valid durable sheet. Visible content is small; canonical bytes are large.
    const A = new Y.Doc();
    const ta = A.getText("content");
    for (let i = 0; i < 30000; i++) ta.insert(0, "x");
    const updA = Y.encodeStateAsUpdate(A);
    const vecA = Y.encodeStateVector(A);
    expect(updA.byteLength).toBeLessThan(MAX_CANONICAL_STATE_BYTES);
    app.db.createSheet({
      sheetId: VALID_ID,
      creationToken: "ws-tok-canonical-overflow",
      canonicalUpdate: updA,
      canonicalStateVector: vecA,
      title: "notes",
      language: "typescript",
      schemaVersion: 0,
      committedAt: 4242,
    });
    const roomText = A.getText("content").toString();
    A.destroy();

    // Incoming update (client B): its OWN encoded length is under the per-update
    // cap, but merged with the room it pushes canonical state OVER the cap — while
    // visible content stays under the visible limit (so this exercises byte-size
    // enforcement specifically, not the 250k visible-text limit).
    const B = new Y.Doc();
    Y.applyUpdate(B, updA);
    const tb = B.getText("content");
    for (let i = 0; i < 25000; i++) tb.insert(0, "y");
    const delta = Y.encodeStateAsUpdate(B, vecA);
    B.destroy();
    expect(delta.byteLength).toBeLessThan(MAX_WS_SYNC_UPDATE_BYTES);

    // Prove the fixture: merged canonical exceeds the cap while visible < 250k.
    const merged = new Y.Doc();
    Y.applyUpdate(merged, updA);
    Y.applyUpdate(merged, delta);
    expect(Y.encodeStateAsUpdate(merged).byteLength).toBeGreaterThan(
      MAX_CANONICAL_STATE_BYTES,
    );
    expect(merged.getText("content").toString().length).toBeLessThan(250000);
    merged.destroy();

    // A healthy peer synced to the ORIGINAL room state.
    const healthy = connectYjsClient(port, VALID_ID);
    await waitForText(healthy.doc, roomText, 5000);
    const room = app.rooms.get(VALID_ID);
    const vectorBefore = Y.encodeStateVector(room.doc);
    let healthyChanged = false;
    healthy.doc.getText("content").observe(() => {
      healthyChanged = true;
    });

    const offender = await openRaw(port, VALID_ID);
    const codeP = closedCode(offender);
    offender.send(syncUpdateFrame(delta));
    expect(await codeP).toBe(4400);

    // Authoritative doc text AND state vector are unchanged; peer unaffected.
    expect(room.doc.getText("content").toString()).toBe(roomText);
    expect([...Y.encodeStateVector(room.doc)]).toEqual([...vectorBefore]);
    expect(healthyChanged).toBe(false);
    expect(healthy.ws.readyState).toBe(WebSocket.OPEN);

    // Room remains available; a later valid client still joins and syncs original.
    const later = connectYjsClient(port, VALID_ID);
    await waitForText(later.doc, roomText, 5000);
  });

  it("awareness: a payload overwriting an existing identity is rejected whole (state + meta intact)", async () => {
    const { app, port } = await startApp();
    createDurableSheet(app, { text: SEED });
    const healthy = connectFullClient(port, VALID_ID);
    await waitForText(healthy.doc, SEED);
    healthy.awareness.setLocalState({ user: "Ada" });

    const room = app.rooms.get(VALID_ID);
    const H = healthy.doc.clientID;
    await waitForCondition(() => {
      const s = room.awareness.getStates().get(H);
      return !!s && s.user === "Ada";
    });
    const stateBefore = JSON.stringify(room.awareness.getStates().get(H));
    const clockBefore = room.awareness.meta.get(H).clock;

    // Malformed payload: entry 1 overwrites the existing identity H (higher
    // clock); entry 2 is truncated. Full preflight rejects it before any apply.
    const body = encoding.createEncoder();
    encoding.writeVarUint(body, 2);
    encoding.writeVarUint(body, H);
    encoding.writeVarUint(body, clockBefore + 5);
    encoding.writeVarString(body, JSON.stringify({ user: "HACKED" }));
    encoding.writeVarUint(body, H + 1); // entry 2 truncated (clientID only)

    const offender = await openRaw(port, VALID_ID);
    const codeP = closedCode(offender);
    offender.send(awarenessFrame(encoding.toUint8Array(body)));
    expect(await codeP).toBe(4400);

    // H's state AND meta clock are exactly unchanged; no ghost; peer connected.
    expect(JSON.stringify(room.awareness.getStates().get(H))).toBe(stateBefore);
    expect(room.awareness.meta.get(H).clock).toBe(clockBefore);
    expect(room.awareness.getStates().has(H + 1)).toBe(false);
    expect(healthy.ws.readyState).toBe(WebSocket.OPEN);
  });
});

async function waitForCondition(pred, timeout = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}
