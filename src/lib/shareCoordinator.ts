import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import type { DraftSession } from "./draftSession";
import type { LanguageId } from "./languages";
import { decodeStandardBase64, encodeStandardBase64 } from "./base64";
import { isValidSheetId } from "./sheetId";
import { createSheetPath } from "./topology";
import {
  createSheetProvider,
  type CreateSheetProviderOptions,
  type SheetProviderHandle,
  type TerminalResult,
} from "./providerFactory";
import {
  createSharedSessionController,
  type SharedSessionController,
} from "./sharedSessionOwnership";

/**
 * Share coordinator (M4 S4).
 *
 * Orchestrates the ONE-WAY transition from a LOCAL draft session to a SHARED,
 * server-backed sheet, WITHOUT ever remounting DraftPage or reconstructing any
 * collaboration primitive. It reuses the exact existing `session.doc`,
 * `session.text`, `session.awareness`, and `session.undoManager` throughout —
 * the provider attaches to the same `Y.Doc`/`Awareness`, so the CodeMirror
 * binding and editor state are untouched and no remount is required.
 *
 * Lifecycle (one-way — it never reverts to a fully-local draft once ownership
 * transfers):
 *
 *     local
 *       │  encode submission snapshot (current doc update + state vector)
 *       ▼
 *     creating ── POST /api/sheets ──► receipt validated (200/201 only)
 *       │                                   │
 *       │ (any failure here: draft stays fully LOCAL and editable)
 *       ▼                                   ▼
 *     attaching ── createSharedSessionController(session)
 *       │            .attachAndTakeOwnership(() => createSheetProvider(...))
 *       │          ◄──────── OWNERSHIP TRANSFER MOMENT (atomic) ────────►
 *       ▼
 *     connecting ── handle.connect()  (ONLY after ack + successful transfer)
 *       │  stabilized ───────────► { status: "connected", … }
 *       │  connect threw, live ──► { status: "connection-pending", retryable: true, … }
 *       │  torn down mid-connect ► { status: "connection-pending", retryable: false, … }
 *
 * ── Pre-transfer failure boundary ──
 * BEFORE the ownership-transfer moment (encode/http/rejected/receipt/provider/
 * ownership stages), NO collaboration primitive is destroyed or replaced; the
 * draft remains fully local and editable, so every such failure carries
 * `localIntact: true`. A retry with the SAME creation token is safe: the server
 * collapses it to one sheet (201 first, then idempotent 200 replay). Once the
 * remote sheet has been acknowledged (receipt validated), a subsequent
 * pre-transfer failure additionally carries `remoteCreated: true` + `sheetId` +
 * `receipt`, so S6 can message honestly and a same-token retry can recover.
 *
 * ── Post-transfer one-way state ──
 * AFTER the transfer moment, the shared controller SOLELY owns cleanup and the
 * operation NEVER pretends to have reverted to a local draft. The only
 * post-transfer failure is `connect`, and it is surfaced as a `connection-pending`
 * result — NOT a rollback: the controller and provider are RETAINED (never
 * auto-disposed) and the durable sheet already exists. A pending result means the
 * durable sheet exists but the explicit connection attempt did not stabilize. It
 * carries `sheetId`, `receipt`, and the typed `connectError`, and it is one of:
 *
 * - `retryable: true` — `connect()` threw while the controller/handle stayed
 *   live. It additionally exposes `retryConnect()`, which re-drives the SAME
 *   provider (no second POST, no second provider) through the same gate.
 * - `retryable: false` — TERMINAL: ownership/provider teardown already occurred
 *   (controller no longer `shared`, or handle destroyed). No re-drive is possible,
 *   so NO `retryConnect()` is exposed; the caller distinguishes this without
 *   attempting-and-catching. Rolling back is still avoided because it would
 *   destroy primitives S6 still needs and hide a sheet that genuinely exists.
 *
 * `connected` means EXACTLY: `connect()` returned, one microtask checkpoint
 * elapsed, the controller stayed `shared`, and the handle stayed live — NOT that
 * the WebSocket is open or the document synced. A `connected` value from
 * `retryConnect()` is valid only while the controller/handle remain live.
 *
 * There are never two owners and never a half-shared state.
 *
 * ── Duplicate / concurrent Share ──
 * De-duplicated PER SESSION through a module-private WeakMap keyed by the
 * DraftSession (chosen over a field on the session so we add NO hidden mutation
 * to the session object and hold NO global singleton beyond this one map, whose
 * entries are collected with their sessions). A second call with a
 * reference-compatible input reuses the exact same promise, so one draft session
 * produces at most one sheet/provider. A second call with an INCOMPATIBLE input
 * rejects immediately with a typed conflict error, issuing no POST and attaching
 * no provider; that conflict reports the owning attempt's honest phase —
 * `remoteCreated` + `sheetId` + `receipt` once the receipt has been acknowledged,
 * and `localIntact` false once ownership has transferred (acknowledgement always
 * precedes transfer). A pre-transfer failure clears the entry so a compatible
 * retry can proceed; a settled connected/connection-pending success keeps the
 * entry (the session is one-way shared).
 *
 * ── Retained result semantics ──
 * The original `shareDraftSession()` promise resolves EXACTLY ONCE and its value
 * is never mutated into another variant: if it resolved to `connection-pending`
 * it stays that same frozen object forever (its `retryable` discriminant fixed at
 * resolution), and every reference-compatible duplicate caller receives that
 * identical object. When retryable, recovery lives entirely on that object's
 * `retryConnect()`, which MEMOIZES the eventual `connected` result (a separate
 * frozen object) — but re-validates the lifecycle on every call, so it returns the
 * memoized `connected` only while the controller/handle remain live and otherwise
 * rejects with a fresh terminal connect error rather than returning it stale. The
 * pending → connected transition is observed through `retryConnect`'s return
 * value, never by the pending object changing shape.
 */

/** Server contract: schemaVersion must be exactly 0 in v1 (see server/limits.mjs). */
const CREATE_SCHEMA_VERSION = 0;

/** The immutable durable-create receipt S5 routing may consume. */
export type ShareReceipt = {
  readonly sheetId: string;
  readonly serverRevision: number;
  readonly committedStateVector: string;
  readonly committedMetadataRevision: number;
  readonly committedAt: number;
};

/**
 * Narrow success result. Both success shapes expose lifecycle ownership (the
 * controller) and the immutable receipt, and NEVER the mutable underlying
 * provider.
 *
 * `connected` means EXACTLY: the explicit `connect()` returned, one microtask
 * checkpoint elapsed, the controller remained `shared`, and the handle remained
 * live. It does NOT mean the WebSocket is open or the document is synced. A
 * `connected` value obtained from `retryConnect()` is meaningful only while the
 * controller/handle remain live (see `retryConnect`).
 */
export type ShareConnected = {
  readonly status: "connected";
  readonly sheetId: string;
  readonly receipt: Readonly<ShareReceipt>;
  readonly controller: SharedSessionController;
};

/**
 * A `connection-pending` result means the durable sheet EXISTS and ownership has
 * transferred, but the explicit connection attempt did not stabilize into
 * `connected`. It is a discriminated union on `retryable`:
 *
 * - `retryable: true` — `connect()` threw while the controller/handle stayed
 *   live, so another attempt may still succeed. It exposes `retryConnect()`.
 * - `retryable: false` — TERMINAL: ownership or provider teardown already
 *   occurred (the controller is no longer `shared`, or the handle is destroyed).
 *   A later connection cannot be re-driven, so NO `retryConnect()` is exposed and
 *   the caller can tell without attempting-and-catching.
 *
 * Both shapes carry `sheetId`, `receipt`, the `controller`, and the typed
 * `connectError` (localIntact false, remoteCreated true). Neither is a rollback:
 * no provider is recreated and no second POST is issued.
 */
export type ShareConnectionPending =
  | {
      readonly status: "connection-pending";
      readonly retryable: true;
      readonly sheetId: string;
      readonly receipt: Readonly<ShareReceipt>;
      readonly controller: SharedSessionController;
      /** The primary typed connect failure (never overwritten by a later retry). */
      readonly connectError: ShareError;
      /**
       * Retry ONLY the explicit connection, reusing the already-attached provider
       * (no POST, no second provider). Resolves to a `connected` result while the
       * controller/handle remain live — MEMOIZED, but re-validated against current
       * lifecycle on every call so a `connected` value is never returned stale
       * after a later teardown. Rejects with a typed connect `ShareError` when the
       * lifecycle has become terminal (then future calls also reject
       * deterministically WITHOUT calling `connect()` again) or when the retry's
       * own connect fails while still live (leaving this capability usable for a
       * further retry). Concurrent calls share one in-flight attempt.
       */
      retryConnect(): Promise<ShareConnected>;
    }
  | {
      readonly status: "connection-pending";
      readonly retryable: false;
      readonly sheetId: string;
      readonly receipt: Readonly<ShareReceipt>;
      readonly controller: SharedSessionController;
      /** The primary typed connect failure (localIntact false, remoteCreated true). */
      readonly connectError: ShareError;
    };

export type ShareSuccess = ShareConnected | ShareConnectionPending;

export type ShareFailureStage =
  | "encode" // building the request snapshot (pre-transfer)
  | "http" // network/fetch failure (pre-transfer)
  | "rejected" // server returned a non-2xx typed error (pre-transfer)
  | "receipt" // missing/unexpected status or malformed success receipt (pre-transfer)
  | "provider" // provider construction failed (pre-transfer; remote sheet exists)
  | "ownership" // attach/transferOwnership failed (pre-transfer; provider cleaned; remote sheet exists)
  | "connect" // connect after transfer did not stabilize (POST-transfer; surfaced via a pending result, not thrown from share())
  | "conflict"; // a different, incompatible share attempt already owns this session

/** Machine-stable error codes (never localized UI prose). */
export const SHARE_ERROR_CODES = Object.freeze({
  CONFLICT: "SHARE_ATTEMPT_CONFLICT",
});

/** Typed failure suitable for later UI mapping. */
export class ShareError extends Error {
  readonly stage: ShareFailureStage;
  /** True ⇒ the draft is still fully local and editable (safe to retry). Always
   *  false once ownership has transferred. */
  readonly localIntact: boolean;
  /** True once the remote sheet was durably acknowledged (receipt validated).
   *  Enables same-token idempotent retry and honest S6 messaging. */
  readonly remoteCreated: boolean;
  /** HTTP status when `stage === "rejected"` or an unexpected success status. */
  readonly status?: number;
  /** Server error code (`stage === "rejected"`) or a coordinator code (conflict). */
  readonly code?: string;
  /** Known remote sheet id, present once `remoteCreated` is true. */
  readonly sheetId?: string;
  /** Known remote receipt, present once `remoteCreated` is true. */
  readonly receipt?: ShareReceipt;

  constructor(
    stage: ShareFailureStage,
    message: string,
    opts: {
      localIntact: boolean;
      remoteCreated?: boolean;
      status?: number;
      code?: string;
      sheetId?: string;
      receipt?: ShareReceipt;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "ShareError";
    this.stage = stage;
    this.localIntact = opts.localIntact;
    this.remoteCreated = opts.remoteCreated ?? false;
    this.status = opts.status;
    this.code = opts.code;
    this.sheetId = opts.sheetId;
    this.receipt = opts.receipt;
  }
}

export type ShareDraftSessionInput = {
  /** The existing local draft session — its primitives are reused, never rebuilt. */
  session: DraftSession;
  /** Sheet title (may be ""); frozen by the caller (S6) for the request duration. */
  title: string;
  /** Sheet language (server allowlist member). */
  language: LanguageId;
  /** Stable idempotency token (UUID v4). Lifecycle/persistence is the caller's (S6). */
  creationToken: string;
  /** Forwarded to the provider so the future UI can observe connection state. */
  onStatus?: (status: "connected" | "connecting" | "disconnected") => void;
  onSync?: (synced: boolean) => void;
  onTerminal?: (result: TerminalResult) => void;
  /** Injectable `fetch` (default: global). Browser callers omit it (relative,
   *  same-origin). Tests/non-browser inject a base-qualifying fetch. */
  fetch?: typeof fetch;
  /** Test seam: provider factory (default: createSheetProvider). */
  createProvider?: (opts: CreateSheetProviderOptions) => SheetProviderHandle;
  /** Forwarded to the provider factory (default: wsBase()). */
  serverUrl?: string;
  /** Forwarded to the provider factory (tests). */
  WebsocketProviderCtor?: CreateSheetProviderOptions["WebsocketProviderCtor"];
};

/**
 * The immutable identity of a share attempt: EVERY input that materially changes
 * behavior, captured with defaults resolved so two equivalent calls (e.g. both
 * omitting `fetch`) compare equal. Comparison is strictly by REFERENCE identity
 * for functions/callbacks — never by serializing or comparing function bodies.
 */
type AttemptIdentity = {
  readonly creationToken: string;
  readonly title: string;
  readonly language: LanguageId;
  readonly serverUrl: string | undefined;
  readonly fetch: typeof fetch;
  readonly createProvider: (opts: CreateSheetProviderOptions) => SheetProviderHandle;
  readonly WebsocketProviderCtor: CreateSheetProviderOptions["WebsocketProviderCtor"];
  readonly onStatus: ShareDraftSessionInput["onStatus"];
  readonly onSync: ShareDraftSessionInput["onSync"];
  readonly onTerminal: ShareDraftSessionInput["onTerminal"];
};

function identityOf(input: ShareDraftSessionInput): AttemptIdentity {
  return {
    creationToken: input.creationToken,
    title: input.title,
    language: input.language,
    serverUrl: input.serverUrl,
    fetch: input.fetch ?? globalThis.fetch,
    createProvider: input.createProvider ?? createSheetProvider,
    WebsocketProviderCtor: input.WebsocketProviderCtor,
    onStatus: input.onStatus,
    onSync: input.onSync,
    onTerminal: input.onTerminal,
  };
}

/** Two attempts are COMPATIBLE (safe to de-duplicate to one share) iff every
 *  materially-behavioral input is `===`-equal. */
function compatible(a: AttemptIdentity, b: AttemptIdentity): boolean {
  return (
    a.creationToken === b.creationToken &&
    a.title === b.title &&
    a.language === b.language &&
    a.serverUrl === b.serverUrl &&
    a.fetch === b.fetch &&
    a.createProvider === b.createProvider &&
    a.WebsocketProviderCtor === b.WebsocketProviderCtor &&
    a.onStatus === b.onStatus &&
    a.onSync === b.onSync &&
    a.onTerminal === b.onTerminal
  );
}

/**
 * Per-session share state. Held in a module-private WeakMap (below) rather than
 * on the session object, so the coordinator adds NO hidden mutation to the
 * DraftSession and keeps no global singleton beyond the map itself — an entry is
 * reclaimed together with its session.
 *
 * `acknowledged` and `transferred` are tracked SEPARATELY because they happen at
 * different moments: acknowledgement (the durable receipt validated ⇒ the remote
 * sheet exists) strictly precedes the ownership-transfer moment. A concurrent
 * conflict therefore reads `acknowledged` for `remoteCreated` (+ `sheetId` /
 * `receipt`) and `transferred` for `localIntact`, so it can report an honest
 * mid-flight phase: pre-ack (no remote sheet), acked-but-not-transferred (remote
 * sheet exists, draft still local), or transferred (remote sheet exists, draft
 * no longer independently local).
 */
type ShareEntry = {
  readonly identity: AttemptIdentity;
  promise: Promise<ShareSuccess>;
  /** True once the durable create receipt is validated (the remote sheet exists). */
  acknowledged: boolean;
  /** Known remote sheet id, set with `acknowledged`. */
  sheetId?: string;
  /** Known remote receipt, set with `acknowledged`. */
  receipt?: ShareReceipt;
  /** True at/after the ownership-transfer moment (⇒ `localIntact` is false). */
  transferred: boolean;
};

const SHARE_ENTRIES = new WeakMap<DraftSession, ShareEntry>();

/** A safe integer `>= 1` (revision fields). Rejects NaN/Infinity/fractional/unsafe. */
function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** A safe integer `>= 0` (timestamp field). */
function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Strictly validate that `bytes` are a well-formed Yjs state vector, using the
 * SAME lib0 var-uint decoder Yjs itself uses for state vectors and mirroring the
 * server's `decodeStateVectorStrict` (server/yjs.mjs). It reads the declared
 * client count and each `(client, clock)` pair, and REQUIRES the stream to be
 * fully consumed — so truncated payloads throw, trailing bytes are rejected, and
 * duplicate client ids are rejected. This is a real structural acceptance test,
 * not a "did decoding return some bytes" check.
 */
function assertValidStateVector(bytes: Uint8Array): void {
  const decoder = decoding.createDecoder(bytes);
  // Throws (unexpected end of array) on an empty/truncated length prefix.
  const numClients = decoding.readVarUint(decoder);
  if (!Number.isSafeInteger(numClients)) {
    throw new RangeError("state vector client count is not a safe integer");
  }
  const seen = new Set<number>();
  for (let i = 0; i < numClients; i++) {
    const client = decoding.readVarUint(decoder); // throws if truncated
    const clock = decoding.readVarUint(decoder); // throws if truncated
    if (!Number.isSafeInteger(client) || !Number.isSafeInteger(clock)) {
      throw new RangeError("state vector entry is not a safe integer");
    }
    if (seen.has(client)) {
      throw new RangeError("state vector has a duplicate client id");
    }
    seen.add(client);
  }
  if (decoding.hasContent(decoder)) {
    throw new RangeError("state vector has trailing bytes");
  }
}

/** Build a typed receipt failure (always pre-transfer ⇒ `localIntact: true`). */
function receiptError(message: string, cause?: unknown): ShareError {
  return new ShareError("receipt", message, { localIntact: true, cause });
}

/**
 * Validate + freeze a durable-create success receipt. STRICT: every field is
 * checked exactly (canonical id shape, safe-integer revision/timestamp bounds,
 * canonical standard base64 that decodes to a valid Yjs state vector). A
 * malformed payload becomes a typed receipt failure with the original cause
 * preserved.
 */
function parseReceipt(json: unknown): ShareReceipt {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw receiptError("Create receipt was not a JSON object.");
  }
  const r = json as Record<string, unknown>;

  if (!isValidSheetId(r.sheetId)) {
    throw receiptError("Create receipt has an invalid sheetId.");
  }
  if (!isRevision(r.serverRevision)) {
    throw receiptError("Create receipt has an invalid serverRevision.");
  }
  if (!isRevision(r.committedMetadataRevision)) {
    throw receiptError("Create receipt has an invalid committedMetadataRevision.");
  }
  if (!isTimestamp(r.committedAt)) {
    throw receiptError("Create receipt has an invalid committedAt.");
  }
  if (typeof r.committedStateVector !== "string") {
    throw receiptError("Create receipt has a non-string committedStateVector.");
  }

  let svBytes: Uint8Array;
  try {
    svBytes = decodeStandardBase64(r.committedStateVector);
  } catch (err) {
    throw receiptError(
      "Create receipt committedStateVector is not canonical standard base64.",
      err,
    );
  }
  try {
    assertValidStateVector(svBytes);
  } catch (err) {
    throw receiptError(
      "Create receipt committedStateVector is not a valid Yjs state vector.",
      err,
    );
  }

  return Object.freeze({
    sheetId: r.sheetId,
    serverRevision: r.serverRevision,
    committedStateVector: r.committedStateVector,
    committedMetadataRevision: r.committedMetadataRevision,
    committedAt: r.committedAt,
  });
}

/** True while the shared session can still carry a connection. */
function lifecycleLive(
  controller: SharedSessionController,
  handle: SheetProviderHandle,
): boolean {
  return controller.phase === "shared" && !handle.destroyed;
}

/**
 * Build a fresh, canonical `connect`-stage failure. EVERY connect-side failure —
 * a `handle.connect()` throw of ANY value (including an unrelated `ShareError`
 * from another stage or with wrong metadata), a pre-connect torn-down guard, or a
 * post-microtask torn-down check — funnels through here so the surfaced error is
 * always `stage: "connect"`, `localIntact: false`, `remoteCreated: true`, with
 * the correct `sheetId` + `receipt`. Any originally-thrown value is preserved
 * ONLY as `cause`, never re-surfaced verbatim.
 */
function connectFailure(
  message: string,
  sheetId: string,
  receipt: ShareReceipt,
  cause?: unknown,
): ShareError {
  return new ShareError("connect", message, {
    localIntact: false,
    remoteCreated: true,
    sheetId,
    receipt,
    cause,
  });
}

/**
 * Post-connect lifecycle stabilization — the ONE gate shared by the initial
 * attempt and `retryConnect()` so both interpret "connected" identically. It
 * encodes the exact meaning of the `connected` status:
 *
 *   1. the controller is still `shared` and the handle still live BEFORE
 *      connecting (never connect — or re-connect — an already-torn-down session,
 *      and never call `connect()` at all when it is already gone);
 *   2. the explicit `handle.connect()` is attempted; a throw is CAPTURED (kept
 *      only as `cause`) but NOT interpreted yet — both the returned and thrown
 *      paths pass through the SAME checkpoint below, so a teardown that connect()
 *      merely QUEUES is never missed by deciding retryability at the catch site;
 *   3. exactly ONE microtask checkpoint has elapsed, so a synchronously-queued
 *      terminal teardown (S3 queues provider-destroy + onTerminal in one
 *      microtask) or a synchronous re-entrant disposal is observed — whether
 *      connect returned OR threw; and
 *   4. the controller is STILL `shared` and the handle STILL live afterwards.
 *
 * It deliberately never waits for the socket to open, for sync, for a status
 * event, or on any timer, and never inspects provider internals. `connected`
 * means ONLY that the connection attempt survived lifecycle stabilization.
 *
 * On failure it reports `retryable`: TRUE only when `connect()` threw AND the
 * lifecycle survived the checkpoint (so a later attempt may still succeed); FALSE
 * when the lifecycle was torn down by the checkpoint (terminal) — INCLUDING a
 * connect that both threw and queued its own teardown, whose thrown cause is
 * still preserved. Either way the error is a fresh typed `connect` ShareError and
 * nothing is disposed here.
 */
async function stabilizeConnect(args: {
  controller: SharedSessionController;
  handle: SheetProviderHandle;
  sheetId: string;
  receipt: ShareReceipt;
}): Promise<{ ok: true } | { ok: false; error: ShareError; retryable: boolean }> {
  const { controller, handle, sheetId, receipt } = args;

  // (1) Never connect a session that is already gone — fail deterministically
  //     WITHOUT calling connect(). Already torn down ⇒ terminal (not retryable).
  if (!lifecycleLive(controller, handle)) {
    return {
      ok: false,
      retryable: false,
      error: connectFailure(
        "The shared session was disposed; the connection can no longer be established.",
        sheetId,
        receipt,
      ),
    };
  }

  // (2) Explicit connect. CAPTURE a throw but do NOT interpret it yet: deciding
  //     retryability at the catch site would race a teardown that connect() only
  //     QUEUES (destroy on a microtask), wrongly reporting `retryable: true`. Both
  //     the returned and thrown paths fall through to the SAME checkpoint below.
  let connectThrew = false;
  let connectCause: unknown;
  try {
    handle.connect();
  } catch (err) {
    connectThrew = true;
    connectCause = err;
  }

  // (3) Await exactly one microtask checkpoint so a synchronously-queued terminal
  //     teardown or a synchronous re-entrant disposal is observed before we claim
  //     anything — whether connect returned OR threw. No timers, no sync waiting.
  await Promise.resolve();

  // (4) A teardown observed by the checkpoint is TERMINAL, regardless of whether
  //     connect returned or threw. A thrown cause is never lost merely because a
  //     teardown also ran — it is preserved on the terminal error.
  if (!lifecycleLive(controller, handle)) {
    return {
      ok: false,
      retryable: false,
      error: connectFailure(
        "The connection did not survive lifecycle stabilization; the shared session was torn down.",
        sheetId,
        receipt,
        connectThrew ? connectCause : undefined,
      ),
    };
  }

  // (5) Connect threw but the lifecycle SURVIVED the checkpoint ⇒ RETRYABLE. ANY
  //     thrown value becomes a fresh connect failure; the original is kept only as
  //     `cause`, never re-surfaced verbatim.
  if (connectThrew) {
    return {
      ok: false,
      retryable: true,
      error: connectFailure(
        "Failed to connect to the shared sheet.",
        sheetId,
        receipt,
        connectCause,
      ),
    };
  }

  // (6) Connect returned and the lifecycle survived ⇒ connected.
  return { ok: true };
}

/**
 * Build a `connection-pending` result. When `retryable` is false the result is
 * TERMINAL: it carries the durable identity + typed connect error but exposes NO
 * `retryConnect()` (teardown already occurred, so a re-drive is impossible). When
 * `retryable` is true it exposes `retryConnect()`, which re-drives the SAME
 * already-attached provider handle — never a new POST or provider — through the
 * SAME `stabilizeConnect` gate. `retryConnect()`:
 *
 *  - re-validates the lifecycle BEFORE returning the memoized `connected` result,
 *    so a `connected` value is never returned STALE after a later teardown;
 *  - after a successful, still-live retry, memoizes and returns the one
 *    `connected` result (concurrent calls share a single in-flight attempt);
 *  - once the lifecycle is terminal, rejects deterministically WITHOUT calling
 *    `connect()` again;
 *  - if its own connect throws while still live, rejects but leaves this
 *    capability usable for a further retry.
 */
function buildPendingResult(args: {
  sheetId: string;
  receipt: ShareReceipt;
  controller: SharedSessionController;
  handle: SheetProviderHandle;
  connectError: ShareError;
  retryable: boolean;
}): ShareConnectionPending {
  const { sheetId, receipt, controller, handle, connectError, retryable } = args;

  if (!retryable) {
    // Terminal: teardown already occurred. No re-drive is possible, so expose no
    // retryConnect — the caller distinguishes this WITHOUT attempting-and-catching.
    return Object.freeze({
      status: "connection-pending",
      retryable: false,
      sheetId,
      receipt,
      controller,
      connectError,
    });
  }

  let connected: ShareConnected | null = null;
  let inFlight: Promise<ShareConnected> | null = null;

  async function doRetry(): Promise<ShareConnected> {
    // Defensive memoization guard: `retryConnect` already gates liveness and only
    // enters here with `connected` unset, so this returns the one frozen success
    // object without a second `connect()` on the (unreachable) re-entry.
    if (connected) return connected;
    const outcome = await stabilizeConnect({ controller, handle, sheetId, receipt });
    if (!outcome.ok) throw outcome.error;
    connected = Object.freeze({ status: "connected", sheetId, receipt, controller });
    return connected;
  }

  function retryConnect(): Promise<ShareConnected> {
    // Re-validate the lifecycle FIRST on EVERY call — BEFORE returning a memoized
    // `connected`, an existing in-flight attempt, OR starting a new one. This is
    // the single liveness authority: a terminal lifecycle therefore never hands
    // back a stale `connected`, not even through an as-yet-uncleared in-flight
    // slot, and rejects deterministically WITHOUT calling `connect()` again.
    if (!lifecycleLive(controller, handle)) {
      return Promise.reject(
        connectFailure(
          "The shared session was torn down; the established connection is no longer valid.",
          sheetId,
          receipt,
        ),
      );
    }
    if (connected) return Promise.resolve(connected); // memoized while still live
    if (inFlight) return inFlight; // de-duplicate concurrent retries
    const attempt = doRetry();
    inFlight = attempt;
    // Clear the in-flight slot on settle (success OR failure). Subscribe with
    // `.then(res, rej)` — never `.finally` — so a rejected attempt does not raise
    // an unhandled rejection from this bookkeeping subscription.
    void attempt.then(
      () => {
        if (inFlight === attempt) inFlight = null;
      },
      () => {
        if (inFlight === attempt) inFlight = null;
      },
    );
    return attempt;
  }

  return Object.freeze({
    status: "connection-pending",
    retryable: true,
    sheetId,
    receipt,
    controller,
    connectError,
    retryConnect,
  });
}

/** Test-only surface (mirrors the project's `__test` convention, e.g. the
 *  persistence adapter). Not part of the public API; enables direct, hook-free
 *  coverage of the post-connect stabilization gate. */
export const __test = { stabilizeConnect };

/**
 * Run a single share attempt. The lifecycle hooks let the coordinator's
 * per-session entry report a truthful phase to any concurrent conflicting
 * caller: `markAcknowledged` fires the instant the durable receipt is validated
 * (the remote sheet exists), and `markTransferred` fires exactly at the
 * ownership-transfer moment (the draft is no longer independently local).
 */
async function runShare(
  input: ShareDraftSessionInput,
  hooks: {
    markAcknowledged: (sheetId: string, receipt: ShareReceipt) => void;
    markTransferred: () => void;
  },
): Promise<ShareSuccess> {
  const {
    session,
    title,
    language,
    creationToken,
    onStatus,
    onSync,
    onTerminal,
    fetch: doFetch = globalThis.fetch,
    createProvider = createSheetProvider,
    serverUrl,
    WebsocketProviderCtor,
  } = input;

  if (session.destroyed) {
    throw new ShareError("encode", "Draft session is destroyed.", {
      localIntact: false,
    });
  }

  // 1. Submission snapshot of the CURRENT local doc state (edits made after this
  //    continue locally and reconcile through normal Yjs sync after attach).
  let body: string;
  try {
    body = JSON.stringify({
      creationToken,
      submittedUpdate: encodeStandardBase64(Y.encodeStateAsUpdate(session.doc)),
      submittedStateVector: encodeStandardBase64(Y.encodeStateVector(session.doc)),
      title,
      language,
      schemaVersion: CREATE_SCHEMA_VERSION,
    });
  } catch (err) {
    throw new ShareError("encode", "Failed to encode the draft.", {
      localIntact: true,
      cause: err,
    });
  }

  // 2. Create the remote sheet through the same-origin HTTP API.
  let res: Response;
  try {
    res = await doFetch(createSheetPath(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (err) {
    throw new ShareError("http", "Could not reach the server.", {
      localIntact: true,
      cause: err,
    });
  }

  // 3. Non-2xx → typed server rejection (draft stays local). The error body is
  //    read best-effort; a non-JSON body keeps the generic message but stays a
  //    typed, actionable `rejected` failure.
  const { status } = res;
  if (status < 200 || status >= 300) {
    let code: string | undefined;
    let message = `Create request failed (${status}).`;
    try {
      const errBody = (await res.json()) as { error?: string; message?: string };
      if (typeof errBody?.error === "string") code = errBody.error;
      if (typeof errBody?.message === "string") message = errBody.message;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ShareError("rejected", message, {
      localIntact: true,
      status,
      code,
    });
  }

  // 3b. Only 200/201 are valid create receipts. Any OTHER 2xx (202/204/…) is a
  //     server-contract violation, not a create — reject it as a receipt failure
  //     rather than trusting an unexpected success.
  if (status !== 200 && status !== 201) {
    throw new ShareError(
      "receipt",
      `Create returned an unexpected success status (${status}).`,
      { localIntact: true, status },
    );
  }

  // 4. Read and strictly validate the JSON receipt. A body read / JSON parse
  //    failure and a malformed payload are BOTH typed receipt failures that
  //    preserve the original cause.
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    throw receiptError("Create response body could not be read as JSON.", err);
  }
  const receipt = parseReceipt(payload); // throws typed `receipt` ShareError

  // ─── The remote sheet now exists durably. Record acknowledgement immediately
  //     (HTTP status accepted + receipt validated) so a concurrent conflict can
  //     report remoteCreated + sheetId + receipt even before ownership transfers.
  //     From here, any pre-transfer failure additionally carries remoteCreated +
  //     sheetId + receipt so a same-token retry can recover and S6 can message
  //     honestly. ───
  hooks.markAcknowledged(receipt.sheetId, receipt);

  // 5 + 6. Construct the provider over the EXACT existing doc + awareness and
  // atomically take cleanup ownership. Construction happens inside the
  // controller's construct callback, so a construction failure keeps the session
  // locally owned (S3 contract), and a transfer failure destroys the just-built
  // provider and leaves the session local. `providerConstructed` distinguishes
  // the two for typed reporting; both are pre-transfer (localIntact).
  const controller = createSharedSessionController(session);
  let providerConstructed = false;
  let handle: SheetProviderHandle;
  try {
    handle = controller.attachAndTakeOwnership(() => {
      const h = createProvider({
        sheetId: receipt.sheetId,
        doc: session.doc,
        awareness: session.awareness,
        onStatus,
        onSync,
        onTerminal,
        serverUrl,
        WebsocketProviderCtor,
      });
      providerConstructed = true;
      return h;
    });
  } catch (err) {
    const stage: ShareFailureStage = providerConstructed ? "ownership" : "provider";
    // Both cases are pre-transfer: the session was never transferred, so it is
    // still locally owned and editable. The remote sheet exists, so a same-token
    // retry replays idempotently. If cleanup during a transfer failure ALSO threw,
    // S3 aggregated both into the thrown error — preserved here as `cause`, never
    // replaced.
    throw new ShareError(
      stage,
      stage === "provider"
        ? "Failed to construct the collaboration provider."
        : "Failed to take ownership of the shared session.",
      {
        localIntact: true,
        remoteCreated: true,
        sheetId: receipt.sheetId,
        receipt,
        cause: err,
      },
    );
  }

  // ─── OWNERSHIP HAS TRANSFERRED. Cleanup is now solely the controller's, and
  //     the operation never reverts to a fully-local draft. ───
  hooks.markTransferred();

  // 7. Connect ONLY now — after the server acknowledged creation AND ownership
  //    transferred — gated through post-connect stabilization. A pending result
  //    is never a rollback: the controller and provider are retained, the durable
  //    sheet already exists, and NO second POST or provider is issued. It is
  //    RETRYABLE when `connect()` merely threw while the lifecycle stayed live
  //    (its retryConnect re-drives the SAME provider through the SAME gate), and
  //    TERMINAL (retryable:false, no retryConnect) when a synchronous disposal or
  //    a microtask-queued teardown tore the shared session down.
  const outcome = await stabilizeConnect({
    controller,
    handle,
    sheetId: receipt.sheetId,
    receipt,
  });
  if (!outcome.ok) {
    return buildPendingResult({
      sheetId: receipt.sheetId,
      receipt,
      controller,
      handle,
      connectError: outcome.error,
      retryable: outcome.retryable,
    });
  }

  // 8. Fully connected — the attempt survived lifecycle stabilization.
  return Object.freeze({
    status: "connected",
    sheetId: receipt.sheetId,
    receipt,
    controller,
  });
}

/**
 * Share a local draft as a new server-backed sheet.
 *
 * De-duplicated per session (see the module header): a reference-compatible
 * duplicate call returns the SAME promise (one sheet, one provider); an
 * incompatible concurrent/subsequent call rejects immediately with a typed
 * `conflict` ShareError, issuing no POST and attaching no provider. A pre-transfer
 * failure clears the entry so a compatible attempt may retry; a settled
 * connected / connection-pending success keeps the entry (the session is one-way
 * shared).
 */
export function shareDraftSession(input: ShareDraftSessionInput): Promise<ShareSuccess> {
  const { session } = input;
  const identity = identityOf(input);

  const existing = SHARE_ENTRIES.get(session);
  if (existing) {
    if (compatible(existing.identity, identity)) {
      return existing.promise; // exact same in-flight/settled share
    }
    // A DIFFERENT attempt already owns this session's fate. Reject without side
    // effects. The phase is read HONESTLY from the owning attempt: `localIntact`
    // from `transferred` (the draft is no longer independently local once
    // ownership moves), and `remoteCreated` + `sheetId` + `receipt` from
    // `acknowledged` (the durable sheet exists once the receipt validated —
    // independent of, and earlier than, transfer). The controller is never
    // exposed here (it stays owned by the original attempt).
    return Promise.reject(
      new ShareError(
        "conflict",
        "This draft already has an active or completed share attempt with different inputs.",
        {
          localIntact: !existing.transferred,
          remoteCreated: existing.acknowledged,
          sheetId: existing.acknowledged ? existing.sheetId : undefined,
          receipt: existing.acknowledged ? existing.receipt : undefined,
          code: SHARE_ERROR_CODES.CONFLICT,
        },
      ),
    );
  }

  const entry: ShareEntry = {
    identity,
    acknowledged: false,
    transferred: false,
    // Assigned immediately below; the closure captures `entry` for phase updates.
    promise: undefined as unknown as Promise<ShareSuccess>,
  };
  entry.promise = runShare(input, {
    markAcknowledged: (sheetId, receipt) => {
      entry.acknowledged = true;
      entry.sheetId = sheetId;
      entry.receipt = receipt;
    },
    markTransferred: () => {
      entry.transferred = true;
    },
  }).then(
    (ok) => ok, // keep the entry: the session is now one-way shared
    (err) => {
      // Clear ONLY on a pre-transfer failure (localIntact) so a compatible retry
      // can proceed; keep it for the destroyed-session guard and any (impossible
      // by construction) post-transfer rejection. Guard against clobbering a
      // newer entry.
      if (
        err instanceof ShareError &&
        err.localIntact &&
        SHARE_ENTRIES.get(session) === entry
      ) {
        SHARE_ENTRIES.delete(session);
      }
      throw err;
    },
  );
  SHARE_ENTRIES.set(session, entry);
  return entry.promise;
}
