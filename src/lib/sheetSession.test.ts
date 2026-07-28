import { afterEach, describe, expect, it, vi } from "vitest";
import { createDraftSession, type DraftSession } from "./draftSession";
import type {
  CreateSheetProviderOptions,
  SheetProviderHandle,
  TerminalResult,
} from "./providerFactory";
import type { SharedSessionController } from "./sharedSessionOwnership";
import {
  fetchSheetBootstrap,
  openSheetSession,
  parseBootstrap,
  type OpenSheetOutcome,
} from "./sheetSession";

const VALID_ID = "sheetHANDOFF0001"; // 16 base64url chars
const BOOT = {
  sheetId: VALID_ID,
  title: "notes",
  language: "typescript",
  schemaVersion: 0,
  serverRevision: 1,
  metadataRevision: 1,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

type ProviderRec = {
  createCalls: number;
  connectCalls: number;
  destroyCalls: number;
  lastOpts?: CreateSheetProviderOptions;
  throwOnCreate?: boolean;
  throwOnConnect?: boolean;
  throwOnDestroy?: boolean;
  /** When set, destroy() SYNCHRONOUSLY emits this terminal (reentrancy probe). */
  emitTerminalOnDestroy?: TerminalResult;
  /** Fired synchronously DURING construction (after recording), before returning. */
  onCreate?: (opts: CreateSheetProviderOptions) => void;
  onConnect?: (opts: CreateSheetProviderOptions) => void;
};
function mkRec(over: Partial<ProviderRec> = {}): ProviderRec {
  return { createCalls: 0, connectCalls: 0, destroyCalls: 0, ...over };
}
function fakeCreateProvider(rec: ProviderRec) {
  return (opts: CreateSheetProviderOptions): SheetProviderHandle => {
    rec.createCalls++;
    rec.lastOpts = opts;
    if (rec.throwOnCreate) throw new Error("provider construct failed");
    rec.onCreate?.(opts);
    let destroyed = false;
    return {
      connect() {
        rec.connectCalls++;
        if (rec.throwOnConnect) throw new Error("connect failed");
        rec.onConnect?.(opts);
      },
      destroy() {
        rec.destroyCalls++;
        destroyed = true;
        // Emit a terminal SYNCHRONOUSLY from within disposal (as a real provider
        // can), to probe that cleanup cannot recurse or change the latched outcome.
        if (rec.emitTerminalOnDestroy) opts.onTerminal?.(rec.emitTerminalOnDestroy);
        if (rec.throwOnDestroy) throw new Error("destroy failed");
      },
      get destroyed() {
        return destroyed;
      },
    };
  };
}

// Track sessions created through the injected factory so leftover ones are
// disposed and readiness/teardown can be asserted.
const created: DraftSession[] = [];
const trackedCreateSession = () => {
  const s = createDraftSession();
  created.push(s);
  return s;
};
const readyControllers: OpenSheetOutcome[] = [];

afterEach(() => {
  for (const o of readyControllers.splice(0)) {
    if (o.status === "ready") o.controller.dispose();
  }
  while (created.length) created.pop()!.disposeUnlessTransferred();
  vi.restoreAllMocks();
});

function run(
  over: Partial<Parameters<typeof openSheetSession>[0]> & { rec?: ProviderRec } = {},
) {
  const rec = over.rec ?? mkRec();
  const doFetch =
    over.fetch ?? (vi.fn(async () => jsonResponse(200, BOOT)) as unknown as typeof fetch);
  return openSheetSession({
    sheetId: VALID_ID,
    fetch: doFetch,
    createSession: trackedCreateSession,
    createProvider: fakeCreateProvider(rec),
    ...over,
  }).then((o) => {
    if (o.status === "ready") readyControllers.push(o);
    return { outcome: o, rec, doFetch };
  });
}

describe("openSheetSession — bootstrap outcomes", () => {
  it("200 → constructs a session and provider AFTER bootstrap, connects once, publishes ready on first sync", async () => {
    const rec = mkRec({ onConnect: (opts) => opts.onSync?.(true) });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("unreachable");
    expect(outcome.bootstrap.sheetId).toBe(VALID_ID);
    expect(outcome.bootstrap.title).toBe("notes");
    expect(outcome.bootstrap.language).toBe("typescript");
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(1);
    // Provider attached to the fresh session's exact primitives.
    expect(rec.lastOpts?.doc).toBe(outcome.session.doc);
    expect(rec.lastOpts?.awareness).toBe(outcome.session.awareness);
    expect(outcome.controller.phase).toBe("shared");
  });

  it.each([
    [404, "unavailable"],
    [400, "unavailable"],
  ])("bootstrap %s → %s, constructs no session or provider", async (status, expected) => {
    const rec = mkRec();
    const { outcome } = await run({
      rec,
      fetch: (async () => jsonResponse(status, { error: "x" })) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe(expected);
    expect(rec.createCalls).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("bootstrap 500 → error, nothing constructed", async () => {
    const rec = mkRec();
    const { outcome } = await run({
      rec,
      fetch: (async () => jsonResponse(500, { error: "internal" })) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe("error");
    expect(rec.createCalls).toBe(0);
  });

  it("bootstrap network failure → error", async () => {
    const rec = mkRec();
    const { outcome } = await run({
      rec,
      fetch: (async () => {
        throw new TypeError("network down");
      }) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe("error");
    expect(rec.createCalls).toBe(0);
  });

  it("malformed 200 response → error", async () => {
    const rec = mkRec();
    const { outcome } = await run({
      rec,
      fetch: (async () => jsonResponse(200, { sheetId: "bad", title: 1 })) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe("error");
    expect(rec.createCalls).toBe(0);
  });
});

describe("openSheetSession — terminal handling", () => {
  it("terminal BEFORE first sync → stopped, disposes the unopened lifecycle", async () => {
    const rec = mkRec({
      onConnect: (opts) =>
        opts.onTerminal?.({ code: 4404, reason: "unavailable" } as TerminalResult),
    });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("stopped");
    expect(rec.destroyCalls).toBe(1); // provider destroyed via controller.dispose()
    expect(created[0]?.destroyed).toBe(true); // session destroyed too
  });

  it("terminal AFTER first sync → ready, then onStopped fires; lifecycle NOT auto-disposed", async () => {
    const onStopped = vi.fn();
    const rec = mkRec({ onConnect: (opts) => opts.onSync?.(true) });
    const { outcome } = await run({ rec, onStopped });
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("unreachable");
    // Deliver a terminal close after ready.
    rec.lastOpts?.onTerminal?.({ code: 4500, reason: "corrupt" } as TerminalResult);
    expect(onStopped).toHaveBeenCalledTimes(1);
    // Editor lifecycle retained: controller still shared, session alive.
    expect(outcome.controller.phase).toBe("shared");
    expect(outcome.session.destroyed).toBe(false);
  });
});

describe("openSheetSession — abort ownership", () => {
  it("abort BEFORE attachment (during bootstrap) → aborted, nothing constructed", async () => {
    const controllerAbort = new AbortController();
    let resolveFetch!: (r: Response) => void;
    const fetchP = new Promise<Response>((r) => (resolveFetch = r));
    const rec = mkRec();
    const p = run({
      rec,
      signal: controllerAbort.signal,
      fetch: (() => fetchP) as unknown as typeof fetch,
    });
    controllerAbort.abort();
    resolveFetch(jsonResponse(200, BOOT));
    const { outcome } = await p;
    expect(outcome.status).toBe("aborted");
    expect(rec.createCalls).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("abort AFTER attachment (before sync) → aborted, disposes through the controller", async () => {
    const ac = new AbortController();
    // connect() does not sync; we abort while waiting for first sync.
    const rec = mkRec({ onConnect: () => ac.abort() });
    const { outcome } = await run({ rec, signal: ac.signal });
    expect(outcome.status).toBe("aborted");
    expect(rec.destroyCalls).toBe(1); // controller.dispose() destroyed the provider
    expect(created[0]?.destroyed).toBe(true);
  });
});

describe("openSheetSession — pre-transfer construction failure", () => {
  it("provider construct throws → error, session destroyed (still local)", async () => {
    const rec = mkRec({ throwOnCreate: true });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("error");
    expect(created[0]?.destroyed).toBe(true);
    expect(rec.destroyCalls).toBe(0); // nothing to destroy — construction failed
  });

  it("session construction throws → error, nothing else built", async () => {
    const rec = mkRec();
    const outcome = await openSheetSession({
      sheetId: VALID_ID,
      fetch: (async () => jsonResponse(200, BOOT)) as unknown as typeof fetch,
      createSession: () => {
        throw new Error("session construct failed");
      },
      createProvider: fakeCreateProvider(rec),
    });
    expect(outcome.status).toBe("error");
    expect(rec.createCalls).toBe(0);
  });

  it("controller construction throws → error, session destroyed (still local)", async () => {
    const rec = mkRec();
    const { outcome } = await run({
      rec,
      createController: () => {
        throw new Error("controller construct failed");
      },
    });
    expect(outcome.status).toBe("error");
    expect(created[0]?.destroyed).toBe(true);
    expect(rec.createCalls).toBe(0);
  });

  it("attach throws → error, session destroyed (still local)", async () => {
    const rec = mkRec();
    const { outcome } = await run({
      rec,
      createController: () =>
        ({
          get phase() {
            return "local" as const;
          },
          attachAndTakeOwnership() {
            throw new Error("attach failed");
          },
          dispose() {},
        }) as unknown as SharedSessionController,
    });
    expect(outcome.status).toBe("error");
    expect(created[0]?.destroyed).toBe(true);
  });

  it("connect throws → error, disposed through the controller", async () => {
    const rec = mkRec({ throwOnConnect: true });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("error");
    expect(rec.connectCalls).toBe(1);
    expect(rec.destroyCalls).toBe(1); // controller.dispose() destroyed the provider
    expect(created[0]?.destroyed).toBe(true);
  });
});

describe("openSheetSession — callback interleavings (totalized, publish once)", () => {
  it("synchronous onSync during CONSTRUCTION → ready (never before connect)", async () => {
    const rec = mkRec({ onCreate: (opts) => opts.onSync?.(true) });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("ready");
    expect(rec.connectCalls).toBe(1); // connect() still ran before READY
  });

  it("synchronous onTerminal during CONSTRUCTION → stopped, disposed", async () => {
    const rec = mkRec({
      onCreate: (opts) =>
        opts.onTerminal?.({ code: 4404, reason: "unavailable" } as TerminalResult),
    });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("stopped");
    expect(rec.destroyCalls).toBe(1);
    expect(created[0]?.destroyed).toBe(true);
  });

  it("sync THEN terminal during connect → terminal wins (stopped)", async () => {
    const rec = mkRec({
      onConnect: (opts) => {
        opts.onSync?.(true);
        opts.onTerminal?.({ code: 4500, reason: "corrupt" } as TerminalResult);
      },
    });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("stopped");
    expect(rec.destroyCalls).toBe(1);
  });

  it("multiple onSync(true) publish ready exactly once", async () => {
    const onStopped = vi.fn();
    const rec = mkRec({
      onConnect: (opts) => {
        opts.onSync?.(true);
        opts.onSync?.(true);
        opts.onSync?.(true);
      },
    });
    const { outcome } = await run({ rec, onStopped });
    expect(outcome.status).toBe("ready");
    expect(onStopped).not.toHaveBeenCalled();
  });

  it("disposal throw during a pre-ready terminal is contained (still stopped)", async () => {
    const rec = mkRec({
      throwOnDestroy: true,
      onConnect: (opts) =>
        opts.onTerminal?.({ code: 4500, reason: "corrupt" } as TerminalResult),
    });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("stopped"); // disposal error never replaced the outcome
    expect(rec.destroyCalls).toBe(1);
  });

  it("abort → dispose → SYNCHRONOUS terminal: aborted stays aborted, disposed once, no recursion", async () => {
    const ac = new AbortController();
    // Abort AFTER ownership (during connect); disposal then emits a terminal.
    const rec = mkRec({
      onConnect: () => ac.abort(),
      emitTerminalOnDestroy: { code: 4500, reason: "corrupt" } as TerminalResult,
    });
    const { outcome } = await run({ rec, signal: ac.signal });
    expect(outcome.status).toBe("aborted"); // terminal during disposal did NOT flip it
    expect(rec.destroyCalls).toBe(1); // controller/provider disposed exactly once
  });

  it("stopped cleanup → dispose → terminal REENTRY: stopped stays stopped, disposed once", async () => {
    // A pre-ready terminal drives finishStopped; disposal then re-emits a terminal.
    const rec = mkRec({
      onConnect: (opts) => opts.onTerminal?.({ code: 4404, reason: "unavailable" } as TerminalResult),
      emitTerminalOnDestroy: { code: 4404, reason: "unavailable" } as TerminalResult,
    });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("stopped");
    expect(rec.destroyCalls).toBe(1); // no recursive re-dispose
    expect(created[0]?.destroyed).toBe(true);
  });

  it("a published READY controller can be disposed twice (idempotent stale cleanup)", async () => {
    const rec = mkRec({ onConnect: (opts) => opts.onSync?.(true) });
    const { outcome } = await run({ rec });
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("unreachable");
    // Splice out of the afterEach auto-dispose; drive disposal explicitly.
    readyControllers.length = 0;
    expect(() => {
      outcome.controller.dispose();
      outcome.controller.dispose();
    }).not.toThrow();
  });
});

describe("openSheetSession — abort totality", () => {
  it("passes the EXACT AbortSignal to fetch", async () => {
    const ac = new AbortController();
    const doFetch = vi.fn(async () => jsonResponse(200, BOOT)) as unknown as typeof fetch;
    const rec = mkRec({ onConnect: (opts) => opts.onSync?.(true) });
    await run({ rec, signal: ac.signal, fetch: doFetch });
    expect((doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({
      signal: ac.signal,
    });
  });

  it("aborted body read → aborted (not error)", async () => {
    const ac = new AbortController();
    const badBody = {
      ok: true,
      status: 200,
      json: async () => {
        ac.abort();
        throw new DOMException("aborted", "AbortError");
      },
    } as unknown as Response;
    const { outcome } = await run({
      signal: ac.signal,
      fetch: (async () => badBody) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe("aborted");
  });
});

describe("parseBootstrap — strict field validation", () => {
  const ID = "sheetHANDOFF0001";
  const good = {
    sheetId: ID,
    title: "notes",
    language: "typescript",
    schemaVersion: 0,
    serverRevision: 3,
    metadataRevision: 2,
  };

  it("accepts a fully valid payload and ignores extra fields", () => {
    expect(parseBootstrap({ ...good, extra: "x" }, ID)?.title).toBe("notes");
  });

  it.each([
    ["not an object", 42],
    ["array", [good]],
    ["missing sheetId", { ...good, sheetId: undefined }],
    ["sheetId mismatch (valid shape, wrong id)", { ...good, sheetId: "zzzzzzzzzzzzzzzz" }],
    ["non-string title", { ...good, title: 7 }],
    ["title over 200 code points", { ...good, title: "a".repeat(201) }],
    ["unsupported language (no plaintext fallback)", { ...good, language: "ruby" }],
    ["non-string language", { ...good, language: 3 }],
    ["schemaVersion not 0", { ...good, schemaVersion: 1 }],
    ["schemaVersion non-number", { ...good, schemaVersion: "0" }],
    ["serverRevision 0", { ...good, serverRevision: 0 }],
    ["serverRevision fractional", { ...good, serverRevision: 1.5 }],
    ["metadataRevision 0", { ...good, metadataRevision: 0 }],
    ["metadataRevision missing", { ...good, metadataRevision: undefined }],
  ])("rejects %s → null", (_label, body) => {
    expect(parseBootstrap(body, ID)).toBeNull();
  });

  it("accepts exactly 200 code points but rejects 201", () => {
    expect(parseBootstrap({ ...good, title: "a".repeat(200) }, ID)).not.toBeNull();
    expect(parseBootstrap({ ...good, title: "a".repeat(201) }, ID)).toBeNull();
  });
});

describe("openSheetSession — strict bootstrap maps corruption to error", () => {
  it.each([
    ["sheetId mismatch", { sheetId: "zzzzzzzzzzzzzzzz", title: "t", language: "typescript", schemaVersion: 0, serverRevision: 1, metadataRevision: 1 }],
    ["unsupported language", { ...BOOT, language: "ruby" }],
    ["schemaVersion 1", { ...BOOT, schemaVersion: 1 }],
    ["serverRevision 0", { ...BOOT, serverRevision: 0 }],
  ])("corrupt bootstrap (%s) → error, never unavailable", async (_label, body) => {
    const rec = mkRec();
    const { outcome } = await run({
      rec,
      fetch: (async () => jsonResponse(200, body)) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe("error");
    expect(rec.createCalls).toBe(0);
  });

  it("malformed JSON body → error", async () => {
    const badJson = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    } as unknown as Response;
    const { outcome } = await run({
      fetch: (async () => badJson) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe("error");
  });
});

describe("fetchSheetBootstrap — reconciliation helper (never rejects)", () => {
  it("returns strict bootstrap on a valid response", async () => {
    const boot = await fetchSheetBootstrap(VALID_ID, {
      fetch: (async () => jsonResponse(200, BOOT)) as unknown as typeof fetch,
    });
    expect(boot?.title).toBe("notes");
  });

  it("returns null on a network failure (no reject)", async () => {
    const boot = await fetchSheetBootstrap(VALID_ID, {
      fetch: (async () => {
        throw new TypeError("down");
      }) as unknown as typeof fetch,
    });
    expect(boot).toBeNull();
  });

  it("returns null on a corrupt payload", async () => {
    const boot = await fetchSheetBootstrap(VALID_ID, {
      fetch: (async () => jsonResponse(200, { ...BOOT, language: "ruby" })) as unknown as typeof fetch,
    });
    expect(boot).toBeNull();
  });
});
