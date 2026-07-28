import { sheetBootstrapPath } from "./topology";
import { isValidSheetId } from "./sheetId";
import { LANGUAGES, type LanguageId } from "./languages";
import { createDraftSession, type DraftSession } from "./draftSession";
import {
  createSharedSessionController,
  type SharedSessionController,
} from "./sharedSessionOwnership";
import {
  createSheetProvider,
  type CreateSheetProviderOptions,
  type SheetProviderHandle,
  type TerminalResult,
} from "./providerFactory";

/**
 * Direct-load join orchestration (M4 S6).
 *
 * `openSheetSession()` is the owned lifecycle for opening `/{sheetId}` in a fresh
 * tab (or after a refresh of a shared sheet). It is a STANDALONE operation — not
 * embedded in the page — so its ownership phases are explicit and testable:
 *
 *   bootstrap metadata (GET /api/sheets/{id})
 *     → create a fresh local session          ← the operation owns it here
 *     → createSharedSessionController(session)
 *     → attachAndTakeOwnership(createProvider) ← controller now owns provider+session
 *     → connect()
 *     → await first onSync(true)               ← publish a READY result
 *
 * Ownership contract:
 * - BEFORE attachment, the operation owns the fresh session; any abort/failure
 *   destroys it.
 * - AFTER attachment, the SharedSessionController owns the provider AND session;
 *   all cleanup goes through `controller.dispose()`.
 * - A stale/aborted READY result must be disposed by the caller via
 *   `outcome.controller.dispose()`, never published.
 *
 * TOTALITY: `openSheetSession()` never rejects. Every exceptional path — an
 * aborted fetch/body-read, a throwing session/controller/provider construction,
 * a throwing attach/connect/dispose, and every callback interleaving (a
 * synchronous or async `onSync`/`onTerminal` fired during construction or
 * connect, sync-then-terminal before READY, multiple `onSync(true)`, terminal
 * after READY, cleanup racing terminal) — resolves to a totalized outcome.
 *
 * Callback ordering:
 * - callbacks are buffered until controller ownership is established;
 * - READY is NEVER published before `connect()` returns successfully;
 * - if a terminal occurs before READY is published, terminal WINS;
 * - multiple `onSync(true)` publish READY exactly once;
 * - a synchronous terminal must not leak a provider/controller;
 * - disposal errors are contained and never replace the primary outcome.
 *
 * The editor is mounted by the caller ONLY on a READY outcome (after the first
 * authoritative sync) — never before.
 */

/** Safe metadata returned by GET /api/sheets/{id} (see server/bootstrap.mjs). */
export type SheetBootstrap = {
  readonly sheetId: string;
  readonly title: string;
  readonly language: LanguageId;
  readonly schemaVersion: number;
  readonly serverRevision: number;
  readonly metadataRevision: number;
};

/**
 * The owned outcome of an open attempt.
 * - `ready` — first sync reached; the caller mounts the editor and holds the
 *   controller for cleanup. A terminal close AFTER this is delivered via
 *   `onStopped` (the editor stays mounted and locally editable).
 * - `unavailable` — bootstrap 404/400 (no such sheet / malformed id).
 * - `error` — bootstrap network failure / 5xx / malformed response, OR a
 *   construction/connect failure after a valid bootstrap.
 * - `stopped` — a terminal WebSocket close BEFORE first sync (lifecycle disposed
 *   internally; nothing to mount).
 * - `aborted` — the caller aborted; any attached lifecycle was disposed.
 */
export type OpenSheetOutcome =
  | {
      status: "ready";
      controller: SharedSessionController;
      session: DraftSession;
      bootstrap: SheetBootstrap;
    }
  | { status: "unavailable" }
  | { status: "error" }
  | { status: "stopped" }
  | { status: "aborted" };

export type OpenSheetOptions = {
  sheetId: string;
  /** Aborts the open; disposes whatever lifecycle phase is active. */
  signal?: AbortSignal;
  /** Terminal close AFTER a READY publish (editor stays mounted). */
  onStopped?: (result: TerminalResult) => void;
  /** Injectable seams (default to the real implementations). */
  fetch?: typeof fetch;
  createSession?: () => DraftSession;
  createController?: (session: DraftSession) => SharedSessionController;
  createProvider?: (opts: CreateSheetProviderOptions) => SheetProviderHandle;
  serverUrl?: string;
  WebsocketProviderCtor?: CreateSheetProviderOptions["WebsocketProviderCtor"];
};

/**
 * Server-authoritative title bound (mirrors server/limits.mjs MAX_TITLE_CODE_POINTS).
 * Measured in Unicode code points, matching the server's canonical measurement.
 */
const MAX_TITLE_CODE_POINTS = 200;

/** A safe integer `>= 1` (revision fields). Rejects NaN/Infinity/fractional/unsafe. */
function isRevisionGte1(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** True iff `id` is one of the client's supported languages (no plaintext coercion). */
function isSupportedLanguage(id: unknown): id is LanguageId {
  return typeof id === "string" && LANGUAGES.some((l) => l.id === id);
}

/**
 * STRICTLY parse the bootstrap payload; `null` ⇒ malformed (treated as an
 * open-error, never `unavailable`). Every field is validated exactly:
 * - `sheetId` is a valid sheet id AND equals the requested route id;
 * - `title` is a string of at most 200 Unicode code points;
 * - `language` is a supported LanguageId (a corrupt value is REJECTED, never
 *   coerced to plaintext);
 * - `schemaVersion` is exactly the integer 0;
 * - `serverRevision` / `metadataRevision` are safe integers `>= 1`.
 * Extra fields are ignored.
 */
export function parseBootstrap(
  json: unknown,
  expectedSheetId: string,
): SheetBootstrap | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (!isValidSheetId(r.sheetId)) return null;
  if (r.sheetId !== expectedSheetId) return null;
  if (typeof r.title !== "string") return null;
  if ([...r.title].length > MAX_TITLE_CODE_POINTS) return null;
  if (!isSupportedLanguage(r.language)) return null;
  if (r.schemaVersion !== 0) return null; // exactly integer 0 (also rejects non-number)
  if (!isRevisionGte1(r.serverRevision)) return null;
  if (!isRevisionGte1(r.metadataRevision)) return null;
  return Object.freeze({
    sheetId: r.sheetId,
    title: r.title,
    language: r.language,
    schemaVersion: 0,
    serverRevision: r.serverRevision,
    metadataRevision: r.metadataRevision,
  });
}

/**
 * Fetch + strictly validate authoritative bootstrap metadata for a sheet.
 * Returns the parsed bootstrap or `null` on ANY failure (network, non-2xx, body
 * read, malformed payload). NEVER rejects — reusable by the sharer's post-adoption
 * metadata reconciliation (see useShareFlow) as well as internally.
 */
export async function fetchSheetBootstrap(
  sheetId: string,
  opts: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SheetBootstrap | null> {
  const { fetch: doFetch = globalThis.fetch, signal } = opts;
  try {
    const res = await doFetch(sheetBootstrapPath(sheetId), { signal });
    if (!res.ok) return null;
    const body = await res.json();
    return parseBootstrap(body, sheetId);
  } catch {
    return null;
  }
}

export async function openSheetSession(
  opts: OpenSheetOptions,
): Promise<OpenSheetOutcome> {
  const {
    sheetId,
    signal,
    onStopped,
    fetch: doFetch = globalThis.fetch,
    createSession = createDraftSession,
    createController = createSharedSessionController,
    createProvider = createSheetProvider,
    serverUrl,
    WebsocketProviderCtor,
  } = opts;

  // ── Phase 0: bootstrap. Nothing is constructed yet. The AbortSignal is passed
  //    straight to fetch; an abort during the fetch or the body read maps to the
  //    aborted outcome (not error). ──
  if (signal?.aborted) return { status: "aborted" };
  let res: Response;
  try {
    res = await doFetch(sheetBootstrapPath(sheetId), { signal });
  } catch {
    return signal?.aborted ? { status: "aborted" } : { status: "error" };
  }
  if (signal?.aborted) return { status: "aborted" };
  if (res.status === 404 || res.status === 400) return { status: "unavailable" };
  if (!res.ok) return { status: "error" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return signal?.aborted ? { status: "aborted" } : { status: "error" };
  }
  if (signal?.aborted) return { status: "aborted" };
  const bootstrap = parseBootstrap(body, sheetId);
  if (!bootstrap) return { status: "error" };

  // ── Phase 1: the operation owns a fresh local session. A throwing factory is
  //    totalized to an error (nothing to dispose). ──
  let session: DraftSession;
  try {
    session = createSession();
  } catch {
    return { status: "error" };
  }
  if (signal?.aborted) {
    try {
      session.destroy();
    } catch {
      /* contained */
    }
    return { status: "aborted" };
  }

  // ── Phase 2: attach + connect; wait for first sync or a pre-sync terminal. The
  //    promise executor NEVER throws out (it would reject the returned promise);
  //    every branch resolves through `finish`. ──
  return await new Promise<OpenSheetOutcome>((resolve) => {
    let settled = false; // the outcome is latched (resolve happened once)
    let disposed = false; // owned lifecycle disposal has run once
    let published = false; // a READY outcome has been published
    let synced = false; // first onSync(true) observed
    let readyGateOpen = false; // connect() returned successfully
    let terminal = false; // a pre-READY terminal was observed
    let ownershipEstablished = false; // controller owns provider+session
    let controller: SharedSessionController | null = null;

    const removeAbort = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    /** Contained disposal of whatever is currently owned, at most ONCE. */
    const disposeOnce = () => {
      if (disposed) return;
      disposed = true;
      try {
        if (ownershipEstablished && controller) controller.dispose();
        else if (!controller) session.destroy();
        // If a controller exists but ownership was never established, the attach
        // catch below already destroyed the still-local session.
      } catch {
        /* contained — a disposal error never replaces the primary outcome */
      }
    };

    /**
     * Latch the outcome exactly once. The `settled` flag is set BEFORE any
     * disposal, so `controller.dispose()` synchronously emitting a terminal (or an
     * abort firing during disposal) re-enters `onTerminal`/`onAbort`, finds the
     * outcome already latched, and returns WITHOUT recursion or mutation — the
     * aborted/stopped/ready outcome is preserved and the controller is disposed
     * exactly once.
     */
    const settle = (outcome: OpenSheetOutcome, dispose: boolean) => {
      if (settled) return;
      settled = true;
      removeAbort();
      if (dispose) disposeOnce();
      resolve(outcome);
    };

    const finishStopped = () => settle({ status: "stopped" }, true);

    /** Publish READY iff every gate is satisfied and no terminal intervened. */
    const tryPublishReady = () => {
      if (settled || published) return;
      if (!readyGateOpen || !ownershipEstablished || !controller) return;
      if (terminal) {
        finishStopped();
        return;
      }
      if (!synced) return;
      published = true; // set before settle so a post-ready terminal notifies
      settle({ status: "ready", controller, session, bootstrap }, false);
    };

    const onSync = (isSynced: boolean) => {
      if (settled || published || !isSynced) return;
      synced = true; // buffered; publication is gated by tryPublishReady
      tryPublishReady();
    };

    const onTerminal = (result: TerminalResult) => {
      if (published) {
        // After READY (the promise is already settled): the provider tore down;
        // keep the editor mounted and just notify. Checked BEFORE `settled` so a
        // legitimate post-ready terminal is never swallowed by the settle guard.
        onStopped?.(result);
        return;
      }
      // Already settled (aborted/stopped/error) — including a terminal emitted
      // synchronously DURING disposal — is inert: never recurse, never re-latch.
      if (settled) return;
      // Before READY: terminal WINS. Buffer it; act only once we are safely
      // OUTSIDE any provider construct/connect call stack (readyGateOpen) or after
      // ownership is established from a construct-time terminal.
      terminal = true;
      if (readyGateOpen) finishStopped();
    };

    function onAbort() {
      settle({ status: "aborted" }, true);
    }

    // Synchronous attach + connect. No await interleaves here, so `signal.aborted`
    // checks fully cover abort during this block; the abort LISTENER is only added
    // afterward for the async wait-for-sync window.
    let handle: SheetProviderHandle;
    try {
      controller = createController(session);
      handle = controller.attachAndTakeOwnership(() =>
        createProvider({
          sheetId,
          doc: session.doc,
          awareness: session.awareness,
          onSync,
          onTerminal,
          serverUrl,
          WebsocketProviderCtor,
        }),
      );
    } catch {
      // Pre-transfer failure (controller/provider construct or transfer threw):
      // the session was never transferred, so it is still locally owned. If a
      // controller was created but attachment failed, its own teardown already
      // handled the provider; the session remains ours to destroy.
      try {
        session.destroy();
      } catch {
        /* contained */
      }
      settle({ status: "error" }, false); // session already destroyed above
      return;
    }
    ownershipEstablished = true;

    // Aborted during the synchronous attach window → dispose through the controller.
    if (signal?.aborted) {
      settle({ status: "aborted" }, true);
      return;
    }
    // A terminal buffered during construction wins now (safely outside connect()).
    if (terminal) {
      finishStopped();
      return;
    }

    signal?.addEventListener("abort", onAbort);

    // connect() may throw or may synchronously fire onSync/onTerminal (buffered).
    try {
      handle.connect();
    } catch {
      // connect() failed to open. Ownership has transferred, so dispose through
      // the controller. A terminal buffered alongside the throw still means the
      // session tore down → stopped; otherwise a plain open failure → error.
      if (terminal) finishStopped();
      else settle({ status: "error" }, true);
      return;
    }

    // connect() returned: open the READY gate, then drain any buffered callbacks
    // (terminal wins over a buffered sync).
    readyGateOpen = true;
    if (terminal) {
      finishStopped();
      return;
    }
    tryPublishReady();
  });
}
