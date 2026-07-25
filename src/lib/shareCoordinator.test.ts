import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { encodeStandardBase64 } from "./base64";
import { createDraftSession } from "./draftSession";
import type { CreateSheetProviderOptions, SheetProviderHandle } from "./providerFactory";
import {
  __test as shareCoordinatorTest,
  SHARE_ERROR_CODES,
  ShareError,
  shareDraftSession,
  type ShareConnected,
  type ShareConnectionPending,
  type ShareReceipt,
  type ShareSuccess,
} from "./shareCoordinator";

const { stabilizeConnect } = shareCoordinatorTest;

/** The retryable arm of the pending union — the only one exposing retryConnect. */
type RetryablePending = Extract<ShareConnectionPending, { retryable: true }>;

/** Assert a share result is a RETRYABLE connection-pending and narrow to it. */
function expectRetryablePending(r: ShareSuccess): RetryablePending {
  expect(r.status).toBe("connection-pending");
  if (r.status !== "connection-pending" || !r.retryable) {
    throw new Error("expected a retryable connection-pending result");
  }
  return r;
}

const TOKEN = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";

// A genuinely valid, canonical Yjs state vector (an empty doc → single byte [0]).
const VALID_SV = encodeStandardBase64(Y.encodeStateVector(new Y.Doc()));

const RECEIPT = Object.freeze({
  sheetId: "abcdefghij123456", // 16 chars
  serverRevision: 1,
  committedStateVector: VALID_SV,
  committedMetadataRevision: 1,
  committedAt: 123,
});

/** Minimal Response stand-in (ok/status/json). */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A Response whose `.json()` rejects — models a body read / JSON parse failure. */
function throwingJsonResponse(status: number, cause: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw cause;
    },
  } as unknown as Response;
}

type ProviderRecord = {
  createCalls: number;
  connectCalls: number;
  destroyCalls: number;
  lastOpts?: CreateSheetProviderOptions;
  handle?: SheetProviderHandle;
  throwOnCreate?: boolean;
  /** Number of leading connect() calls that throw before one succeeds. */
  connectFailTimes?: number;
  /** Invoke opts.onTerminal from inside connect() (models an immediate close). */
  fireTerminalOnConnect?: boolean;
  /**
   * Called inside connect() with the handle — a lifecycle seam letting a test
   * model a synchronous or microtask-queued teardown (dispose the controller,
   * destroy the handle) that races the post-connect stabilization checkpoint.
   * Mutable so it can differ between the initial connect and a later retry.
   */
  onConnect?: (handle: SheetProviderHandle) => void;
  /**
   * Called inside createProvider() with the construct opts — runs synchronously
   * AFTER receipt acknowledgement but BEFORE ownership transfer, so a test can
   * act in the acked-but-not-transferred window (e.g. issue a conflicting call).
   */
  onCreate?: (opts: CreateSheetProviderOptions) => void;
};

function mkRecord(over: Partial<ProviderRecord> = {}): ProviderRecord {
  return { createCalls: 0, connectCalls: 0, destroyCalls: 0, ...over };
}

/** A fake createProvider that returns a fake handle and records interactions. */
function fakeCreateProvider(rec: ProviderRecord) {
  return (opts: CreateSheetProviderOptions): SheetProviderHandle => {
    rec.createCalls++;
    rec.lastOpts = opts;
    rec.onCreate?.(opts); // post-ack, pre-transfer window
    if (rec.throwOnCreate) throw new Error("provider construction failed");
    let destroyed = false;
    const handle: SheetProviderHandle = {
      connect() {
        rec.connectCalls++;
        rec.onConnect?.(handle);
        if (rec.fireTerminalOnConnect) {
          opts.onTerminal?.({ code: 4404, reason: "unavailable" });
        }
        if (rec.connectFailTimes && rec.connectFailTimes > 0) {
          rec.connectFailTimes--;
          throw new Error("connect failed");
        }
      },
      destroy() {
        rec.destroyCalls++;
        destroyed = true;
      },
      get destroyed() {
        return destroyed;
      },
    };
    rec.handle = handle;
    return handle;
  };
}

const sessions: ReturnType<typeof createDraftSession>[] = [];
function freshSession() {
  const s = createDraftSession();
  sessions.push(s);
  return s;
}
afterEach(() => {
  while (sessions.length) sessions.pop()!.disposeUnlessTransferred();
  vi.restoreAllMocks();
});

describe("shareDraftSession — success", () => {
  it("creates one sheet, reuses exact primitives, transfers ownership, connects after ack", async () => {
    const session = freshSession();
    session.text.insert(0, "hello world");
    const beforeDoc = session.doc;
    const beforeText = session.text;
    const beforeAwareness = session.awareness;
    const beforeUndo = session.undoManager;

    const rec = mkRecord();
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));

    const result = await shareDraftSession({
      session,
      title: "notes",
      language: "typescript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider: fakeCreateProvider(rec),
    });

    // One create request, correct target/shape.
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [url, init] = doFetch.mock.calls[0];
    expect(url).toBe("/api/sheets");
    expect(init?.method).toBe("POST");
    const sent = JSON.parse(init?.body as string);
    expect(sent.creationToken).toBe(TOKEN);
    expect(sent.title).toBe("notes");
    expect(sent.language).toBe("typescript");
    expect(sent.schemaVersion).toBe(0);
    expect(sent.submittedUpdate).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // standard base64
    expect(sent.submittedStateVector).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    // Discriminated success.
    expect(result.status).toBe("connected");

    // Provider attached to the EXACT existing primitives — nothing reconstructed.
    expect(rec.lastOpts?.doc).toBe(beforeDoc);
    expect(rec.lastOpts?.awareness).toBe(beforeAwareness);
    expect(rec.lastOpts?.sheetId).toBe(RECEIPT.sheetId);
    expect(session.doc).toBe(beforeDoc);
    expect(session.text).toBe(beforeText);
    expect(session.awareness).toBe(beforeAwareness);
    expect(session.undoManager).toBe(beforeUndo);

    // Connected exactly once, after the receipt.
    expect(rec.connectCalls).toBe(1);

    // Ownership transferred: the local unmount path is now a harmless no-op.
    session.disposeUnlessTransferred();
    expect(session.destroyed).toBe(false);

    // Narrow, immutable result.
    expect(result.sheetId).toBe(RECEIPT.sheetId);
    expect(result.controller.phase).toBe("shared");
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(result.receipt.committedStateVector).toBe(VALID_SV);

    // Cleanup is owned solely by the controller: provider first, then session.
    result.controller.dispose();
    expect(rec.destroyCalls).toBe(1);
    expect(session.destroyed).toBe(true);
  });

  it("does not expose any mutable provider internals on the result", async () => {
    const session = freshSession();
    const rec = mkRecord();
    const result = await shareDraftSession({
      session,
      title: "",
      language: "plaintext",
      creationToken: TOKEN,
      fetch: async () => jsonResponse(200, RECEIPT),
      createProvider: fakeCreateProvider(rec),
    });
    expect(Object.keys(result).sort()).toEqual([
      "controller",
      "receipt",
      "sheetId",
      "status",
    ]);
    expect((result as Record<string, unknown>).handle).toBeUndefined();
    expect((result as Record<string, unknown>).provider).toBeUndefined();
    expect((result.controller as Record<string, unknown>).provider).toBeUndefined();
    result.controller.dispose();
  });
});

describe("shareDraftSession — connect timing", () => {
  it("does not construct the provider or connect before the server acknowledges", async () => {
    const session = freshSession();
    const rec = mkRecord();
    let resolveFetch!: (r: Response) => void;
    const doFetch = vi.fn(() => new Promise<Response>((r) => (resolveFetch = r)));

    const p = shareDraftSession({
      session,
      title: "t",
      language: "javascript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider: fakeCreateProvider(rec),
    });

    // Let the synchronous prologue + the pending fetch settle.
    await Promise.resolve();
    expect(rec.createCalls).toBe(0);
    expect(rec.connectCalls).toBe(0);

    resolveFetch(jsonResponse(201, RECEIPT));
    const result = await p;
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(1);
    result.controller.dispose();
  });
});

describe("shareDraftSession — strict receipt validation", () => {
  /** Run a share whose fetch returns `response` and expect a typed receipt failure. */
  async function expectReceiptFailure(response: Response) {
    const session = freshSession();
    const rec = mkRecord();
    const err = await shareDraftSession({
      session,
      title: "t",
      language: "javascript",
      creationToken: TOKEN,
      fetch: async () => response,
      createProvider: fakeCreateProvider(rec),
    }).then(
      () => {
        throw new Error("expected rejection");
      },
      (e) => e as ShareError,
    );
    expect(err).toBeInstanceOf(ShareError);
    expect(err.stage).toBe("receipt");
    expect(err.localIntact).toBe(true);
    expect(err.remoteCreated).toBe(false); // no valid receipt ⇒ not acknowledged
    expect(rec.createCalls).toBe(0); // never reached provider construction
    expect(session.destroyed).toBe(false);
    return err;
  }

  const badReceipt = (over: Record<string, unknown>) =>
    jsonResponse(201, { ...RECEIPT, ...over });

  it("rejects a negative serverRevision", () =>
    expectReceiptFailure(badReceipt({ serverRevision: -1 })));
  it("rejects a zero revision (minimum is 1)", () =>
    expectReceiptFailure(badReceipt({ serverRevision: 0 })));
  it("rejects a fractional revision", () =>
    expectReceiptFailure(badReceipt({ serverRevision: 1.5 })));
  it("rejects NaN", () => expectReceiptFailure(badReceipt({ serverRevision: NaN })));
  it("rejects Infinity", () =>
    expectReceiptFailure(badReceipt({ serverRevision: Infinity })));
  it("rejects an unsafe integer", () =>
    expectReceiptFailure(badReceipt({ serverRevision: Number.MAX_SAFE_INTEGER + 1 })));
  it("rejects a zero committedMetadataRevision", () =>
    expectReceiptFailure(badReceipt({ committedMetadataRevision: 0 })));
  it("rejects a negative committedAt", () =>
    expectReceiptFailure(badReceipt({ committedAt: -1 })));
  it("rejects a fractional committedAt", () =>
    expectReceiptFailure(badReceipt({ committedAt: 1.5 })));
  it("rejects an invalid sheetId shape", () =>
    expectReceiptFailure(badReceipt({ sheetId: "too-short" })));

  it("rejects malformed base64 in committedStateVector", () =>
    expectReceiptFailure(badReceipt({ committedStateVector: "not*base64" })));
  it("rejects base64url in committedStateVector", () =>
    expectReceiptFailure(badReceipt({ committedStateVector: "-_-_" })));
  it("rejects non-canonical padding in committedStateVector", () =>
    expectReceiptFailure(badReceipt({ committedStateVector: "A===" })));
  it("rejects valid base64 that is not a valid Yjs state vector", () =>
    // [0x01] decodes fine but claims one client with no (client, clock) bytes.
    expectReceiptFailure(badReceipt({ committedStateVector: "AQ==" })));
  it("rejects a valid state vector with trailing bytes", () =>
    // [0x00, 0x00]: zero clients, but a stray trailing byte remains.
    expectReceiptFailure(badReceipt({ committedStateVector: "AAA=" })));

  it("rejects a non-object success payload", () =>
    expectReceiptFailure(jsonResponse(201, [1, 2, 3])));

  it("rejects an unexpected successful 2xx status", async () => {
    const err = await expectReceiptFailure(jsonResponse(202, RECEIPT));
    expect(err.status).toBe(202);
  });

  it("preserves the cause of a malformed JSON success response", async () => {
    const cause = new SyntaxError("Unexpected token");
    const err = await expectReceiptFailure(throwingJsonResponse(201, cause));
    expect(err.cause).toBe(cause);
  });

  it("preserves the cause of a body-read failure", async () => {
    const cause = new Error("stream aborted");
    const err = await expectReceiptFailure(throwingJsonResponse(200, cause));
    expect(err.cause).toBe(cause);
  });
});

describe("shareDraftSession — pre-transfer failures leave the draft local", () => {
  async function expectLocalAfter(
    run: () => Promise<unknown>,
    stage: ShareError["stage"],
  ) {
    const err = await run().then(
      () => {
        throw new Error("expected rejection");
      },
      (e) => e as ShareError,
    );
    expect(err).toBeInstanceOf(ShareError);
    expect(err.stage).toBe(stage);
    expect(err.localIntact).toBe(true);
    return err;
  }

  it("HTTP failure (remoteCreated false)", async () => {
    const session = freshSession();
    const rec = mkRecord();
    const err = await expectLocalAfter(
      () =>
        shareDraftSession({
          session,
          title: "t",
          language: "javascript",
          creationToken: TOKEN,
          fetch: async () => {
            throw new TypeError("network down");
          },
          createProvider: fakeCreateProvider(rec),
        }),
      "http",
    );
    expect(err.remoteCreated).toBe(false);
    expect(rec.createCalls).toBe(0);
    expect(session.destroyed).toBe(false);
    session.disposeUnlessTransferred();
    expect(session.destroyed).toBe(true); // was still locally owned
  });

  it("server rejection (typed error body, non-JSON tolerated)", async () => {
    const session = freshSession();
    const rec = mkRecord();
    const err = await expectLocalAfter(
      () =>
        shareDraftSession({
          session,
          title: "t",
          language: "javascript",
          creationToken: TOKEN,
          fetch: async () =>
            jsonResponse(422, { error: "unsupported_language", message: "nope" }),
          createProvider: fakeCreateProvider(rec),
        }),
      "rejected",
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe("unsupported_language");
    expect(err.remoteCreated).toBe(false);
    expect(rec.createCalls).toBe(0);
    expect(session.destroyed).toBe(false);
  });

  it("non-2xx with a non-JSON body stays a typed rejection", async () => {
    const session = freshSession();
    const rec = mkRecord();
    const err = await expectLocalAfter(
      () =>
        shareDraftSession({
          session,
          title: "t",
          language: "javascript",
          creationToken: TOKEN,
          fetch: async () => throwingJsonResponse(500, new Error("not json")),
          createProvider: fakeCreateProvider(rec),
        }),
      "rejected",
    );
    expect(err.status).toBe(500);
    expect(rec.createCalls).toBe(0);
  });

  it("provider construction failure (remote sheet exists)", async () => {
    const session = freshSession();
    const rec = mkRecord({ throwOnCreate: true });
    const err = await expectLocalAfter(
      () =>
        shareDraftSession({
          session,
          title: "t",
          language: "javascript",
          creationToken: TOKEN,
          fetch: async () => jsonResponse(201, RECEIPT),
          createProvider: fakeCreateProvider(rec),
        }),
      "provider",
    );
    expect(rec.createCalls).toBe(1); // attempted…
    expect(rec.destroyCalls).toBe(0); // …nothing to clean
    expect(session.destroyed).toBe(false);
    // Remote sheet already exists → known remote info is attached for retry/S6.
    expect(err.remoteCreated).toBe(true);
    expect(err.sheetId).toBe(RECEIPT.sheetId);
    expect(err.receipt).toEqual(RECEIPT);
    session.disposeUnlessTransferred();
    expect(session.destroyed).toBe(true);
  });

  it("ownership transfer failure cleans the provider and preserves the connect-side cause", async () => {
    const session = freshSession();
    vi.spyOn(session, "transferOwnership").mockImplementation(() => {
      throw new Error("transfer failed");
    });
    const rec = mkRecord();
    const err = await expectLocalAfter(
      () =>
        shareDraftSession({
          session,
          title: "t",
          language: "javascript",
          creationToken: TOKEN,
          fetch: async () => jsonResponse(201, RECEIPT),
          createProvider: fakeCreateProvider(rec),
        }),
      "ownership",
    );
    expect(err.localIntact).toBe(true);
    expect(err.remoteCreated).toBe(true);
    expect(err.receipt).toEqual(RECEIPT);
    expect(rec.createCalls).toBe(1);
    expect(rec.destroyCalls).toBe(1); // provider cleaned up
    expect(rec.handle?.destroyed).toBe(true);
    expect(session.destroyed).toBe(false); // session never transferred → still local
  });
});

describe("shareDraftSession — post-transfer connect failure is recoverable", () => {
  async function shareWithPendingConnect(rec: ProviderRecord) {
    const session = freshSession();
    const result = await shareDraftSession({
      session,
      title: "t",
      language: "javascript",
      creationToken: TOKEN,
      fetch: async () => jsonResponse(201, RECEIPT),
      createProvider: fakeCreateProvider(rec),
    });
    return { session, result };
  }

  it("reports a retryable connection-pending (not rejection) and preserves the session", async () => {
    const rec = mkRecord({ connectFailTimes: 1 });
    const { session, result } = await shareWithPendingConnect(rec);
    const beforeDoc = session.doc;
    const beforeAwareness = session.awareness;
    const beforeUndo = session.undoManager;

    // connect() threw while the lifecycle stayed live ⇒ RETRYABLE pending.
    const pending = expectRetryablePending(result);
    expect(pending.retryable).toBe(true);
    expect(typeof pending.retryConnect).toBe("function");
    expect(pending.sheetId).toBe(RECEIPT.sheetId);
    expect(pending.receipt).toEqual(RECEIPT);
    expect(pending.connectError).toBeInstanceOf(ShareError);
    expect(pending.connectError.stage).toBe("connect");
    expect(pending.connectError.localIntact).toBe(false);
    expect(pending.connectError.remoteCreated).toBe(true);

    // Controller remains the shared owner; nothing was disposed automatically.
    expect(pending.controller.phase).toBe("shared");
    expect(rec.destroyCalls).toBe(0);
    expect(session.destroyed).toBe(false);
    // Primitives are alive and identical (no reconstruction, no replacement).
    expect(session.doc).toBe(beforeDoc);
    expect(session.awareness).toBe(beforeAwareness);
    expect(session.undoManager).toBe(beforeUndo);

    pending.controller.dispose();
  });

  it("retryConnect reuses the same provider (no POST, no new provider) and transitions to connected", async () => {
    const rec = mkRecord({ connectFailTimes: 1 });
    const session = freshSession();
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));
    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: doFetch,
        createProvider: fakeCreateProvider(rec),
      }),
    );
    expect(rec.connectCalls).toBe(1);

    const retried = await pending.retryConnect();
    expect(retried.status).toBe("connected");
    expect(retried.sheetId).toBe(RECEIPT.sheetId);
    expect(retried.controller).toBe(pending.controller); // same owner
    expect(doFetch).toHaveBeenCalledTimes(1); // no second POST
    expect(rec.createCalls).toBe(1); // no second provider
    expect(rec.connectCalls).toBe(2); // one failed + one successful connect

    // Deterministic thereafter: a further retry returns the same connected result.
    const again = await pending.retryConnect();
    expect(again).toBe(retried);
    expect(rec.connectCalls).toBe(2);

    pending.controller.dispose();
  });

  it("de-duplicates concurrent retryConnect calls into one attempt", async () => {
    const rec = mkRecord({ connectFailTimes: 1 });
    const session = freshSession();
    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: async () => jsonResponse(201, RECEIPT),
        createProvider: fakeCreateProvider(rec),
      }),
    );

    const [a, b] = await Promise.all([pending.retryConnect(), pending.retryConnect()]);
    expect(a).toBe(b);
    expect(rec.connectCalls).toBe(2); // one initial failure + exactly one retry
    pending.controller.dispose();
  });

  it("a failed retry can be retried again (in-flight slot cleared on failure)", async () => {
    const rec = mkRecord({ connectFailTimes: 2 }); // fail initial + first retry
    const session = freshSession();
    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: async () => jsonResponse(201, RECEIPT),
        createProvider: fakeCreateProvider(rec),
      }),
    );

    await expect(pending.retryConnect()).rejects.toBeInstanceOf(ShareError);
    const ok = await pending.retryConnect();
    expect(ok.status).toBe("connected");
    pending.controller.dispose();
  });

  it("explicit controller disposal after connection-pending keeps retry failure-visible", async () => {
    const rec = mkRecord({ connectFailTimes: 5 });
    const session = freshSession();
    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: async () => jsonResponse(201, RECEIPT),
        createProvider: fakeCreateProvider(rec),
      }),
    );

    pending.controller.dispose();
    expect(session.destroyed).toBe(true);

    const err = await pending.retryConnect().then(
      () => {
        throw new Error("expected rejection");
      },
      (e) => e as ShareError,
    );
    expect(err).toBeInstanceOf(ShareError);
    expect(err.stage).toBe("connect");
    expect(err.localIntact).toBe(false);
    // Deterministic: no connect() was issued against the disposed controller.
    expect(rec.connectCalls).toBe(1);
  });

  it("a terminal event fired during connect does not corrupt the connected result", async () => {
    const onTerminal = vi.fn();
    const rec = mkRecord({ fireTerminalOnConnect: true }); // connect fires onTerminal, succeeds
    const session = freshSession();
    const result = await shareDraftSession({
      session,
      title: "t",
      language: "javascript",
      creationToken: TOKEN,
      fetch: async () => jsonResponse(201, RECEIPT),
      createProvider: fakeCreateProvider(rec),
      onTerminal,
    });
    expect(result.status).toBe("connected");
    expect(result.sheetId).toBe(RECEIPT.sheetId);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    result.controller.dispose();
  });
});

describe("stabilizeConnect (internal gate, direct)", () => {
  type Ctrl = ShareConnectionPending["controller"];
  const SHEET = RECEIPT.sheetId;

  /**
   * A minimal controller+handle pair for driving `stabilizeConnect` directly —
   * lets a test model `handle.connect() { controller.dispose() }` with NO public
   * share API and NO production hook. `dispose()` mirrors a real shared
   * controller: it flips the phase to "disposed" AND destroys the handle.
   */
  function directLifecycle() {
    let phase: "shared" | "local" | "disposed" = "shared";
    let destroyed = false;
    let connectImpl: (() => void) | undefined;
    let connectCalls = 0;
    const controller = {
      get phase() {
        return phase;
      },
    } as unknown as Ctrl;
    const handle: SheetProviderHandle = {
      connect() {
        connectCalls++;
        connectImpl?.();
      },
      destroy() {
        destroyed = true;
      },
      get destroyed() {
        return destroyed;
      },
    };
    return {
      controller,
      handle,
      get connectCalls() {
        return connectCalls;
      },
      onConnect(fn: () => void) {
        connectImpl = fn;
      },
      disposeController() {
        phase = "disposed";
        destroyed = true;
      },
      destroyHandle() {
        destroyed = true;
      },
    };
  }

  const run = (lc: ReturnType<typeof directLifecycle>) =>
    stabilizeConnect({
      controller: lc.controller,
      handle: lc.handle,
      sheetId: SHEET,
      receipt: RECEIPT,
    });

  it("reports ok when connect returns and the lifecycle survives the microtask", async () => {
    const lc = directLifecycle();
    const out = await run(lc);
    expect(out.ok).toBe(true);
    expect(lc.connectCalls).toBe(1);
  });

  it("is terminal (retryable:false) when connect synchronously disposes the controller", async () => {
    const lc = directLifecycle();
    lc.onConnect(() => lc.disposeController()); // handle.connect() { controller.dispose() }
    const out = await run(lc);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.retryable).toBe(false);
    expect(out.error.stage).toBe("connect");
    expect(out.error.localIntact).toBe(false);
    expect(out.error.remoteCreated).toBe(true);
    expect(out.error.sheetId).toBe(SHEET);
    expect(out.error.receipt).toEqual(RECEIPT);
    expect(lc.connectCalls).toBe(1);
  });

  it("is terminal (retryable:false) and does NOT call connect when already torn down", async () => {
    const lc = directLifecycle();
    lc.disposeController(); // pre-connect teardown
    const out = await run(lc);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.retryable).toBe(false);
    expect(lc.connectCalls).toBe(0); // never connected an already-gone session
  });

  it("is terminal (retryable:false) when a queued microtask destroys the handle", async () => {
    const lc = directLifecycle();
    lc.onConnect(() => queueMicrotask(() => lc.destroyHandle()));
    const out = await run(lc);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.retryable).toBe(false);
    expect(lc.connectCalls).toBe(1);
  });

  it("is retryable when connect throws while the lifecycle stays live", async () => {
    const lc = directLifecycle();
    const boom = new Error("connect failed");
    lc.onConnect(() => {
      throw boom;
    });
    const out = await run(lc);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.retryable).toBe(true);
    expect(out.error.stage).toBe("connect");
    expect(out.error.cause).toBe(boom);
  });

  it("is terminal when connect both throws AND tears the lifecycle down", async () => {
    const lc = directLifecycle();
    lc.onConnect(() => {
      lc.disposeController();
      throw new Error("connect failed after disposal");
    });
    const out = await run(lc);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.retryable).toBe(false);
  });

  // Race 1: connect QUEUES a teardown microtask and THEN throws. The retryability
  // decision must wait for the same post-connect checkpoint (never the catch
  // site), so the queued destroy is observed → TERMINAL (retryable:false), not a
  // premature retryable:true. The original throw survives only as `cause`.
  it("is terminal (retryable:false) when connect queues teardown AND throws", async () => {
    const lc = directLifecycle();
    const boom = new Error("boom");
    lc.onConnect(() => {
      queueMicrotask(() => lc.destroyHandle());
      throw boom;
    });
    const out = await run(lc);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.retryable).toBe(false); // queued teardown observed by the checkpoint
    expect(lc.handle.destroyed).toBe(true); // handle is destroyed after stabilization
    expect(out.error).toBeInstanceOf(ShareError);
    expect(out.error.stage).toBe("connect");
    expect(out.error.localIntact).toBe(false);
    expect(out.error.remoteCreated).toBe(true);
    expect(out.error.sheetId).toBe(SHEET);
    expect(out.error.receipt).toEqual(RECEIPT);
    expect(out.error.cause).toBe(boom); // thrown value preserved even though torn down
    expect(lc.connectCalls).toBe(1);
  });

  // Repair 2: EVERY thrown value becomes a fresh connect-stage ShareError with
  // truthful metadata; the original is preserved only as `cause`.
  it.each([
    [
      "a provider-stage ShareError with foreign metadata",
      new ShareError("provider", "provider boom", {
        localIntact: true,
        remoteCreated: false,
        sheetId: "zzzzzzzzzzzzzzzz",
        receipt: Object.freeze({ ...RECEIPT, sheetId: "zzzzzzzzzzzzzzzz" }),
      }),
    ],
    [
      "a connect-stage ShareError with wrong metadata",
      new ShareError("connect", "wrong", {
        localIntact: true,
        remoteCreated: false,
        sheetId: "wrongwrongwrong1",
      }),
    ],
    ["a bare string value", "kaboom"],
    ["a null value", null],
  ])("normalizes %s thrown from connect into a fresh connect error", async (_label, thrown) => {
    const lc = directLifecycle();
    lc.onConnect(() => {
      throw thrown;
    });
    const out = await run(lc);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    // Always a NEW connect-stage error with THIS attempt's truthful metadata.
    expect(out.error).toBeInstanceOf(ShareError);
    expect(out.error).not.toBe(thrown);
    expect(out.error.stage).toBe("connect");
    expect(out.error.localIntact).toBe(false);
    expect(out.error.remoteCreated).toBe(true);
    expect(out.error.sheetId).toBe(SHEET);
    expect(out.error.receipt).toEqual(RECEIPT);
    expect(out.error.message).toBe("Failed to connect to the shared sheet.");
    // The original thrown value survives only as cause.
    expect(out.error.cause).toBe(thrown);
  });
});

describe("shareDraftSession — post-connect lifecycle stabilization", () => {
  it("initial: connect throws while live → RETRYABLE pending (POST 1 / provider 1 / connect 1)", async () => {
    const session = freshSession();
    const beforeDoc = session.doc;
    const beforeAwareness = session.awareness;
    const beforeUndo = session.undoManager;
    const rec = mkRecord({ connectFailTimes: 1 });
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));

    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: doFetch,
        createProvider: fakeCreateProvider(rec),
      }),
    );

    expect(pending.retryable).toBe(true);
    expect(pending.sheetId).toBe(RECEIPT.sheetId);
    expect(pending.receipt).toEqual(RECEIPT);
    expect(pending.connectError.localIntact).toBe(false);
    expect(pending.connectError.remoteCreated).toBe(true);
    // Lifecycle live; no primitive replaced.
    expect(pending.controller.phase).toBe("shared");
    expect(session.doc).toBe(beforeDoc);
    expect(session.awareness).toBe(beforeAwareness);
    expect(session.undoManager).toBe(beforeUndo);
    // Counts.
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(1);
    pending.controller.dispose();
  });

  it("initial: synchronous teardown destroys the handle during connect → TERMINAL pending (POST 1 / provider 1 / connect 1)", async () => {
    const session = freshSession();
    const beforeDoc = session.doc;
    const beforeAwareness = session.awareness;
    const beforeUndo = session.undoManager;
    const rec = mkRecord();
    rec.onConnect = (handle) => handle.destroy(); // synchronous teardown
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));

    const result = await shareDraftSession({
      session,
      title: "t",
      language: "javascript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider: fakeCreateProvider(rec),
    });

    // Terminal: never connected, no retryConnect exposed.
    expect(result.status).toBe("connection-pending");
    if (result.status !== "connection-pending") throw new Error("unreachable");
    expect(result.retryable).toBe(false);
    expect("retryConnect" in result).toBe(false);
    expect(result.connectError.stage).toBe("connect");
    expect(result.connectError.localIntact).toBe(false);
    expect(result.connectError.remoteCreated).toBe(true);
    expect(result.sheetId).toBe(RECEIPT.sheetId);
    expect(result.receipt).toEqual(RECEIPT);
    expect(rec.handle?.destroyed).toBe(true);
    // No primitive replaced; only the handle was destroyed.
    expect(session.doc).toBe(beforeDoc);
    expect(session.awareness).toBe(beforeAwareness);
    expect(session.undoManager).toBe(beforeUndo);
    // Counts.
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(1);
    result.controller.dispose();
  });

  it("initial: queued microtask destroys the handle → TERMINAL pending (POST 1 / provider 1 / connect 1)", async () => {
    const session = freshSession();
    const beforeDoc = session.doc;
    const beforeAwareness = session.awareness;
    const beforeUndo = session.undoManager;
    const rec = mkRecord();
    // Models S3's terminal teardown: connect latches, then destroys on a microtask.
    rec.onConnect = (handle) => queueMicrotask(() => handle.destroy());
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));

    const result = await shareDraftSession({
      session,
      title: "t",
      language: "javascript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider: fakeCreateProvider(rec),
    });

    expect(result.status).toBe("connection-pending");
    if (result.status !== "connection-pending") throw new Error("unreachable");
    expect(result.retryable).toBe(false);
    expect("retryConnect" in result).toBe(false);
    expect(rec.handle?.destroyed).toBe(true);
    // Ownership was never disposed (controller preserved); primitives intact.
    expect(result.controller.phase).toBe("shared");
    expect(session.destroyed).toBe(false);
    expect(session.doc).toBe(beforeDoc);
    expect(session.awareness).toBe(beforeAwareness);
    expect(session.undoManager).toBe(beforeUndo);
    expect(result.sheetId).toBe(RECEIPT.sheetId);
    expect(result.receipt).toEqual(RECEIPT);
    // Counts.
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(1);
    result.controller.dispose();
  });

  it("initial: connect queues teardown AND throws → TERMINAL pending (POST 1 / provider 1 / connect 1)", async () => {
    const session = freshSession();
    const beforeDoc = session.doc;
    const beforeAwareness = session.awareness;
    const beforeUndo = session.undoManager;
    // connect() queues a destroy microtask and then throws: without the unified
    // checkpoint this would look retryable (handle not yet destroyed at the catch
    // site), but the queued teardown makes it TERMINAL.
    const rec = mkRecord({ connectFailTimes: 1 });
    rec.onConnect = (handle) => queueMicrotask(() => handle.destroy());
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));

    const result = await shareDraftSession({
      session,
      title: "t",
      language: "javascript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider: fakeCreateProvider(rec),
    });

    // Terminal: never connected, no retryConnect exposed.
    expect(result.status).toBe("connection-pending");
    if (result.status !== "connection-pending") throw new Error("unreachable");
    expect(result.retryable).toBe(false);
    expect("retryConnect" in result).toBe(false);
    expect(rec.handle?.destroyed).toBe(true);
    expect(result.connectError.stage).toBe("connect");
    expect(result.connectError.localIntact).toBe(false);
    expect(result.connectError.remoteCreated).toBe(true);
    expect(result.connectError.sheetId).toBe(RECEIPT.sheetId);
    expect(result.connectError.receipt).toEqual(RECEIPT);
    // The original thrown connect error survives as the terminal error's cause.
    expect(result.connectError.cause).toBeInstanceOf(Error);
    expect(result.sheetId).toBe(RECEIPT.sheetId);
    expect(result.receipt).toEqual(RECEIPT);
    // Ownership preserved (controller not disposed); only the handle was destroyed.
    expect(result.controller.phase).toBe("shared");
    expect(session.destroyed).toBe(false);
    expect(session.doc).toBe(beforeDoc);
    expect(session.awareness).toBe(beforeAwareness);
    expect(session.undoManager).toBe(beforeUndo);
    // Counts.
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(1);
    result.controller.dispose();
  });

  it("retry: synchronous controller disposal during the retry connect → rejects (POST 1 / provider 1 / connect 2)", async () => {
    const rec = mkRecord({ connectFailTimes: 1 });
    const session = freshSession();
    const beforeDoc = session.doc;
    const beforeAwareness = session.awareness;
    const beforeUndo = session.undoManager;
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));
    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: doFetch,
        createProvider: fakeCreateProvider(rec),
      }),
    );
    expect(rec.connectCalls).toBe(1);

    // On the NEXT connect (the retry) dispose the controller synchronously.
    rec.onConnect = () => pending.controller.dispose();
    const err = await pending.retryConnect().then(
      () => {
        throw new Error("expected rejection");
      },
      (e) => e as ShareError,
    );
    expect(err.stage).toBe("connect");
    expect(err.localIntact).toBe(false);
    expect(err.remoteCreated).toBe(true);
    expect(err.sheetId).toBe(RECEIPT.sheetId);
    expect(err.receipt).toEqual(RECEIPT);
    expect(pending.controller.phase).toBe("disposed");
    expect(rec.handle?.destroyed).toBe(true);
    expect(session.destroyed).toBe(true);
    // No primitive was replaced across the share (identity captured pre-teardown).
    expect(beforeDoc).toBe(session.doc);
    expect(beforeAwareness).toBe(session.awareness);
    expect(beforeUndo).toBe(session.undoManager);
    // Counts.
    expect(doFetch).toHaveBeenCalledTimes(1); // no second POST
    expect(rec.createCalls).toBe(1); // no second provider
    expect(rec.connectCalls).toBe(2); // initial + the disposed retry
    // A further retry stays deterministically failed WITHOUT connecting again.
    await expect(pending.retryConnect()).rejects.toBeInstanceOf(ShareError);
    expect(rec.connectCalls).toBe(2);
  });

  it("retry: queued microtask destroys the handle during the retry connect → rejects (POST 1 / provider 1 / connect 2)", async () => {
    const rec = mkRecord({ connectFailTimes: 1 });
    const session = freshSession();
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));
    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: doFetch,
        createProvider: fakeCreateProvider(rec),
      }),
    );

    rec.onConnect = (handle) => queueMicrotask(() => handle.destroy());
    const err = await pending.retryConnect().then(
      () => {
        throw new Error("expected rejection");
      },
      (e) => e as ShareError,
    );
    expect(err.stage).toBe("connect");
    expect(err.remoteCreated).toBe(true);
    expect(err.sheetId).toBe(RECEIPT.sheetId);
    expect(rec.handle?.destroyed).toBe(true);
    // Controller preserved (handle destroyed, ownership never disposed).
    expect(pending.controller.phase).toBe("shared");
    expect(session.destroyed).toBe(false);
    // Counts.
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(2);
    pending.controller.dispose();
  });

  it("a retry whose connect throws keeps the same pending capability alive with no duplicate POST/provider", async () => {
    const rec = mkRecord({ connectFailTimes: 2 }); // fail initial + first retry
    const session = freshSession();
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));
    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: doFetch,
        createProvider: fakeCreateProvider(rec),
      }),
    );

    const err = await pending.retryConnect().then(
      () => {
        throw new Error("expected rejection");
      },
      (e) => e as ShareError,
    );
    expect(err.stage).toBe("connect");
    expect(err.remoteCreated).toBe(true);
    // Same pending capability still usable; a later retry finally connects.
    const connected = await pending.retryConnect();
    expect(connected.status).toBe("connected");
    expect(connected.controller).toBe(pending.controller);
    expect(doFetch).toHaveBeenCalledTimes(1); // never re-POSTed
    expect(rec.createCalls).toBe(1); // never re-constructed a provider
    expect(rec.connectCalls).toBe(3); // initial + failed retry + successful retry
    pending.controller.dispose();
  });
});

describe("shareDraftSession — memoized connected is re-validated against lifecycle", () => {
  /** Reach a live retryable pending whose next connect succeeds. */
  async function connectedAfterRetry(rec: ProviderRecord) {
    const session = freshSession();
    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: async () => jsonResponse(201, RECEIPT),
        createProvider: fakeCreateProvider(rec),
      }),
    );
    const connected = await pending.retryConnect(); // memoized
    expect(connected.status).toBe("connected");
    return { session, pending, connected };
  }

  it("rejects (never returns stale connected) after controller.dispose() following a successful retry", async () => {
    const rec = mkRecord({ connectFailTimes: 1 });
    const { pending, connected } = await connectedAfterRetry(rec);
    const connectsBefore = rec.connectCalls;

    pending.controller.dispose(); // teardown AFTER a memoized success

    const err = await pending.retryConnect().then(
      () => {
        throw new Error("expected rejection (stale connected must not be returned)");
      },
      (e) => e as ShareError,
    );
    expect(err).toBeInstanceOf(ShareError);
    expect(err).not.toBe(connected);
    expect(err.stage).toBe("connect");
    expect(err.localIntact).toBe(false);
    expect(err.remoteCreated).toBe(true);
    expect(err.sheetId).toBe(RECEIPT.sheetId);
    expect(err.receipt).toEqual(RECEIPT);
    // No connect() was issued against the disposed controller.
    expect(rec.connectCalls).toBe(connectsBefore);
  });

  it("rejects (never returns stale connected) after handle.destroy() following a successful retry", async () => {
    const rec = mkRecord({ connectFailTimes: 1 });
    const { pending, connected } = await connectedAfterRetry(rec);
    const connectsBefore = rec.connectCalls;

    rec.handle?.destroy(); // destroy just the handle after a memoized success

    const err = await pending.retryConnect().then(
      () => {
        throw new Error("expected rejection (stale connected must not be returned)");
      },
      (e) => e as ShareError,
    );
    expect(err).toBeInstanceOf(ShareError);
    expect(err).not.toBe(connected);
    expect(err.stage).toBe("connect");
    expect(rec.connectCalls).toBe(connectsBefore); // no re-connect
    pending.controller.dispose();
  });

  it("returns the SAME memoized connected result to concurrent calls while still live", async () => {
    const rec = mkRecord({ connectFailTimes: 1 });
    const { pending, connected } = await connectedAfterRetry(rec);
    const connectsBefore = rec.connectCalls;

    const [a, b] = await Promise.all([pending.retryConnect(), pending.retryConnect()]);
    expect(a).toBe(connected);
    expect(b).toBe(connected);
    expect(rec.connectCalls).toBe(connectsBefore); // no additional connect
    pending.controller.dispose();
  });
});

describe("shareDraftSession — a stale in-flight connected never escapes teardown", () => {
  /**
   * Race 2 (Codex): a retry succeeds and memoizes `connected`, then — in the
   * narrow window AFTER that success resolves but BEFORE the in-flight slot is
   * cleared — the lifecycle is torn down and `retryConnect()` is called again. It
   * must reject with a fresh terminal connect error, NEVER hand back the already
   * fulfilled in-flight (stale connected) promise, and NEVER call connect() again.
   *
   * The window is hit deterministically by having the successful retry's connect
   * QUEUE a two-deep microtask: the outer defers past `stabilizeConnect`'s single
   * checkpoint (so the retry memoizes `connected`), and the inner runs before the
   * in-flight-clearing subscription — exactly the leak window. `teardown` models
   * either disposal path.
   */
  async function reentrantAfterMemoizedWindow(
    teardown: (ctx: { rec: ProviderRecord; controller: RetryablePending["controller"] }) => void,
  ) {
    const rec = mkRecord({ connectFailTimes: 1 });
    const session = freshSession();
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));
    const pending = expectRetryablePending(
      await shareDraftSession({
        session,
        title: "t",
        language: "javascript",
        creationToken: TOKEN,
        fetch: doFetch,
        createProvider: fakeCreateProvider(rec),
      }),
    );
    expect(rec.connectCalls).toBe(1);

    let reentrant: Promise<ShareConnected> | undefined;
    rec.onConnect = () => {
      queueMicrotask(() =>
        queueMicrotask(() => {
          teardown({ rec, controller: pending.controller }); // dispose OR destroy
          reentrant = pending.retryConnect(); // sees an as-yet-uncleared in-flight
        }),
      );
    };

    const connected = await pending.retryConnect(); // the retry itself succeeds
    expect(connected.status).toBe("connected");
    return { rec, session, doFetch, pending, connected, reentrant: reentrant! };
  }

  it("rejects the re-entrant retry after controller.dispose() in the pre-clear window", async () => {
    const { rec, session, doFetch, pending, connected, reentrant } =
      await reentrantAfterMemoizedWindow(({ controller }) => controller.dispose());

    const err = await reentrant.then(
      () => {
        throw new Error("stale connected must not escape after teardown");
      },
      (e) => e as ShareError,
    );
    expect(err).toBeInstanceOf(ShareError);
    expect(err).not.toBe(connected);
    expect(err.stage).toBe("connect");
    expect(err.localIntact).toBe(false);
    expect(err.remoteCreated).toBe(true);
    expect(err.sheetId).toBe(RECEIPT.sheetId);
    expect(err.receipt).toEqual(RECEIPT);
    // One POST, one provider, no connect after teardown (initial + one retry).
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(2);
    expect(pending.controller.phase).toBe("disposed");
    expect(session.destroyed).toBe(true);
  });

  it("rejects the re-entrant retry after handle.destroy() in the pre-clear window", async () => {
    const { rec, doFetch, pending, connected, reentrant } =
      await reentrantAfterMemoizedWindow(({ rec: r }) => r.handle?.destroy());

    const err = await reentrant.then(
      () => {
        throw new Error("stale connected must not escape after teardown");
      },
      (e) => e as ShareError,
    );
    expect(err).toBeInstanceOf(ShareError);
    expect(err).not.toBe(connected);
    expect(err.stage).toBe("connect");
    expect(err.remoteCreated).toBe(true);
    expect(err.sheetId).toBe(RECEIPT.sheetId);
    // Destroying only the handle leaves the controller as the shared owner.
    expect(pending.controller.phase).toBe("shared");
    expect(rec.handle?.destroyed).toBe(true);
    // One POST, one provider, no connect after teardown (initial + one retry).
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(2);
    pending.controller.dispose();
  });
});

describe("shareDraftSession — acknowledged-state conflict tracking", () => {
  it("a conflict after acknowledgement + transfer carries remoteCreated, sheetId, and receipt", async () => {
    const session = freshSession();
    // connectFailTimes:1 settles the owning attempt to connection-pending, which
    // is acknowledged (receipt validated) AND transferred (ownership moved).
    const rec = mkRecord({ connectFailTimes: 1 });
    const createProvider = fakeCreateProvider(rec);
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));
    const pending = (await shareDraftSession({
      session,
      title: "t",
      language: "typescript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider,
    })) as ShareConnectionPending;
    expect(pending.status).toBe("connection-pending");

    const err = await shareDraftSession({
      session,
      title: "different", // incompatible
      language: "typescript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider,
    }).then(
      () => {
        throw new Error("expected conflict rejection");
      },
      (e) => e as ShareError,
    );

    expect(err.stage).toBe("conflict");
    expect(err.code).toBe(SHARE_ERROR_CODES.CONFLICT);
    expect(err.remoteCreated).toBe(true);
    expect(err.localIntact).toBe(false); // ownership already transferred
    expect(err.sheetId).toBe(RECEIPT.sheetId);
    expect(err.receipt).toEqual(RECEIPT);
    // The conflicting call issued nothing of its own.
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    pending.controller.dispose();
  });

  it("a conflict before acknowledgement claims no remote creation and omits sheetId/receipt", async () => {
    const session = freshSession();
    const rec = mkRecord();
    let resolveFetch!: (r: Response) => void;
    const doFetch = vi.fn(() => new Promise<Response>((r) => (resolveFetch = r)));
    const createProvider = fakeCreateProvider(rec);
    const first = shareDraftSession({
      session,
      title: "t",
      language: "typescript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider,
    });

    // The create fetch is still in flight → the receipt has NOT been acknowledged.
    const err = await shareDraftSession({
      session,
      title: "different",
      language: "typescript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider,
    }).then(
      () => {
        throw new Error("expected conflict rejection");
      },
      (e) => e as ShareError,
    );

    expect(err.stage).toBe("conflict");
    expect(err.remoteCreated).toBe(false);
    expect(err.localIntact).toBe(true); // draft is still fully local
    expect(err.sheetId).toBeUndefined();
    expect(err.receipt).toBeUndefined();
    expect(rec.createCalls).toBe(0);

    resolveFetch(jsonResponse(201, RECEIPT));
    const ok = await first;
    ok.controller.dispose();
  });

  it("a conflict AFTER acknowledgement but BEFORE transfer carries localIntact:true + remoteCreated + sheetId + receipt", async () => {
    const session = freshSession();
    // The first attempt acknowledges the receipt, then — synchronously inside
    // provider construction, still PRE-transfer — fires an incompatible second
    // call, and finally throws so the first attempt fails at the provider stage.
    const rec = mkRecord({ throwOnCreate: true });
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));
    const secondFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));
    const secondRec = mkRecord();
    let conflictPromise: Promise<ShareError> | undefined;
    rec.onCreate = () => {
      // Acked-but-not-transferred window: an incompatible call must conflict now.
      conflictPromise = shareDraftSession({
        session,
        title: "different",
        language: "typescript",
        creationToken: TOKEN,
        fetch: secondFetch,
        createProvider: fakeCreateProvider(secondRec),
      }).then(
        () => {
          throw new Error("expected conflict rejection");
        },
        (e) => e as ShareError,
      );
    };

    const first = await shareDraftSession({
      session,
      title: "t",
      language: "typescript",
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider: fakeCreateProvider(rec),
    }).then(
      () => {
        throw new Error("expected provider failure");
      },
      (e) => e as ShareError,
    );

    // First attempt failed at the provider stage — post-ack, but pre-transfer.
    expect(first.stage).toBe("provider");
    expect(first.remoteCreated).toBe(true);
    expect(first.localIntact).toBe(true);

    const conflict = await conflictPromise!;
    expect(conflict.stage).toBe("conflict");
    expect(conflict.code).toBe(SHARE_ERROR_CODES.CONFLICT);
    expect(conflict.localIntact).toBe(true); // ownership NOT yet transferred
    expect(conflict.remoteCreated).toBe(true); // receipt already acknowledged
    expect(conflict.sheetId).toBe(RECEIPT.sheetId);
    expect(conflict.receipt).toEqual(RECEIPT);
    // A conflict never exposes the controller.
    expect((conflict as unknown as Record<string, unknown>).controller).toBeUndefined();
    // The conflicting call issued no POST and constructed no provider of its own.
    expect(secondFetch).not.toHaveBeenCalled();
    expect(secondRec.createCalls).toBe(0);

    // The pre-transfer failure cleared its entry → a same-token retry proceeds.
    const retryRec = mkRecord();
    const ok = await shareDraftSession({
      session,
      title: "t",
      language: "typescript",
      creationToken: TOKEN,
      fetch: async () => jsonResponse(200, RECEIPT), // idempotent replay
      createProvider: fakeCreateProvider(retryRec),
    });
    expect(ok.status).toBe("connected");
    expect(ok.sheetId).toBe(RECEIPT.sheetId);
    expect(retryRec.createCalls).toBe(1);
    ok.controller.dispose();
  });
});

describe("shareDraftSession — retained result semantics", () => {
  it("resolves once, never mutates variant, and memoizes the connected result shared across duplicate callers", async () => {
    const session = freshSession();
    const rec = mkRecord({ connectFailTimes: 1 });
    const doFetch = vi.fn<typeof fetch>(async () => jsonResponse(201, RECEIPT));
    const input = {
      session,
      title: "t",
      language: "typescript" as const,
      creationToken: TOKEN,
      fetch: doFetch,
      createProvider: fakeCreateProvider(rec),
    };
    const pending = expectRetryablePending(await shareDraftSession(input));

    // A duplicate compatible caller receives the SAME pending object.
    expect(await shareDraftSession(input)).toBe(pending);

    // A successful retry memoizes ONE connected result…
    const connected = await pending.retryConnect();
    expect(connected.status).toBe("connected");
    // …returned again (same object) for every subsequent retry…
    expect(await pending.retryConnect()).toBe(connected);
    // …while the original pending object is unchanged (never mutated in place)…
    expect(pending.status).toBe("connection-pending");
    expect(pending.retryable).toBe(true);
    // …and a duplicate share call STILL returns the original pending object.
    expect(await shareDraftSession(input)).toBe(pending);

    // No duplicate POST / provider throughout.
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(2); // one failed + one successful
    connected.controller.dispose();
  });
});

describe("shareDraftSession — duplicate / concurrent", () => {
  const baseInput = (over: Record<string, unknown>) => ({
    title: "t",
    language: "typescript" as const,
    creationToken: TOKEN,
    ...over,
  });

  it("de-duplicates reference-compatible concurrent calls to the same promise", async () => {
    const session = freshSession();
    const rec = mkRecord();
    let resolveFetch!: (r: Response) => void;
    const doFetch = vi.fn(() => new Promise<Response>((r) => (resolveFetch = r)));
    const input = { session, ...baseInput({ fetch: doFetch, createProvider: fakeCreateProvider(rec) }) };

    const p1 = shareDraftSession(input);
    const p2 = shareDraftSession(input);
    expect(p1).toBe(p2); // same in-flight promise

    resolveFetch(jsonResponse(201, RECEIPT));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(1);
    r1.controller.dispose();
  });

  it("returns the same settled result to a duplicate call after connected success", async () => {
    const session = freshSession();
    const rec = mkRecord();
    const input = {
      session,
      ...baseInput({
        fetch: async () => jsonResponse(201, RECEIPT),
        createProvider: fakeCreateProvider(rec),
      }),
    };
    const first = await shareDraftSession(input);
    const second = await shareDraftSession(input);
    expect(second).toBe(first);
    expect(rec.createCalls).toBe(1);
    first.controller.dispose();
  });

  it("returns the same connection-pending result to a duplicate call", async () => {
    const session = freshSession();
    const rec = mkRecord({ connectFailTimes: 1 });
    const input = {
      session,
      ...baseInput({
        fetch: async () => jsonResponse(201, RECEIPT),
        createProvider: fakeCreateProvider(rec),
      }),
    };
    const first = await shareDraftSession(input);
    expect(first.status).toBe("connection-pending");
    const second = await shareDraftSession(input);
    expect(second).toBe(first);
    (first as ShareConnectionPending).controller.dispose();
  });

  it.each([
    ["creationToken", { creationToken: TOKEN_B }],
    ["title", { title: "different" }],
    ["language", { language: "javascript" as const }],
  ])("rejects an incompatible concurrent call (%s) with no second POST/provider", async (_label, diff) => {
    const session = freshSession();
    const rec = mkRecord();
    let resolveFetch!: (r: Response) => void;
    const doFetch = vi.fn(() => new Promise<Response>((r) => (resolveFetch = r)));
    const createProvider = fakeCreateProvider(rec);
    const first = shareDraftSession({
      session,
      ...baseInput({ fetch: doFetch, createProvider }),
    });

    const err = await shareDraftSession({
      session,
      ...baseInput({ fetch: doFetch, createProvider, ...diff }),
    }).then(
      () => {
        throw new Error("expected conflict rejection");
      },
      (e) => e as ShareError,
    );
    expect(err.stage).toBe("conflict");
    expect(err.code).toBe(SHARE_ERROR_CODES.CONFLICT);
    // The conflicting call issued nothing of its own.
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(0);

    resolveFetch(jsonResponse(201, RECEIPT));
    const ok = await first;
    ok.controller.dispose();
  });

  // A never-constructed stub ctor: the conflicting call rejects before any
  // provider is built, so it is only ever compared by reference identity.
  const StubCtor = function StubCtor() {} as unknown as NonNullable<
    CreateSheetProviderOptions["WebsocketProviderCtor"]
  >;

  it.each([
    ["fetch", () => ({ fetch: vi.fn(async () => jsonResponse(201, RECEIPT)) })],
    ["createProvider", () => ({ createProvider: fakeCreateProvider(mkRecord()) })],
    ["serverUrl", () => ({ serverUrl: "ws://other/ws" })],
    ["onSync", () => ({ onSync: () => {} })],
    ["WebsocketProviderCtor", () => ({ WebsocketProviderCtor: StubCtor })],
    ["onStatus", () => ({ onStatus: () => {} })],
    ["onTerminal", () => ({ onTerminal: () => {} })],
  ])("rejects an incompatible concurrent call differing only in %s", async (_label, mk) => {
    const session = freshSession();
    const rec = mkRecord();
    let resolveFetch!: (r: Response) => void;
    const doFetch = vi.fn(() => new Promise<Response>((r) => (resolveFetch = r)));
    const createProvider = fakeCreateProvider(rec);
    const first = shareDraftSession({
      session,
      ...baseInput({ fetch: doFetch, createProvider }),
    });

    const err = await shareDraftSession({
      session,
      ...baseInput({ fetch: doFetch, createProvider, ...mk() }),
    }).then(
      () => {
        throw new Error("expected conflict rejection");
      },
      (e) => e as ShareError,
    );
    expect(err.stage).toBe("conflict");
    expect(err.code).toBe(SHARE_ERROR_CODES.CONFLICT);
    // The first attempt is still mid-fetch (pre-acknowledgement): no remote sheet
    // yet and the draft is still fully local.
    expect(err.remoteCreated).toBe(false);
    expect(err.localIntact).toBe(true);
    expect(err.sheetId).toBeUndefined();
    expect(err.receipt).toBeUndefined();
    // The conflicting call issued no POST and constructed no provider.
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(rec.createCalls).toBe(0);

    resolveFetch(jsonResponse(201, RECEIPT));
    const ok = await first;
    ok.controller.dispose();
  });

  it("allows exactly one new attempt after a pre-transfer failure (same compatible input)", async () => {
    const session = freshSession();
    const rec = mkRecord();
    const doFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse(201, RECEIPT));
    const input = {
      session,
      ...baseInput({ fetch: doFetch, createProvider: fakeCreateProvider(rec) }),
    };

    await expect(shareDraftSession(input)).rejects.toMatchObject({ stage: "http" });
    // In-flight state cleared → a fresh attempt proceeds (exactly one new POST).
    const result = await shareDraftSession(input);
    expect(result.sheetId).toBe(RECEIPT.sheetId);
    expect(doFetch).toHaveBeenCalledTimes(2);
    result.controller.dispose();
  });

  it("allows an incompatible attempt only after the failed entry is cleared", async () => {
    const session = freshSession();
    const rec = mkRecord();
    const doFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse(201, RECEIPT));
    const createProvider = fakeCreateProvider(rec);

    await expect(
      shareDraftSession({ session, ...baseInput({ fetch: doFetch, createProvider }) }),
    ).rejects.toMatchObject({ stage: "http" });

    // A DIFFERENT token now succeeds because the failed entry was cleared.
    const result = await shareDraftSession({
      session,
      ...baseInput({ fetch: doFetch, createProvider, creationToken: TOKEN_B }),
    });
    expect(result.status).toBe("connected");
    result.controller.dispose();
  });
});

describe("shareDraftSession — remote-created failure carries retry info", () => {
  it("provider construction failure exposes remoteCreated + receipt for a same-token retry", async () => {
    const session = freshSession();
    const rec = mkRecord({ throwOnCreate: true });
    const err = await shareDraftSession({
      session,
      title: "t",
      language: "javascript",
      creationToken: TOKEN,
      fetch: async () => jsonResponse(201, RECEIPT),
      createProvider: fakeCreateProvider(rec),
    }).then(
      () => {
        throw new Error("expected rejection");
      },
      (e) => e as ShareError,
    );
    expect(err.stage).toBe("provider");
    expect(err.remoteCreated).toBe(true);
    expect(err.sheetId).toBe(RECEIPT.sheetId);
    expect(err.receipt).toEqual(RECEIPT);
    // Draft is still local, so a same-token retry (idempotent 200 replay) is safe.
    expect(err.localIntact).toBe(true);
    expect(session.destroyed).toBe(false);

    // The pre-transfer failure cleared the per-session entry, so a same-session
    // retry with the SAME token (construction now succeeds against a 200 replay)
    // attaches cleanly to the exact same primitives.
    const rec2 = mkRecord();
    const ok = await shareDraftSession({
      session,
      title: "t",
      language: "javascript",
      creationToken: TOKEN,
      fetch: async () => jsonResponse(200, RECEIPT), // idempotent replay
      createProvider: fakeCreateProvider(rec2),
    });
    expect(ok.status).toBe("connected");
    expect(ok.sheetId).toBe(RECEIPT.sheetId);
    ok.controller.dispose();
  });
});
