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
// Collaboration WebSocket routing is canonical and strict: connections are
// accepted ONLY at `/ws/:sheetId` (exact single segment, no query string, no
// trailing slash, no extra segments, no aliases, no legacy `/r/demo`). On a
// first join the sheet id is validated and the room is hydrated from durable
// state through the shared loadValidatedSheet() boundary; a fresh Y.Doc is
// seeded ONLY with the validated canonical durable update (never starter code,
// never title/language). A room enters the `rooms` map only after it is fully
// initialized, and any invalid / missing / corrupt / operational failure closes
// the socket with a terminal code (4400 / 4404 / 4500 / 1011) BEFORE any room is
// created. Live WebSocket updates are relayed between peers but are NOT persisted
// yet (no live-durability claim). Every inbound frame passes a per-message
// containment boundary: raw-frame + decoded sync/awareness size caps, then a
// PREFLIGHT before any authoritative mutation — sync updates are validated on a
// disposable clone of the room's current state, and awareness payloads are fully
// decoded + JSON-validated — all inside a request-local try/catch. A malformed or
// oversized frame therefore closes ONLY the offending socket (4400 malformed /
// 4409 oversized) and can never crash the process, disconnect peers, or mutate
// the authoritative room document or awareness state.

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
import { handleBootstrapSheet } from "./bootstrap.mjs";
import { loadValidatedSheet } from "./loadValidatedSheet.mjs";
import { canonicalizeSubmission } from "./yjs.mjs";
import { respondInternalError } from "./errors.mjs";
import {
  MAX_CANONICAL_STATE_BYTES,
  MAX_VISIBLE_CONTENT_CODE_UNITS,
  MAX_WS_AWARENESS_BYTES,
  MAX_WS_FRAME_BYTES,
  MAX_WS_SYNC_UPDATE_BYTES,
  RATE_LIMIT_IP_MAX,
  RATE_LIMIT_TOKEN_MAX,
  RATE_LIMIT_WINDOW_MS,
} from "./limits.mjs";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

// Canonical collaboration route: exactly `/ws/<sheetId>` — one path segment, no
// query string, no trailing slash, no extra segments, no aliases. The captured
// segment is authoritatively validated by loadValidatedSheet (malformed → 4400),
// so no arbitrary room name is ever derived from a request path.
const WS_ROUTE = /^\/ws\/([^/?#]+)$/;

// Terminal WebSocket close codes for the hydration boundary. 4400/4404/4500 are
// application (private-use) codes; 1011 is the standard internal-error code and
// marks a retryable operational failure. Reasons are short and generic — no
// SQLite/Yjs internals ever leak. Client reconnect policy for terminal codes is
// a later provider commit.
const WS_CLOSE = Object.freeze({
  INVALID: 4400, // malformed identifier / route / protocol input
  NOT_FOUND: 4404, // no such sheet
  CORRUPT: 4500, // corrupt / incompatible durable state
  INTERNAL: 1011, // operational DB / internal initialization failure
  TOO_LARGE: 4409, // oversized collaboration frame / payload
});

/**
 * Thrown inside the per-message handler to close ONLY the offending socket with
 * a specific private-use code. Carries no decoder/Yjs internals, so the close
 * reason stays generic. A `4400` malformed default is used for any other
 * (decoder) throw the handler contains.
 */
class WsMessageError extends Error {
  /** @param {number} closeCode */
  constructor(closeCode) {
    super("ws message rejected");
    this.name = "WsMessageError";
    this.closeCode = closeCode;
  }
}

/**
 * Preflight an untrusted sync step-2/update against a DISPOSABLE clone of the
 * room's CURRENT state, so a malformed (but length-valid) update that would make
 * Y.applyUpdate partially mutate its target throws HERE — on the throwaway doc —
 * and never touches the authoritative room. The clone starts from the room's
 * current state (not an empty doc) so dependency and structural validation
 * reflect the real merge context. On success the caller applies the SAME bytes
 * to the authoritative doc. Nothing is persisted, normalized, or rewritten.
 * @param {Y.Doc} doc authoritative room doc (read only here)
 * @param {Uint8Array} update untrusted client update bytes
 * @throws {WsMessageError} INVALID on any decode / integration / structure failure
 */
function preflightSyncUpdate(doc, update) {
  const currentState = Y.encodeStateAsUpdate(doc);
  const probe = new Y.Doc();
  try {
    probe.getText("content"); // predeclare the one approved root
    Y.applyUpdate(probe, currentState); // real merge context
    Y.applyUpdate(probe, update); // may partially mutate the PROBE then throw — contained
    // Validate the MERGED result still satisfies the approved single-root
    // plain-text schema, the visible-content limit, AND the same 512 KiB
    // canonical-state envelope enforced at creation and durable validation
    // (reuses the create/load structural helper). The per-update byte cap was
    // already enforced by the caller; this bounds the merged ROOM state, since a
    // small update can still push the merged canonical state (e.g. via tombstone
    // or multi-client growth) past the room invariant.
    canonicalizeSubmission(
      Y.encodeStateAsUpdate(probe),
      Y.encodeStateVector(probe),
      {
        maxVisibleContentCodeUnits: MAX_VISIBLE_CONTENT_CODE_UNITS,
        maxCanonicalStateBytes: MAX_CANONICAL_STATE_BYTES,
      },
    );
  } catch {
    throw new WsMessageError(WS_CLOSE.INVALID);
  } finally {
    probe.destroy();
  }
}

/**
 * Apply one already-typed SYNC message body to `doc`, replying to step-1 and
 * applying step-2/update bytes. Update bytes are (1) size-capped, then (2)
 * PREFLIGHTED against a disposable clone of current room state before the
 * authoritative apply — so a malformed update cannot mutate the authoritative
 * room document. Throws WsMessageError for an oversized payload (4409) or any
 * malformed/invalid sync input (4400); the caller contains it.
 * @param {decoding.Decoder} decoder positioned just after the top-level type
 * @param {Y.Doc} doc
 * @param {import('ws').WebSocket} ws
 */
function applyWsSyncMessage(decoder, doc, ws) {
  const subtype = decoding.readVarUint(decoder);
  if (subtype === syncProtocol.messageYjsSyncStep1) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.readSyncStep1(decoder, enc, doc);
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
  } else if (
    subtype === syncProtocol.messageYjsSyncStep2 ||
    subtype === syncProtocol.messageYjsUpdate
  ) {
    const update = decoding.readVarUint8Array(decoder);
    // Reject oversize BEFORE any preflight allocation/application.
    if (update.byteLength > MAX_WS_SYNC_UPDATE_BYTES) {
      throw new WsMessageError(WS_CLOSE.TOO_LARGE);
    }
    // Validate on a throwaway clone first; malformed updates throw here and
    // never partially mutate the authoritative doc.
    preflightSyncUpdate(doc, update);
    // Preflight passed, so this apply is expected not to throw; still inside the
    // caller's try/catch defensively.
    Y.applyUpdate(doc, update, ws);
  } else {
    throw new WsMessageError(WS_CLOSE.INVALID);
  }
}

/**
 * Fully decode and JSON-validate an ENTIRE awareness payload WITHOUT touching any
 * Awareness state. applyAwarenessUpdate mutates entries incrementally and cannot
 * be safely rolled back (it overwrites existing identities' state/meta), so the
 * whole payload must be proven well-formed first: every entry's clientID, clock,
 * and JSON state must decode and parse, and the payload must be fully consumed.
 * Mirrors the y-protocols wire format exactly; invents no new semantics.
 * @param {Uint8Array} update untrusted awareness payload bytes
 * @throws {WsMessageError} INVALID on any decode / JSON / trailing-byte failure
 */
function preflightAwarenessUpdate(update) {
  try {
    const decoder = decoding.createDecoder(update);
    const len = decoding.readVarUint(decoder);
    for (let i = 0; i < len; i++) {
      decoding.readVarUint(decoder); // clientID
      decoding.readVarUint(decoder); // clock
      JSON.parse(decoding.readVarString(decoder)); // state must be valid JSON
    }
    if (decoding.hasContent(decoder)) {
      throw new Error("trailing awareness bytes");
    }
  } catch {
    throw new WsMessageError(WS_CLOSE.INVALID);
  }
}

/**
 * Apply one already-typed AWARENESS message body to `awareness`. The payload is
 * (1) size-capped, then (2) fully decoded + JSON-validated before the single
 * authoritative apply — so a malformed multi-entry payload is rejected before
 * ANY entry is applied and can neither inject a ghost identity nor overwrite an
 * existing identity's state/meta.
 * @param {decoding.Decoder} decoder positioned just after the top-level type
 * @param {awarenessProtocol.Awareness} awareness
 * @param {import('ws').WebSocket} ws
 */
function applyWsAwarenessMessage(decoder, awareness, ws) {
  const update = decoding.readVarUint8Array(decoder);
  // Reject oversize BEFORE any preflight decoding.
  if (update.byteLength > MAX_WS_AWARENESS_BYTES) {
    throw new WsMessageError(WS_CLOSE.TOO_LARGE);
  }
  preflightAwarenessUpdate(update);
  awarenessProtocol.applyAwarenessUpdate(awareness, update, ws);
}

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
  // Test-observable count of SUCCESSFUL durable room hydrations: incremented
  // only after a room is fully constructed AND inserted into `rooms` — never on
  // a load attempt, a load failure, or a failed/partial construction. Proves
  // concurrent first joins hydrate exactly once.
  let hydrationCount = 0;
  // Test-only one-shot construction fault: when armed, buildRoom() invokes the
  // observer with its partial { doc, awareness } and then throws, to exercise
  // partial-construction cleanup. Auto-clears after firing; never armed in
  // production (reachable only through the app __test seam).
  /** @type {null | ((partial: { doc: Y.Doc, awareness: awarenessProtocol.Awareness }) => void)} */
  let roomBuildFault = null;

  /**
   * Construct a fully-wired but UNREGISTERED room: a fresh Y.Doc (optionally
   * seeded with an already-validated durable update), a server-owned Awareness,
   * an empty client map, and the sync/awareness relay listeners. It performs NO
   * map insertion and NO validation — callers own both.
   *
   * The ENTIRE construction sequence runs under one try/catch. If any step fails
   * (doc creation, apply, awareness creation, listener wiring), the partial
   * resources are torn down — Awareness first, then Y.Doc — before the original
   * error is re-thrown: nothing leaks, and no cleanup error masks or escapes past
   * the original failure. Callers therefore never receive a partly-built room.
   * @param {Uint8Array | null} initialUpdate validated canonical durable update
   */
  function buildRoom(initialUpdate) {
    let doc;
    let awareness;
    try {
      doc = new Y.Doc();
      // Predeclare the plain-text content root (matches the create-path type
      // contract) before applying any durable update.
      doc.getText("content");
      if (initialUpdate) Y.applyUpdate(doc, initialUpdate);

      awareness = new awarenessProtocol.Awareness(doc);
      awareness.setLocalState(null); // server has no presence of its own

      // Test-only one-shot: fail here (both Y.Doc and Awareness now exist, before
      // the room is returned) to prove partial-construction cleanup destroys both.
      if (roomBuildFault) {
        const fault = roomBuildFault;
        roomBuildFault = null; // one-shot: auto-clear before it can re-arm
        fault({ doc, awareness });
        throw new Error("injected room construction failure");
      }

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

      return { doc, awareness, clients };
    } catch (err) {
      // Partial-construction cleanup: tear down in reverse order (Awareness
      // before Y.Doc), attempting BOTH even if one throws, and never masking or
      // replacing the original error. No cleanup error is allowed to escape.
      if (awareness) {
        try {
          awareness.destroy();
        } catch (cleanupErr) {
          console.error("buildRoom cleanup: awareness.destroy failed:", cleanupErr);
        }
      }
      if (doc) {
        try {
          doc.destroy();
        } catch (cleanupErr) {
          console.error("buildRoom cleanup: doc.destroy failed:", cleanupErr);
        }
      }
      throw err;
    }
  }

  /**
   * Test seam ONLY: get-or-create an EMPTY room by arbitrary name. Never used by
   * the collaboration WebSocket path (which hydrates through
   * acquireHydratedRoom); retained so lifecycle/disposal tests can exercise room
   * teardown deterministically.
   */
  function getRoom(name) {
    const existing = rooms.get(name);
    if (existing) return existing;
    const room = buildRoom(null);
    rooms.set(name, room);
    return room;
  }

  /**
   * Production first-join path for a canonical sheet id. Fully SYNCHRONOUS from
   * the map lookup to the map insertion — there is NO await between rooms.get and
   * rooms.set, so two concurrent first joins can never both initialize a room.
   * On any validation/operational failure it closes the socket with the mapped
   * terminal code and returns null WITHOUT creating a room or leaking a Y.Doc /
   * Awareness. Returns the shared hydrated room on success.
   * @param {string} sheetId single path segment captured from `/ws/:sheetId`
   * @param {import('ws').WebSocket} ws
   * @returns {{ doc: Y.Doc, awareness: awarenessProtocol.Awareness, clients: Map<import('ws').WebSocket, Set<number>> } | null}
   */
  function acquireHydratedRoom(sheetId, ws) {
    const existing = rooms.get(sheetId);
    if (existing) return existing;

    // The shared validated-load boundary is the single security authority for
    // persisted state — bootstrap is not trusted, and validation is not
    // reimplemented here.
    const loaded = loadValidatedSheet({ db, sheetId });
    if (!loaded.ok) {
      switch (loaded.reason) {
        case "invalid_id":
          ws.close(WS_CLOSE.INVALID, "invalid");
          break;
        case "missing":
          ws.close(WS_CLOSE.NOT_FOUND, "not found");
          break;
        case "corrupt":
          ws.close(WS_CLOSE.CORRUPT, "unavailable");
          break;
        case "db_error":
        default:
          // Operational failure — generic, retryable. Log server-side only.
          console.error(`ws hydration ${sheetId}: ${loaded.reason}`, loaded.detail);
          ws.close(WS_CLOSE.INTERNAL, "internal error");
          break;
      }
      return null;
    }

    let room;
    try {
      // Hydrate ONLY from the validated canonical durable update — never starter
      // content, never title/language, and durable state is not mutated.
      room = buildRoom(loaded.canonicalUpdate);
    } catch (err) {
      // Validated canonical bytes should always re-apply; guard defensively so a
      // build failure leaks nothing and reports a retryable internal error.
      console.error(`ws hydration build ${sheetId}:`, err);
      ws.close(WS_CLOSE.INTERNAL, "internal error");
      return null;
    }

    hydrationCount++;
    rooms.set(sheetId, room);
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
      // Durable test reset, in order: dispose live rooms (destroying each
      // Awareness/Y.Doc) → clear all durable sheet rows (metadata + idempotency
      // clear via FK cascade) → clear rate-limiter state. Test mode only. A
      // durable-delete failure is contained: it returns one generic 500, leaves
      // the limiter untouched, and never escapes the request callback.
      disposeAllRooms();
      try {
        db.__test.resetAll();
        rateLimiter.clear(); // only after the durable deletion succeeds
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      } catch (err) {
        console.error("test reset failed:", err);
        respondInternalError(res);
      }
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
    // Read-only bootstrap: GET /api/sheets/<sheetId>, EXACT single segment only
    // (no query string, no extra subpath — those fall through to 404). A matched
    // segment is validated by loadValidatedSheet (malformed id → 400).
    const bootstrapMatch =
      req.method === "GET" && /^\/api\/sheets\/([^/?#]+)$/.exec(req.url ?? "");
    if (bootstrapMatch) {
      handleBootstrapSheet(req, res, { db }, bootstrapMatch[1]);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws, req) => {
    // Strict canonical route: only `/ws/<sheetId>` is accepted. Anything else
    // (aliases, legacy `/r/demo`, query strings, trailing slashes, extra
    // segments) is a terminal 4400 before any room is created.
    const match = WS_ROUTE.exec(req.url ?? "");
    if (!match) {
      ws.close(WS_CLOSE.INVALID, "invalid");
      return;
    }

    // Synchronous validate + hydrate. On failure the socket is already closed
    // with a terminal code and no room exists; do not start the sync flow.
    const room = acquireHydratedRoom(match[1], ws);
    if (!room) return;
    const { doc, awareness, clients } = room;

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

    ws.on("message", (rawData, isBinary) => {
      // Every malformed/oversized frame is contained to THIS socket: no decoder
      // exception escapes, the process survives, and peers / the room / durable
      // state are untouched. Owned awareness states are cleared by 'close'.
      try {
        // Binary-only protocol: reject text frames explicitly.
        if (isBinary === false) throw new WsMessageError(WS_CLOSE.INVALID);

        const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);

        // Raw-frame size guard BEFORE any decoder work.
        if (data.byteLength > MAX_WS_FRAME_BYTES) {
          throw new WsMessageError(WS_CLOSE.TOO_LARGE);
        }

        // Copy into an exact-length buffer so the decoder can never read past the
        // frame into pooled memory (Node Buffers may share a larger ArrayBuffer).
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const msgType = decoding.readVarUint(decoder);

        if (msgType === MSG_SYNC) {
          applyWsSyncMessage(decoder, doc, ws);
        } else if (msgType === MSG_AWARENESS) {
          applyWsAwarenessMessage(decoder, awareness, ws);
        }
        // Unknown top-level types are ignored safely (no reply, no state change).
      } catch (err) {
        // No decoder/Yjs detail is exposed; a non-typed throw is treated as
        // malformed. No normal protocol reply is sent after a failure — only the
        // close frame below.
        const code =
          err instanceof WsMessageError ? err.closeCode : WS_CLOSE.INVALID;
        ws.close(code, code === WS_CLOSE.TOO_LARGE ? "too large" : "invalid");
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
    __test: {
      /**
       * Arm a one-shot buildRoom() failure that fires after Awareness has been
       * created (both Y.Doc and Awareness exist) but before the room is returned.
       * The optional observer receives the partial { doc, awareness } so a test
       * can watch their destruction; the seam then throws so acquireHydratedRoom
       * maps it to a generic 1011 close and both partials are destroyed. Consumed
       * after firing once.
       * @param {(partial: { doc: Y.Doc, awareness: awarenessProtocol.Awareness }) => void} [observe]
       */
      failNextRoomBuild(observe) {
        roomBuildFault = observe ?? (() => {});
      },
    },
    get hydrationCount() {
      return hydrationCount;
    },
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
