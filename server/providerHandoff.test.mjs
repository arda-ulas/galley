// Real-provider integration for the M4 S3 provider wrapper: actual y-websocket
// providers (using the installed `ws` package as the WebSocket polyfill) attach
// to EXISTING docs/awareness through createSheetProvider and converge through
// the real server over `/ws/:sheetId`. Convergence is asserted against a second
// peer AND the server's own room doc — never via `provider.synced` alone. The
// underlying provider is captured through the injected constructor (a test seam),
// never through the public handle, which intentionally exposes no provider.

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import { createServerApplication } from "./app.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";
import { createSheetProvider } from "../src/lib/providerFactory.ts";

const VALID_ID = "sheetHANDOFF0001";
// Valid SHAPE (16 chars) but never created — resolves to a 4404 "missing", not
// the 4400 "invalid id" a malformed-length id would produce.
const MISSING_ID = "sheetMISSING0002";

const temps = [];
const apps = [];
const sessions = [];

// Structured cleanup: attempt every step, record failures, and surface an
// aggregate afterwards so an unexpected lifecycle failure is never hidden by a
// blanket try/catch. The steps below are all idempotent, so they must not throw
// under normal operation.
afterEach(async () => {
  const errors = [];
  const step = (label, fn) => {
    try {
      fn();
    } catch (e) {
      errors.push({ label, e });
    }
  };
  const stepAsync = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      errors.push({ label, e });
    }
  };

  while (sessions.length) {
    const s = sessions.pop();
    step("handle.destroy", () => s.handle.destroy());
    step("awareness.destroy", () => s.awareness?.destroy());
    step("doc.destroy", () => s.doc?.destroy());
  }
  while (apps.length) await stepAsync("app.shutdown", () => apps.pop().shutdown());
  while (temps.length) await stepAsync("temp.cleanup", () => temps.pop().cleanup());

  if (errors.length) {
    throw new AggregateError(
      errors.map((x) => x.e),
      `integration cleanup failures: ${errors.map((x) => x.label).join(", ")}`,
    );
  }
});

async function startApp() {
  const t = await createTempDb();
  temps.push(t);
  const app = await createServerApplication({
    GALLEY_TEST: "1",
    GALLEY_TEST_DB_PATH: t.dbPath,
    HOST: "127.0.0.1",
    PORT: "0",
  });
  await app.start();
  apps.push(app);
  return { app, port: app.address().port };
}

let tokenCounter = 0;
function seedSheet(app, { sheetId = VALID_ID, text = "seed" } = {}) {
  const doc = new Y.Doc();
  if (text) doc.getText("content").insert(0, text);
  const canonicalUpdate = Y.encodeStateAsUpdate(doc);
  const canonicalStateVector = Y.encodeStateVector(doc);
  doc.destroy();
  app.db.createSheet({
    sheetId,
    creationToken: `handoff-${tokenCounter++}`,
    canonicalUpdate,
    canonicalStateVector,
    title: "notes",
    language: "typescript",
    schemaVersion: 0,
    committedAt: 1,
  });
  return sheetId;
}

/** A counting WebSocket polyfill: records how many sockets get constructed. */
function countingWebSocket() {
  let count = 0;
  class Counting extends WsWebSocket {
    constructor(...args) {
      count++;
      super(...args);
    }
  }
  return {
    WebSocketImpl: Counting,
    get count() {
      return count;
    },
  };
}

/**
 * Attach a real provider to a doc + awareness. By default a fresh pair is
 * created; a caller may pass ALREADY-POPULATED `doc`/`awareness` so the provider
 * is constructed over pre-existing state (true pre-attachment continuity). The
 * provider is captured through the injected constructor (test seam) so
 * assertions never touch the public handle's (absent) provider. `WebSocketImpl`
 * defaults to the installed `ws`; a counting polyfill can be injected to observe
 * socket construction.
 */
function attach(
  port,
  sheetId,
  { doc = new Y.Doc(), awareness = new Awareness(doc), WebSocketImpl = WsWebSocket, ...handlers } = {},
) {
  let provider;
  class Capturing extends WebsocketProvider {
    constructor(serverUrl, room, d, opts) {
      super(serverUrl, room, d, { ...opts, WebSocketPolyfill: WebSocketImpl });
      provider = this;
    }
  }
  const handle = createSheetProvider({
    sheetId,
    doc,
    awareness,
    serverUrl: `ws://127.0.0.1:${port}/ws`,
    WebsocketProviderCtor: Capturing,
    ...handlers,
  });
  const session = {
    doc,
    awareness,
    handle,
    get provider() {
      return provider;
    },
  };
  sessions.push(session);
  return session;
}

const text = (doc) => doc.getText("content").toString();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, label = "condition", timeout = 8000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${label}`);
    await delay(15);
  }
}

describe("provider handoff — real providers converge through the server", () => {
  it("two providers attach through /ws/{id}, reuse exact primitives, and converge both ways", async () => {
    const { app, port } = await startApp();
    seedSheet(app, { text: "seed" });

    const a = attach(port, VALID_ID);
    const aClientId = a.doc.clientID;
    a.handle.connect();
    await waitFor(() => text(a.doc) === "seed", "A initial sync");

    const b = attach(port, VALID_ID);
    b.handle.connect();
    await waitFor(() => text(b.doc) === "seed", "B initial sync");

    // The provider attached to the EXACT supplied doc + awareness (not copies).
    expect(a.provider.doc).toBe(a.doc);
    expect(a.provider.awareness).toBe(a.awareness);
    // Awareness client id is unchanged across attachment.
    expect(a.awareness.clientID).toBe(aClientId);
    expect(a.doc.clientID).toBe(aClientId);
    // disableBc:true — no BroadcastChannel; convergence depends on the server path.
    expect(a.provider.bcconnected).toBe(false);
    expect(b.provider.bcconnected).toBe(false);

    // Both directions converge, and the SERVER room doc reflects the result.
    a.doc.getText("content").insert(4, " A");
    await waitFor(() => text(b.doc) === "seed A", "A→B convergence");
    b.doc.getText("content").insert(text(b.doc).length, " B");
    await waitFor(() => text(a.doc) === "seed A B", "B→A convergence");
    await waitFor(
      () => app.rooms.get(VALID_ID)?.doc.getText("content").toString() === "seed A B",
      "server room convergence",
    );
  });

  it("pre-attachment doc + awareness survive attachment and become observable remotely", async () => {
    const { app, port } = await startApp();
    seedSheet(app, { text: "" }); // empty durable sheet

    // 1–2: create the doc and an Awareness bound to it BEFORE any provider exists.
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    // 3–4: populate local content and Awareness state BEFORE attachment.
    doc.getText("content").insert(0, "local-first");
    awareness.setLocalState({ user: "Ada", color: "#123456" });
    // 5: record identities of the pre-populated objects.
    const docClientId = doc.clientID;
    const awarenessClientId = awareness.clientID;

    // 6: construct the provider over the ALREADY-POPULATED exact objects.
    const a = attach(port, VALID_ID, { doc, awareness });
    expect(a.doc).toBe(doc); // attach used our objects; it created no new ones
    expect(a.awareness).toBe(awareness);
    expect(a.provider.doc).toBe(doc);
    expect(a.provider.awareness).toBe(awareness);

    // 7: connect.
    a.handle.connect();
    await waitFor(() => a.provider.wsconnected, "A connected");

    // 8: local content + identities are unchanged by attachment/connect.
    expect(text(doc)).toBe("local-first");
    expect(doc.clientID).toBe(docClientId);
    expect(awareness.clientID).toBe(awarenessClientId);
    expect(awarenessClientId).toBe(docClientId); // awareness bound to the same doc
    expect(a.provider.bcconnected).toBe(false);

    // A peer observes the pre-existing content AND awareness through the server.
    const b = attach(port, VALID_ID);
    b.handle.connect();
    await waitFor(
      () => text(b.doc) === "local-first",
      "B receives A's pre-existing content",
    );
    await waitFor(() => {
      for (const st of b.awareness.getStates().values()) {
        if (st && st.user === "Ada") return true;
      }
      return false;
    }, "B observes A's pre-existing awareness");
    expect(b.provider.bcconnected).toBe(false);
    // Identities remain unchanged throughout.
    expect(doc.clientID).toBe(docClientId);
    expect(awareness.clientID).toBe(awarenessClientId);
  });

  it("real provider with connect:false constructs zero WebSockets until connect()", async () => {
    const { app, port } = await startApp();
    seedSheet(app, { text: "seed" });
    const counter = countingWebSocket();

    const s = attach(port, VALID_ID, { WebSocketImpl: counter.WebSocketImpl });
    // Construction alone (connect:false) opens no socket.
    expect(counter.count).toBe(0);

    s.handle.connect();
    await waitFor(() => text(s.doc) === "seed", "sync after explicit connect");
    expect(counter.count).toBe(1); // exactly one socket for the initial connect

    // The real provider installs listeners/timers even without connecting, so the
    // handle must be destroyed (afterEach also does this idempotently).
    s.handle.destroy();
    expect(s.handle.destroyed).toBe(true);
  });

  it("terminal 4404: exactly one connection attempt, then no reconnect", async () => {
    const { port } = await startApp();
    const counter = countingWebSocket();
    let terminal = null;
    const s = attach(port, MISSING_ID, {
      WebSocketImpl: counter.WebSocketImpl,
      onTerminal: (r) => (terminal = r),
    });
    s.handle.connect();

    await waitFor(() => terminal !== null, "terminal report");
    expect(terminal).toEqual({ code: 4404, reason: "unavailable" });
    await waitFor(() => s.handle.destroyed, "handle destroyed");
    expect(counter.count).toBe(1); // the single terminal attempt

    // Wait beyond the first reconnect backoff window (~200 ms) to prove the
    // scheduled setupWS was suppressed: no additional socket is constructed.
    await delay(600);
    expect(counter.count).toBe(1);
    expect(s.provider.shouldConnect).toBe(false);
    expect(s.provider.wsconnected).toBe(false);
  });

  it("transient 1011 close is retryable: reconnects and eventually syncs", async () => {
    const { app, port } = await startApp();
    seedSheet(app, { text: "seed" });
    // One-shot server-side hydration failure → the first join closes 1011.
    app.__test.failNextRoomBuild();

    let terminal = null;
    const s = attach(port, VALID_ID, { onTerminal: (r) => (terminal = r) });
    s.handle.connect();

    // The wrapper must NOT treat 1011 as terminal; y-websocket reconnects and
    // the second (fault-cleared) hydration syncs the durable content.
    await waitFor(() => text(s.doc) === "seed", "reconnect + sync after 1011");
    expect(terminal).toBeNull();
    expect(s.handle.destroyed).toBe(false);
    expect(s.provider.wsconnected).toBe(true);
  });
});
