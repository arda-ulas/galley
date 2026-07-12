// Server composition/lifecycle layer. `createServerApplication(env)` resolves
// configuration, opens (and migrates) the single SQLite adapter, creates the one
// process-owned write queue, constructs the HTTP + WebSocket servers, and exposes
// an explicit start()/shutdown() lifecycle. `server/index.mjs` is a thin entry
// that only wires this factory to process signals.
//
// Test-mode boundary (single source of truth):
// - ECHO_REWIND_TEST=1 is the ONLY server-level test flag.
// - Under it, GALLEY_TEST_DB_PATH is REQUIRED and is passed straight to
//   openDatabase(); normal mode ignores it and uses the fixed production path.
// - The persistence layer no longer reads any environment variable.
//
// The dormant WebSocket room behavior (single-doc-per-path collaboration,
// awareness relay) lives here. A newly created room starts EMPTY — there is no
// server-side starter seeding; a room only holds content once durable room
// loading is wired or clients write to it. The test-only /__test/reset route
// currently clears only live in-memory rooms (destroying each Awareness/Y.Doc)
// and does not clear durable DB state; it never recreates any content.

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { openDatabase, PRODUCTION_DB_PATH } from "./persistence/db.mjs";
import { createWriteQueue } from "./persistence/writeQueue.mjs";
import { createRateLimiter } from "./rateLimiter.mjs";
import { generateSheetId } from "./sheetId.mjs";
import { handleCreateSheet } from "./sheets.mjs";
import { respondInternalError } from "./errors.mjs";
import {
  RATE_LIMIT_IP_MAX,
  RATE_LIMIT_TOKEN_MAX,
  RATE_LIMIT_WINDOW_MS,
} from "./limits.mjs";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

/**
 * Resolve server configuration from an environment object.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ testMode: boolean, dbPath: string, host: string, port: number }}
 */
export function resolveConfig(env) {
  const testMode = env.ECHO_REWIND_TEST === "1";
  let dbPath;
  if (testMode) {
    if (!env.GALLEY_TEST_DB_PATH) {
      throw new Error(
        "ECHO_REWIND_TEST=1 requires GALLEY_TEST_DB_PATH to be set",
      );
    }
    dbPath = env.GALLEY_TEST_DB_PATH;
  } else {
    // Normal mode: the DB path is fixed and NOT overridable from the environment.
    dbPath = PRODUCTION_DB_PATH;
  }
  const host = env.HOST ?? "127.0.0.1";
  const port = Number(env.PORT ?? "1234");
  return { testMode, dbPath, host, port };
}

/**
 * Construct a fully-wired server application. Opens the database eagerly, so a
 * DB-open/migration failure rejects here (before any port is bound). Nothing is
 * listening until start() is called.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ dbFaults?: object, faults?: { closeWss?: boolean }, hooks?: { beforeListen?: () => Promise<void> }, clock?: { now: () => number }, generateSheetId?: () => string }} [options] test seams (never used in production)
 */
export async function createServerApplication(env = process.env, options = {}) {
  const config = resolveConfig(env);
  // Cleanup-phase fault injection (test-only): deterministically force an
  // intermediate close failure to prove cleanup still runs to completion.
  const faults = options.faults ?? {};

  // Open/migrate SQLite BEFORE constructing servers. A failure here throws and
  // no HTTP/WS resource is ever created, so no port can be bound.
  const db = openDatabase(config.dbPath, { faults: options.dbFaults });

  // One process-owned write queue. Unused in commit 1 (creation lands in later
  // commits); constructed here so ownership lives with the application.
  const writeQueue = createWriteQueue();

  // Process-owned create rate limiter (per IP + per creation token). The clock
  // and id minter are injectable test seams; production uses the real ones.
  const rateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT_WINDOW_MS,
    ipLimit: RATE_LIMIT_IP_MAX,
    tokenLimit: RATE_LIMIT_TOKEN_MAX,
    clock: options.clock ?? Date,
  });
  const mintSheetId = options.generateSheetId ?? generateSheetId;

  // Per-application in-memory rooms. Instance-scoped (not module-level) so tests
  // can run isolated applications and shutdown() can deterministically release
  // every doc/awareness handle.
  /** @type {Map<string, { doc: Y.Doc, awareness: awarenessProtocol.Awareness, clients: Map<import('ws').WebSocket, Set<number>> }>} */
  const rooms = new Map();

  function getRoom(name) {
    const existing = rooms.get(name);
    if (existing) return existing;

    // A fresh room starts empty — no server-side starter seeding. Content
    // arrives from durable state once durable room loading is wired, or from
    // connected clients' own edits.
    const doc = new Y.Doc();

    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // server has no presence of its own
    /** @type {Map<import('ws').WebSocket, Set<number>>} */
    const clients = new Map();

    doc.on("update", (update, origin) => {
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
    // clean them up on disconnect (prevents stale states poisoning awareness).
    awareness.on("update", ({ added, updated, removed }, origin) => {
      if (origin !== null && clients.has(origin)) {
        const ids = clients.get(origin);
        for (const id of added) ids.add(id);
        for (const id of updated) ids.add(id);
        for (const id of removed) ids.delete(id);
      }

      const changed = [...added, ...updated, ...removed];
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
      );
      const msg = encoding.toUint8Array(enc);
      clients.forEach((_, client) => {
        if (client.readyState === 1 /* OPEN */) client.send(msg);
      });
    });

    const room = { doc, awareness, clients };
    rooms.set(name, room);
    return room;
  }

  /**
   * Fully dispose a single room: drop its clients, then destroy the Yjs
   * Awareness and Y.Doc so no observer handles linger. Clearing the room's
   * client map first means each terminated socket's 'close' handler finds no
   * owned ids and never touches the (now destroyed) awareness.
   * @param {{ doc: Y.Doc, awareness: awarenessProtocol.Awareness, clients: Map<import('ws').WebSocket, Set<number>> }} room
   */
  function disposeRoom(room) {
    for (const client of room.clients.keys()) {
      try {
        client.terminate();
      } catch {
        // best-effort: the socket may already be closing
      }
    }
    room.clients.clear();
    room.awareness.destroy();
    room.doc.destroy();
  }

  /** Dispose every room's Yjs resources, then empty the map. Shared by the
   * legacy reset route and shutdown so neither leaks docs/awareness. */
  function disposeAllRooms() {
    for (const room of rooms.values()) disposeRoom(room);
    rooms.clear();
  }

  // Single HTTP server handles WebSocket upgrades and the test-only reset
  // endpoint. Both share the port so Playwright's webServer port check still works.
  const httpServer = createServer((req, res) => {
    if (
      config.testMode &&
      req.method === "POST" &&
      req.url === "/__test/reset"
    ) {
      // Destroy every room's Yjs resources (not just drop the map entries)
      // before responding, so a reset cannot leak docs/awareness.
      disposeAllRooms();
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.method === "POST" && req.url === "/api/sheets") {
      handleCreateSheet(req, res, {
        db,
        rateLimiter,
        generateSheetId: mintSheetId,
      }).catch((err) => {
        // The handler owns its own error responses; this is a last-resort guard
        // so an unexpected throw never leaves the socket hanging. Uses the safe
        // centralized responder so it can never double-end.
        console.error("create-sheet dispatch error:", err);
        respondInternalError(res);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws, req) => {
    const rawPath = req.url ?? "/demo";
    const roomName = rawPath.split("?")[0].replace(/^\//, "") || "demo";
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
        awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          Array.from(awarenessStates.keys()),
        ),
      );
      ws.send(encoding.toUint8Array(awEnc));
    }

    ws.on("message", (rawData) => {
      const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const msgType = decoding.readVarUint(decoder);

      if (msgType === MSG_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, enc, doc, ws);
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
      } else if (msgType === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        );
      }
    });

    ws.on("close", () => {
      const ownedIds = clients.get(ws);
      clients.delete(ws);
      if (ownedIds && ownedIds.size > 0) {
        awarenessProtocol.removeAwarenessStates(
          awareness,
          Array.from(ownedIds),
          null,
        );
      }
    });
  });

  // Test-only hooks. `beforeListen` lets a test deterministically pause start()
  // just before the port binds, to exercise the shutdown-during-starting race.
  const hooks = options.hooks ?? {};

  // Lifecycle state machine. shutdown() must work from every state and stay
  // truthful under every interleaving with start(). "stopped" means every owned
  // resource is actually closed; "cleanup_failed" means a cleanup step left a
  // resource open and a later shutdown() may retry.
  //   constructed → starting → running → stopping → stopped
  //                          ↘ failed  ↗        ↘ cleanup_failed ↩ (retry)
  /** @type {'constructed'|'starting'|'running'|'failed'|'stopping'|'stopped'|'cleanup_failed'} */
  let state = "constructed";
  /** True once shutdown() has been requested; start() must not reach running. */
  let shutdownRequested = false;
  /** @type {Promise<void> | null} resolves when an in-flight start() settles. */
  let startSettled = null;
  /** @type {Promise<void> | null} shared shutdown promise; cleared to allow retry. */
  let shutdownPromise = null;
  /** @type {((err: Error) => void) | null} reject fn while a start() is pending */
  let pendingStartReject = null;
  /** Once the WS server has been closed, never call close() on it again. */
  let wssClosed = false;

  /** Settle any pending start() rejection exactly once (never left stale). */
  function rejectPendingStart(err) {
    if (pendingStartReject) {
      const reject = pendingStartReject;
      pendingStartReject = null;
      reject(err);
    }
  }

  // `ws` forwards the underlying HTTP server's 'error' event onto the
  // WebSocketServer instance. A missing handler here turns a listen failure
  // (e.g. EADDRINUSE) into an unhandled 'error' event that crashes the process.
  // While a start() is pending, route it to that start's rejection; afterwards,
  // log it so a runtime socket error can never take the process down silently.
  wss.on("error", (err) => {
    if (pendingStartReject) {
      rejectPendingStart(err);
    } else {
      console.error("WebSocket server error:", err);
    }
  });

  /**
   * Run one cleanup step, recording (not throwing) any error so later steps —
   * crucially the DB close — always run. ERR_SERVER_NOT_RUNNING is a benign
   * no-op (the server was never/already closed).
   * @param {string} name
   * @param {() => void | Promise<void>} fn
   * @param {Array<{ step: string, error: unknown }>} errors
   */
  async function runCleanupStep(name, fn, errors) {
    try {
      await fn();
    } catch (err) {
      if (err && err.code === "ERR_SERVER_NOT_RUNNING") return;
      errors.push({ step: name, error: err });
    }
  }

  /**
   * Single cleanup pipeline shared by graceful shutdown and failed-start
   * teardown. Every step is attempted and is idempotent, so a retry after a
   * failed attempt only redoes the steps that did not complete. Returns the
   * collected step errors (empty when cleanup fully succeeded).
   * @returns {Promise<Array<{ step: string, error: unknown }>>}
   */
  async function performCleanup() {
    const errors = [];

    // 1. Stop accepting new HTTP connections / WS upgrades — only while the
    //    server is still listening (idempotent across retries). Register the
    //    close callback now; it resolves once every connection is gone.
    let httpClosed = Promise.resolve();
    if (httpServer.listening) {
      httpClosed = new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err && err.code !== "ERR_SERVER_NOT_RUNNING") reject(err);
          else resolve();
        });
      });
    }

    // 2. Terminate live WebSocket clients so their sockets free up.
    await runCleanupStep(
      "terminate-clients",
      () => {
        for (const client of wss.clients) client.terminate();
      },
      errors,
    );

    // 3. Close the WS server once (fires when all clients have disconnected). A
    //    test-only fault can force this to fail to prove cleanup continues.
    await runCleanupStep(
      "close-wss",
      async () => {
        if (wssClosed) return;
        if (faults.closeWss) throw new Error("injected wss close failure");
        await new Promise((resolve, reject) => {
          wss.close((err) => (err ? reject(err) : resolve()));
        });
        wssClosed = true;
      },
      errors,
    );

    // 4. Destroy every room's Yjs awareness/doc, then empty the map
    //    (idempotent: an already-empty map is a no-op).
    await runCleanupStep("dispose-rooms", () => disposeAllRooms(), errors);

    // 5. Force-close any lingering keep-alive HTTP sockets, then await close.
    await runCleanupStep(
      "close-http",
      async () => {
        httpServer.closeAllConnections?.();
        await httpClosed;
      },
      errors,
    );

    // 6. Clear rate-limiter state.
    await runCleanupStep("clear-rate-limiter", () => rateLimiter.clear(), errors);

    // 7. Close SQLite LAST — always attempted, even if earlier steps failed.
    //    db.close() is idempotent (a no-op once closed), so retries are safe.
    await runCleanupStep("close-db", () => db.close(), errors);

    return errors;
  }

  /** One shutdown attempt: coordinate with an in-flight start, run cleanup, and
   * set a truthful terminal state. On failure it clears shutdownPromise so a
   * later shutdown() retries the steps that did not complete. */
  async function runShutdownAttempt() {
    // Coordinate with an in-flight start(): wait for it to settle so cleanup
    // runs against the final resource state (and closes any port it bound).
    // startSettled never rejects, so a listen failure cannot escape here.
    if (state === "starting" && startSettled) {
      await startSettled;
    }
    state = "stopping";
    const errors = await performCleanup();
    if (errors.length > 0) {
      state = "cleanup_failed";
      shutdownPromise = null; // allow a subsequent shutdown() to retry
      throw new AggregateError(
        errors.map((e) => e.error),
        `shutdown cleanup failed in step(s): ${errors.map((e) => e.step).join(", ")}`,
      );
    }
    state = "stopped";
  }

  /**
   * Idempotent shutdown. Concurrent/repeat calls share one in-flight promise;
   * after a fully successful stop the same settled promise is returned; after a
   * failed attempt a fresh call retries the remaining cleanup.
   */
  function shutdown() {
    shutdownRequested = true;
    if (!shutdownPromise) {
      shutdownPromise = runShutdownAttempt();
    }
    return shutdownPromise;
  }

  /**
   * Begin listening; await the bind. If shutdown() is requested while starting,
   * shutdown wins: start() does not transition to running, waits for shutdown to
   * close any bound server, and rejects. A listen failure runs the shared
   * cleanup and rejects with the listen error.
   */
  async function start() {
    if (state !== "constructed") {
      throw new Error(`cannot start from state "${state}"`);
    }
    state = "starting";
    let settle;
    startSettled = new Promise((resolve) => {
      settle = resolve;
    });

    let listenError = null;
    try {
      if (hooks.beforeListen) await hooks.beforeListen();
      await new Promise((resolve, reject) => {
        pendingStartReject = reject;
        httpServer.listen(config.port, config.host, () => {
          pendingStartReject = null;
          resolve();
        });
      });
      // Bound successfully. Only reach running if no shutdown intervened; a
      // requested shutdown will close the just-bound server.
      if (!shutdownRequested) state = "running";
    } catch (err) {
      listenError = err;
      if (!shutdownRequested) state = "failed";
    } finally {
      pendingStartReject = null;
      settle(); // release any shutdown awaiting start settlement
    }

    if (shutdownRequested) {
      // Shutdown supersedes this start; wait for it to finish closing every
      // resource (incl. any port bound above), then report startup aborted.
      await shutdown().catch(() => {});
      throw new Error("startup aborted by shutdown");
    }
    if (listenError) {
      // Nothing bound → run the shared cleanup so no handle (esp. the DB) leaks.
      await shutdown().catch(() => {});
      throw listenError;
    }
  }

  return {
    config,
    db,
    writeQueue,
    rateLimiter,
    // Test seams — never used by production callers.
    rooms,
    getRoom,
    disposeAllRooms,
    get state() {
      return state;
    },
    get httpServer() {
      return httpServer;
    },
    get wss() {
      return wss;
    },
    address() {
      return httpServer.address();
    },
    start,
    shutdown,
  };
}
