// Narrow real-server integration for the M4 S4 Share coordinator: drive
// shareDraftSession() against the actual create endpoint, confirm a durable
// sheet is created (via the bootstrap endpoint), and prove the provider attached
// to the session's own doc and converges with a second peer through the server.

import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WebSocket as WsWebSocket } from "ws";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import { createServerApplication } from "./app.mjs";
import { loadValidatedSheet } from "./loadValidatedSheet.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";
import { createDraftSession } from "../src/lib/draftSession.ts";
import { shareDraftSession } from "../src/lib/shareCoordinator.ts";
import { createSheetProvider } from "../src/lib/providerFactory.ts";

const temps = [];
const apps = [];
const cleanups = [];

afterEach(async () => {
  const errors = [];
  for (const c of cleanups.splice(0).reverse()) {
    try {
      c();
    } catch (e) {
      errors.push(e);
    }
  }
  while (apps.length) {
    try {
      await apps.pop().shutdown();
    } catch (e) {
      errors.push(e);
    }
  }
  while (temps.length) await temps.pop().cleanup();
  if (errors.length) {
    throw new AggregateError(errors, "integration cleanup failures");
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
  return { app, port: app.address().port, dbPath: t.dbPath };
}

/**
 * Count durable sheet rows on a throwaway (WAL-safe) connection, straight from
 * the database — used to prove an idempotent same-token retry collapses to
 * EXACTLY ONE durable sheet rather than creating a second.
 */
function durableSheetCount(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    return Number(db.prepare("SELECT COUNT(*) AS c FROM sheets").get().c);
  } finally {
    db.close();
  }
}

class NodeWebsocketProvider extends WebsocketProvider {
  constructor(serverUrl, room, doc, opts) {
    super(serverUrl, room, doc, { ...opts, WebSocketPolyfill: WsWebSocket });
  }
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

/**
 * Read the DURABLE content persisted for a sheet, straight from the database via
 * the same validated-load boundary the server uses — never through the WebSocket
 * transport. Used to prove the HTTP create persisted the initial snapshot BEFORE
 * any socket could have uploaded anything.
 */
function durableText(db, sheetId) {
  const loaded = loadValidatedSheet({ db, sheetId });
  if (!loaded.ok) throw new Error(`durable load failed: ${loaded.reason}`);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, loaded.canonicalUpdate);
    return doc.getText("content").toString();
  } finally {
    doc.destroy();
  }
}

/**
 * A provider seam that records interactions but NEVER opens a socket. Used to
 * assert durable state after POST while guaranteeing the WebSocket transport
 * cannot be the source of the persisted content.
 */
function nonConnectingProviderSeam() {
  const rec = { createCalls: 0, connectCalls: 0, destroyed: false, lastOpts: null };
  return {
    rec,
    create(opts) {
      rec.createCalls++;
      rec.lastOpts = opts;
      return {
        connect() {
          rec.connectCalls++; // deliberately opens no socket
        },
        destroy() {
          rec.destroyed = true;
        },
        get destroyed() {
          return rec.destroyed;
        },
      };
    },
  };
}

/** A provider seam whose construction always throws (models a pre-transfer, but
 *  post-remote-create, provider failure). */
function throwingProviderSeam() {
  const rec = { createCalls: 0 };
  return {
    rec,
    create() {
      rec.createCalls++;
      throw new Error("provider construction failed");
    },
  };
}

/** A provider seam that delegates to the real factory but COUNTS how many
 *  provider constructions actually succeed (open a real socket-capable handle). */
function countingProviderSeam() {
  const rec = { createCalls: 0, successes: 0 };
  return {
    rec,
    create(opts) {
      rec.createCalls++;
      const handle = createSheetProvider(opts);
      rec.successes++;
      return handle;
    },
  };
}

describe("share coordinator — real create + convergence", () => {
  it("shares a local draft into a durable sheet and converges with a peer", async () => {
    const { port } = await startApp();

    // A real local draft session with pre-share content.
    const session = createDraftSession();
    cleanups.push(() => session.disposeUnlessTransferred());
    session.text.insert(0, "shared body");
    const doc = session.doc;
    const awareness = session.awareness;

    const result = await shareDraftSession({
      session,
      title: "notes",
      language: "typescript",
      creationToken: randomUUID(),
      fetch: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init),
      serverUrl: `ws://127.0.0.1:${port}/ws`,
      WebsocketProviderCtor: NodeWebsocketProvider,
    });
    cleanups.push(() => result.controller.dispose());

    expect(result.sheetId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    // Exact primitives are preserved (no reconstruction across the share).
    expect(session.doc).toBe(doc);
    expect(session.awareness).toBe(awareness);
    // Ownership transferred: local unmount path is now a no-op.
    session.disposeUnlessTransferred();
    expect(session.destroyed).toBe(false);

    // The sheet is durably present — bootstrap returns matching metadata.
    const boot = await fetch(`http://127.0.0.1:${port}/api/sheets/${result.sheetId}`);
    expect(boot.status).toBe(200);
    const meta = await boot.json();
    expect(meta.sheetId).toBe(result.sheetId);
    expect(meta.title).toBe("notes");
    expect(meta.language).toBe("typescript");

    // A second peer joins the same sheet and receives the shared content THROUGH
    // the server — proving the provider attached to the session's doc + connected.
    const docB = new Y.Doc();
    const awB = new Awareness(docB);
    const handleB = createSheetProvider({
      sheetId: result.sheetId,
      doc: docB,
      awareness: awB,
      serverUrl: `ws://127.0.0.1:${port}/ws`,
      WebsocketProviderCtor: NodeWebsocketProvider,
    });
    cleanups.push(() => {
      handleB.destroy();
      awB.destroy();
      docB.destroy();
    });
    handleB.connect();
    await waitFor(() => text(docB) === "shared body", "peer receives shared content");

    // A live edit on the shared original session propagates to the peer.
    session.text.insert(session.text.length, "!");
    await waitFor(() => text(docB) === "shared body!", "peer receives live edit");
  });

  it("a malformed-token share is rejected and leaves the draft fully local", async () => {
    const { port } = await startApp();
    const session = createDraftSession();
    cleanups.push(() => session.disposeUnlessTransferred());
    session.text.insert(0, "still local");

    // The server requires a UUID v4 creation token; a bad token → 400 rejection.
    const err = await shareDraftSession({
      session,
      title: "notes",
      language: "typescript",
      creationToken: "not-a-uuid",
      fetch: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init),
      serverUrl: `ws://127.0.0.1:${port}/ws`,
      WebsocketProviderCtor: NodeWebsocketProvider,
    }).then(
      () => {
        throw new Error("expected rejection");
      },
      (e) => e,
    );

    expect(err.name).toBe("ShareError");
    expect(err.stage).toBe("rejected");
    expect(err.localIntact).toBe(true);
    // The draft is untouched and still locally owned.
    expect(session.destroyed).toBe(false);
    expect(text(session.doc)).toBe("still local");
  });
});

describe("share coordinator — durable initial snapshot proof", () => {
  // Prove the HTTP create PERSISTED the initial content BEFORE any WebSocket
  // transport could have uploaded it: a non-connecting provider seam guarantees
  // no socket is ever opened, so the durable state can only come from the POST.
  it.each([
    ["unicode content", "üñîçødé → 世界 🚀 tab\tend"],
    ["materially larger content", "x".repeat(40_000) + "…TAIL"],
  ])("persists %s through the HTTP create, not WebSocket sync", async (_label, content) => {
    const { app, port } = await startApp();
    const session = createDraftSession();
    cleanups.push(() => session.disposeUnlessTransferred());
    session.text.insert(0, content);
    const doc = session.doc;

    const seam = nonConnectingProviderSeam();
    const result = await shareDraftSession({
      session,
      title: "notes",
      language: "typescript",
      creationToken: randomUUID(),
      fetch: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init),
      createProvider: seam.create,
    });
    cleanups.push(() => result.controller.dispose());

    // No socket was ever opened by this share.
    expect(seam.rec.connectCalls).toBe(1); // connect() called, but it opens nothing
    expect(result.status).toBe("connected");
    expect(session.doc).toBe(doc); // exact primitive preserved

    // The committed durable update already contains the initial draft state —
    // read straight from the DB, never through the WebSocket transport.
    expect(durableText(app.db, result.sheetId)).toBe(content);
  });

  it("the initial durable snapshot reflects the pre-request state; a later in-flight edit reaches the room over WebSocket", async () => {
    const { app, port } = await startApp();
    const session = createDraftSession();
    cleanups.push(() => session.disposeUnlessTransferred());
    session.text.insert(0, "base"); // pre-request content
    const doc = session.doc;
    const awareness = session.awareness;
    const undoManager = session.undoManager;

    // Hold the POST open so we can edit the SAME doc while it is in flight. The
    // submission snapshot is encoded synchronously before fetch is awaited, so the
    // in-flight edit is deliberately NOT part of the durable create.
    let releaseFetch;
    const gate = new Promise((r) => {
      releaseFetch = r;
    });
    const doFetch = async (path, init) => {
      await gate;
      return fetch(`http://127.0.0.1:${port}${path}`, init);
    };

    const sharePromise = shareDraftSession({
      session,
      title: "notes",
      language: "typescript",
      creationToken: randomUUID(),
      fetch: doFetch,
      serverUrl: `ws://127.0.0.1:${port}/ws`,
      WebsocketProviderCtor: NodeWebsocketProvider,
    });

    // The synchronous prologue has already encoded "base"; edit the same doc now.
    await Promise.resolve();
    session.text.insert(session.text.length, "-live");
    releaseFetch();

    const result = await sharePromise;
    cleanups.push(() => result.controller.dispose());
    expect(result.status).toBe("connected");

    // No collaboration primitive was replaced across the in-flight window.
    expect(session.doc).toBe(doc);
    expect(session.awareness).toBe(awareness);
    expect(session.undoManager).toBe(undoManager);

    // The durable snapshot is the PRE-request state — the in-flight edit is not in
    // it (live WebSocket updates are relayed, not persisted).
    expect(durableText(app.db, result.sheetId)).toBe("base");

    // A peer that joins over WebSocket receives BOTH the base snapshot and the
    // in-flight edit — no edit was lost.
    const docB = new Y.Doc();
    const awB = new Awareness(docB);
    const handleB = createSheetProvider({
      sheetId: result.sheetId,
      doc: docB,
      awareness: awB,
      serverUrl: `ws://127.0.0.1:${port}/ws`,
      WebsocketProviderCtor: NodeWebsocketProvider,
    });
    cleanups.push(() => {
      handleB.destroy();
      awB.destroy();
      docB.destroy();
    });
    handleB.connect();
    await waitFor(() => text(docB) === "base-live", "peer receives base + in-flight edit");
  });
});

describe("share coordinator — remote-created retry recovery", () => {
  it("directly proves 201-then-200 idempotent recovery: one durable sheet, one successful provider attachment", async () => {
    const { app, port, dbPath } = await startApp();
    const session = createDraftSession();
    cleanups.push(() => session.disposeUnlessTransferred());
    session.text.insert(0, "recoverable body");
    const doc = session.doc;
    const token = randomUUID();

    // Observe the ACTUAL create-endpoint HTTP status of each POST (reading
    // res.status does not consume the body the coordinator later parses).
    const createStatuses = [];
    const doFetch = async (path, init) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
      if (init?.method === "POST" && path === "/api/sheets") {
        createStatuses.push(res.status);
      }
      return res;
    };

    // (1)+(2) First attempt: the server genuinely creates the sheet, then provider
    // construction DELIBERATELY fails — a pre-transfer failure that nonetheless
    // left a durable remote sheet.
    const failing = throwingProviderSeam();
    const err = await shareDraftSession({
      session,
      title: "notes",
      language: "typescript",
      creationToken: token,
      fetch: doFetch,
      createProvider: failing.create,
    }).then(
      () => {
        throw new Error("expected rejection");
      },
      (e) => e,
    );

    // (1) The initial create returned HTTP 201 (directly observed, not inferred).
    expect(createStatuses).toEqual([201]);
    // (2) Provider construction was attempted and failed.
    expect(failing.rec.createCalls).toBe(1);
    // (3) The typed error carries remoteCreated + sheetId + receipt.
    expect(err.name).toBe("ShareError");
    expect(err.stage).toBe("provider");
    expect(err.remoteCreated).toBe(true);
    expect(err.localIntact).toBe(true); // draft still local → safe to retry
    expect(err.receipt).toBeTruthy();
    expect(err.sheetId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    // The remote sheet is genuinely durable already, and exactly one exists.
    expect(durableText(app.db, err.sheetId)).toBe("recoverable body");
    expect(durableSheetCount(dbPath)).toBe(1);
    expect(session.destroyed).toBe(false);
    expect(session.doc).toBe(doc);

    // Retry with the SAME creation token; count how many providers actually build.
    const counting = countingProviderSeam();
    const result = await shareDraftSession({
      session,
      title: "notes",
      language: "typescript",
      creationToken: token,
      fetch: doFetch,
      createProvider: counting.create,
      serverUrl: `ws://127.0.0.1:${port}/ws`,
      WebsocketProviderCtor: NodeWebsocketProvider,
    });
    cleanups.push(() => result.controller.dispose());

    expect(result.status).toBe("connected");
    // (4) The same-token retry replayed idempotently → HTTP 200 (directly observed).
    expect(createStatuses).toEqual([201, 200]);
    // (5) Both responses reference the identical sheet id + server revision.
    expect(result.sheetId).toBe(err.sheetId);
    expect(result.receipt.serverRevision).toBe(err.receipt.serverRevision);
    // (6) Exactly ONE durable sheet exists — the retry did not create a second.
    expect(durableSheetCount(dbPath)).toBe(1);
    // (7) Exactly ONE provider construction succeeded (the first threw; the retry
    //     built exactly one real handle).
    expect(failing.rec.createCalls).toBe(1);
    expect(counting.rec.successes).toBe(1);

    // The single durable sheet is bootstrappable and holds the original content.
    const boot = await fetch(`http://127.0.0.1:${port}/api/sheets/${result.sheetId}`);
    expect(boot.status).toBe(200);
    expect(durableText(app.db, result.sheetId)).toBe("recoverable body");
  });
});
