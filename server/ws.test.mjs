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
import { createServerApplication } from "./app.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";

const MSG_SYNC = 0;

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

async function waitForCondition(pred, timeout = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}
