import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import { wsBase } from "./topology";

/**
 * Provider lifecycle wrapper (M4 S3).
 *
 * Attaches a y-websocket provider to an ALREADY-EXISTING `Y.Doc` and `Awareness`
 * (the local draft session's own primitives) without constructing or replacing
 * any collaboration object, and makes terminal-close teardown race-safe and
 * idempotent.
 *
 * Terminal-close hazard (verified against installed y-websocket@3.0.0). For a
 * terminal close of a connected socket, `closeWebsocketConnection` emits, IN
 * ORDER and synchronously within its own still-running routine:
 *
 *     …connecting → connected → connection-close → sync(false) → status(disconnected)
 *
 * and then schedules a reconnect via `setTimeout(setupWS, …)`. Two consequences
 * drive this design:
 *
 * 1. The trailing `sync(false)` / `status(disconnected)` must NOT overwrite the
 *    terminal UI state, so the moment a terminal close is recognized we latch
 *    `terminalHandled` synchronously and suppress ALL further status/sync
 *    forwarding.
 * 2. Consumer code (`onTerminal`) must never run inside y-websocket's close
 *    stack — a consumer that synchronously disposes the ownership controller
 *    would re-enter `disconnect()`/`closeWebsocketConnection`. So on a terminal
 *    close we ONLY latch synchronously and queue exactly one microtask; the
 *    microtask performs teardown and then notifies the consumer, outside the
 *    close stack. `provider.destroy()` → `disconnect()` sets `shouldConnect =
 *    false`, so the already-scheduled `setupWS` becomes a no-op.
 *
 * Deterministic microtask order: destroy the provider FIRST, then invoke
 * `onTerminal`. Both are attempted even if one throws; a callback error is
 * reported after cleanup (never swallowed) rather than aborting teardown.
 *
 * This module constructs NO Y.Doc, Y.Text, Awareness, UndoManager, or editor
 * binding, and opens no socket at import or construction — `connect()` is
 * explicit. It never exposes the mutable underlying provider.
 */

/** Terminal close reasons (see the close-code policy below). */
export type TerminalReason =
  | "unavailable" // 4404 — no such sheet
  | "protocol" // 4400 — malformed protocol/content (NOT automatically unavailable)
  | "too-large" // 4409 — oversized content
  | "corrupt"; // 4500 — corrupt / incompatible durable state

export type TerminalResult = {
  readonly code: number;
  readonly reason: TerminalReason;
};

/**
 * Close-code classification. A code present here is TERMINAL: the wrapper reports
 * it and tears down (no reconnect). Any other code — notably 1011 (retryable
 * operational failure) and ordinary transport drops (1006/1005/1001/…) — is
 * retryable and left to y-websocket's normal backoff reconnect.
 */
const TERMINAL_CODES: Readonly<Record<number, TerminalReason>> = Object.freeze({
  4400: "protocol",
  4404: "unavailable",
  4409: "too-large",
  4500: "corrupt",
});

/** Classify a close code; `undefined` means "retryable, not terminal". */
export function classifyCloseCode(code: number | undefined): TerminalReason | undefined {
  return code == null ? undefined : TERMINAL_CODES[code];
}

/**
 * The MINIMAL structural surface of a y-websocket provider the wrapper uses:
 * exactly `connect`, `destroy`, and listener (de)registration. Deliberately does
 * NOT include `disconnect`, `shouldConnect`, `doc`, `awareness`, or any mutable
 * field, so neither the wrapper's callers nor its tests can bypass lifecycle
 * policy through the handle.
 */
export interface ProviderLike {
  connect(): void;
  destroy(): void;
  on(name: string, fn: (...args: unknown[]) => void): void;
  off(name: string, fn: (...args: unknown[]) => void): void;
}

export type ProviderCtor = new (
  serverUrl: string,
  roomname: string,
  doc: Y.Doc,
  opts: { connect: boolean; awareness: Awareness; disableBc: boolean },
) => ProviderLike;

export type CreateSheetProviderOptions = {
  sheetId: string;
  /** The EXISTING session doc — never reconstructed. */
  doc: Y.Doc;
  /** The EXISTING session awareness — never reconstructed. */
  awareness: Awareness;
  onStatus?: (status: "connected" | "connecting" | "disconnected") => void;
  onSync?: (synced: boolean) => void;
  onTerminal?: (result: TerminalResult) => void;
  /** Test seam: inject a fake provider constructor. Defaults to the real one. */
  WebsocketProviderCtor?: ProviderCtor;
  /**
   * Test/non-browser seam: override the WebSocket base URL. Defaults to
   * `wsBase()` (which reads `window.location`), evaluated ONLY when omitted — so
   * a Node integration test can supply an explicit `ws://…/ws` base without a
   * DOM. Production (browser) callers omit it.
   */
  serverUrl?: string;
};

/**
 * The public handle. Intentionally exposes ONLY lifecycle control — never the
 * mutable underlying provider — so callers cannot bypass the terminal/teardown
 * policy via `provider.destroy()`, `disconnect()`, `shouldConnect`, or listener
 * mutation.
 */
export type SheetProviderHandle = {
  /** Explicitly open the connection. No-op once destroyed. */
  connect(): void;
  /** Idempotent wrapper-level teardown: detaches listeners and destroys the
   *  underlying provider AT MOST ONCE. */
  destroy(): void;
  /** True once destroyed. */
  readonly destroyed: boolean;
};

/**
 * Construct a provider bound to the supplied `doc` + `awareness`. Does not
 * connect; call `handle.connect()`.
 */
export function createSheetProvider({
  sheetId,
  doc,
  awareness,
  onStatus,
  onSync,
  onTerminal,
  WebsocketProviderCtor = WebsocketProvider as unknown as ProviderCtor,
  serverUrl = wsBase(),
}: CreateSheetProviderOptions): SheetProviderHandle {
  // Exact construction contract: attach to the existing doc + awareness, do not
  // connect yet, and never use cross-tab BroadcastChannel (all sync flows
  // through the one audited server transport).
  const provider = new WebsocketProviderCtor(serverUrl, sheetId, doc, {
    connect: false,
    awareness,
    disableBc: true,
  });

  let destroyed = false;
  // Latched synchronously the moment a terminal close is recognized. Once set,
  // ALL later status/sync forwarding is suppressed so a trailing routine
  // `sync(false)`/`status(disconnected)` can never overwrite the terminal state.
  let terminalHandled = false;
  let terminalResult: TerminalResult | null = null;
  let terminalNotified = false;

  // Status/sync are forwarded only while neither destroyed nor terminal-latched.
  const forwardingSuppressed = () => destroyed || terminalHandled;

  const handleStatus = (arg: unknown) => {
    if (forwardingSuppressed()) return;
    onStatus?.((arg as { status: "connected" | "connecting" | "disconnected" }).status);
  };

  const handleSync = (arg: unknown) => {
    if (forwardingSuppressed()) return;
    onSync?.(arg as boolean);
  };

  const handleClose = (arg: unknown) => {
    // Ignore after cleanup and after a terminal is already latched (including
    // the re-emit our own destroy produces).
    if (destroyed || terminalHandled) return;
    const code = (arg as { code?: number } | null)?.code;
    const reason = classifyCloseCode(code);
    if (reason === undefined) return; // retryable — let y-websocket reconnect
    // Latch synchronously; suppress all further forwarding immediately. Do NOT
    // touch the provider or the consumer here — we are inside y-websocket's
    // close stack. Defer both to exactly one microtask.
    terminalHandled = true;
    terminalResult = { code: code as number, reason };
    queueMicrotask(finalizeTerminal);
  };

  provider.on("status", handleStatus);
  provider.on("sync", handleSync);
  provider.on("connection-close", handleClose);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    provider.off("status", handleStatus);
    provider.off("sync", handleSync);
    provider.off("connection-close", handleClose);
    // provider.destroy() → disconnect() sets shouldConnect = false, so any
    // reconnect y-websocket already scheduled becomes a no-op.
    provider.destroy();
  }

  /**
   * Runs on a microtask, OUTSIDE y-websocket's close stack. Deterministic order:
   * destroy the provider first, then notify the consumer. Both steps are always
   * attempted; a consumer-callback error is reported after cleanup rather than
   * aborting teardown, and internal state is finalized exactly once.
   */
  function finalizeTerminal() {
    let cleanupError: unknown;
    try {
      destroy(); // idempotent — provider destroyed at most once
    } catch (err) {
      cleanupError = err;
    }
    let callbackError: unknown;
    if (!terminalNotified) {
      terminalNotified = true;
      try {
        onTerminal?.(terminalResult as TerminalResult);
      } catch (err) {
        callbackError = err;
      }
    }
    // Report (never swallow) after cleanup. There is no application-wide error
    // channel yet, so surface via console.error in a controlled way; cleanup has
    // already completed, so reporting cannot prevent teardown.
    if (cleanupError !== undefined) {
      console.error("sheet provider terminal teardown failed:", cleanupError);
    }
    if (callbackError !== undefined) {
      console.error("sheet provider onTerminal callback threw:", callbackError);
    }
  }

  return {
    connect() {
      if (!destroyed) provider.connect();
    },
    destroy,
    get destroyed() {
      return destroyed;
    },
  };
}
