import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { createDraftSession } from "./draftSession";
import { installWebSocketSpy } from "../test/websocketProbe";
import {
  classifyCloseCode,
  createSheetProvider,
  type CreateSheetProviderOptions,
  type ProviderCtor,
  type ProviderLike,
} from "./providerFactory";
import { createSharedSessionController } from "./sharedSessionOwnership";

/**
 * A faithful, socket-free stand-in for the y-websocket provider. It implements
 * exactly the narrowed `ProviderLike` surface (connect/destroy/on/off) plus
 * test-only drivers. `destroy()` → `disconnect()` sets `shouldConnect = false`,
 * mirroring the real provider, and `attemptScheduledReconnect()` models
 * y-websocket's scheduled `setupWS`, which reconnects only while `shouldConnect`.
 */
class FakeProvider implements ProviderLike {
  readonly ctorArgs: {
    serverUrl: string;
    roomname: string;
    doc: Y.Doc;
    opts: { connect: boolean; awareness: Awareness; disableBc: boolean };
  };
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  shouldConnect: boolean;
  connectCalls = 0;
  destroyCalls = 0;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(
    serverUrl: string,
    roomname: string,
    doc: Y.Doc,
    opts: { connect: boolean; awareness: Awareness; disableBc: boolean },
  ) {
    this.ctorArgs = { serverUrl, roomname, doc, opts };
    this.doc = doc;
    this.awareness = opts.awareness;
    this.shouldConnect = opts.connect;
  }

  on(name: string, fn: (...args: unknown[]) => void): void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(fn);
  }
  off(name: string, fn: (...args: unknown[]) => void): void {
    this.listeners.get(name)?.delete(fn);
  }
  connect(): void {
    this.connectCalls++;
    this.shouldConnect = true;
  }
  disconnect(): void {
    this.shouldConnect = false;
  }
  destroy(): void {
    this.destroyCalls++;
    this.disconnect(); // mirrors real provider.destroy() → disconnect()
  }

  // --- test drivers -------------------------------------------------------
  private emit(name: string, args: unknown[]): void {
    for (const fn of [...(this.listeners.get(name) ?? [])]) fn(...args);
  }
  simulateClose(code: number | null): void {
    this.emit("connection-close", [code == null ? null : { code }, this]);
  }
  simulateStatus(status: "connected" | "connecting" | "disconnected"): void {
    this.emit("status", [{ status }]);
  }
  simulateSync(state: boolean): void {
    this.emit("sync", [state]);
  }
  listenerCount(name: string): number {
    return this.listeners.get(name)?.size ?? 0;
  }
  attemptScheduledReconnect(): void {
    if (this.shouldConnect) this.connect();
  }
}

// Options a test supplies; the fixed fields (sheetId/serverUrl/ctor) are owned
// by the helper so they can never be double-specified via spread. doc +
// awareness stay REQUIRED (as in createSheetProvider); callbacks stay optional.
type ProviderTestOverrides = Omit<
  CreateSheetProviderOptions,
  "sheetId" | "serverUrl" | "WebsocketProviderCtor"
>;

/** Build a wrapper over a captured FakeProvider, given explicit options. */
function buildProvider(opts: ProviderTestOverrides) {
  let fake!: FakeProvider;
  const Ctor = function (
    this: unknown,
    serverUrl: string,
    roomname: string,
    d: Y.Doc,
    o: { connect: boolean; awareness: Awareness; disableBc: boolean },
  ) {
    fake = new FakeProvider(serverUrl, roomname, d, o);
    return fake;
  } as unknown as ProviderCtor;

  const handle = createSheetProvider({
    sheetId: "sheet0000000001",
    serverUrl: "ws://test.invalid/ws",
    WebsocketProviderCtor: Ctor,
    ...opts,
  });
  // The injected fake is captured through the constructor closure — never
  // through the public handle (which intentionally exposes no provider).
  return {
    handle,
    get fake() {
      return fake;
    },
  };
}

/** Convenience: a wrapper with its own doc + awareness. */
function withFake(overrides: Omit<ProviderTestOverrides, "doc" | "awareness"> = {}) {
  const doc = new Y.Doc();
  doc.getText("content");
  const awareness = new Awareness(doc);
  const built = buildProvider({ doc, awareness, ...overrides });
  return { doc, awareness, ...built };
}

const flush = () => Promise.resolve();

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

describe("classifyCloseCode", () => {
  it("classifies terminal codes", () => {
    expect(classifyCloseCode(4400)).toBe("protocol");
    expect(classifyCloseCode(4404)).toBe("unavailable");
    expect(classifyCloseCode(4409)).toBe("too-large");
    expect(classifyCloseCode(4500)).toBe("corrupt");
  });
  it("treats 1011 and ordinary drops as retryable (undefined)", () => {
    expect(classifyCloseCode(1011)).toBeUndefined();
    expect(classifyCloseCode(1006)).toBeUndefined();
    expect(classifyCloseCode(1000)).toBeUndefined();
    expect(classifyCloseCode(undefined)).toBeUndefined();
  });
});

describe("createSheetProvider — construction", () => {
  it("attaches to the exact supplied doc + awareness with the exact opts", () => {
    const { doc, awareness, handle, fake } = withFake();
    cleanups.push(() => handle.destroy());
    expect(fake.ctorArgs.doc).toBe(doc);
    expect(fake.ctorArgs.opts.awareness).toBe(awareness);
    expect(fake.ctorArgs.opts.connect).toBe(false);
    expect(fake.ctorArgs.opts.disableBc).toBe(true);
    expect(fake.ctorArgs.roomname).toBe("sheet0000000001");
  });

  it("reconstructs no collaboration primitives (same doc + awareness identity)", () => {
    const { doc, awareness, handle, fake } = withFake();
    cleanups.push(() => handle.destroy());
    expect(fake.doc).toBe(doc);
    expect(fake.awareness).toBe(awareness);
    expect(awareness.doc).toBe(doc);
    expect(awareness.clientID).toBe(doc.clientID);
  });

  it("does not expose the underlying provider on the handle", () => {
    const { handle } = withFake();
    cleanups.push(() => handle.destroy());
    expect((handle as Record<string, unknown>).provider).toBeUndefined();
    expect(Object.keys(handle).sort()).toEqual(["connect", "destroy", "destroyed"]);
  });

  it("does not connect on construction; connect() is explicit", () => {
    const { handle, fake } = withFake();
    cleanups.push(() => handle.destroy());
    expect(fake.connectCalls).toBe(0);
    expect(fake.shouldConnect).toBe(false);
    handle.connect();
    expect(fake.connectCalls).toBe(1);
    expect(fake.shouldConnect).toBe(true);
  });

  it("opens no real WebSocket during import/construction", () => {
    const spy = installWebSocketSpy();
    try {
      const { handle } = withFake();
      handle.destroy();
      expect(spy.count).toBe(0);
    } finally {
      spy.restore();
    }
  });
});

describe("createSheetProvider — status/sync passthrough", () => {
  it("forwards status and sync, then stops after destroy", () => {
    const onStatus = vi.fn();
    const onSync = vi.fn();
    const { handle, fake } = withFake({ onStatus, onSync });
    fake.simulateStatus("connecting");
    fake.simulateSync(true);
    expect(onStatus).toHaveBeenCalledWith("connecting");
    expect(onSync).toHaveBeenCalledWith(true);

    handle.destroy();
    fake.simulateStatus("disconnected");
    fake.simulateSync(false);
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});

describe("createSheetProvider — manual destroy", () => {
  it("destroys the underlying provider exactly once and detaches listeners", () => {
    const { handle, fake } = withFake();
    expect(fake.listenerCount("connection-close")).toBe(1);
    handle.destroy();
    handle.destroy();
    handle.destroy();
    expect(fake.destroyCalls).toBe(1);
    expect(handle.destroyed).toBe(true);
    expect(fake.listenerCount("connection-close")).toBe(0);
    expect(fake.listenerCount("status")).toBe(0);
    expect(fake.listenerCount("sync")).toBe(0);
  });

  it("connect() after destroy is a no-op", () => {
    const { handle, fake } = withFake();
    handle.destroy();
    handle.connect();
    expect(fake.connectCalls).toBe(0);
  });
});

describe("createSheetProvider — terminal latch suppresses later lifecycle events", () => {
  it("only the terminal result escapes: trailing sync(false)/status(disconnected) are suppressed", async () => {
    const onStatus = vi.fn();
    const onSync = vi.fn();
    const onTerminal = vi.fn();
    const { handle, fake } = withFake({ onStatus, onSync, onTerminal });
    handle.connect();

    // Real y-websocket terminal sequence: connecting → connected →
    // connection-close → sync(false) → status(disconnected).
    fake.simulateStatus("connecting");
    fake.simulateStatus("connected");
    fake.simulateClose(4404); // latch (synchronous)
    fake.simulateSync(false); // must be suppressed
    fake.simulateStatus("disconnected"); // must be suppressed

    // Synchronously: only the pre-latch statuses were forwarded; teardown and
    // the terminal notification are deferred to a microtask.
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual(["connecting", "connected"]);
    expect(onSync).not.toHaveBeenCalled();
    expect(onTerminal).not.toHaveBeenCalled();
    expect(fake.destroyCalls).toBe(0);

    await flush();
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledWith({ code: 4404, reason: "unavailable" });
    // Still no routine disconnected/sync overwrote the terminal state.
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual(["connecting", "connected"]);
    expect(onSync).not.toHaveBeenCalled();
  });
});

describe("createSheetProvider — terminal close policy (deferred, ordered)", () => {
  for (const [code, reason] of [
    [4400, "protocol"],
    [4404, "unavailable"],
    [4409, "too-large"],
    [4500, "corrupt"],
  ] as const) {
    it(`terminal ${code}: latches synchronously, tears down then notifies on a microtask`, async () => {
      const onTerminal = vi.fn();
      const { handle, fake } = withFake({ onTerminal });
      handle.connect();

      fake.simulateClose(code);
      // Synchronous: neither teardown nor consumer callback runs in the close stack.
      expect(fake.destroyCalls).toBe(0);
      expect(onTerminal).not.toHaveBeenCalled();
      expect(handle.destroyed).toBe(false);

      await flush();
      expect(fake.destroyCalls).toBe(1);
      expect(onTerminal).toHaveBeenCalledWith({ code, reason });
      expect(handle.destroyed).toBe(true);
      // A reconnect y-websocket had already scheduled now sees shouldConnect=false.
      expect(fake.shouldConnect).toBe(false);
      fake.attemptScheduledReconnect();
      expect(fake.connectCalls).toBe(1); // only the explicit connect() above
    });
  }

  it("destroys the provider BEFORE invoking onTerminal", async () => {
    const order: string[] = [];
    const { handle, fake } = withFake({
      onTerminal: () => order.push("onTerminal"),
    });
    // Observe provider destruction order via the fake.
    const realDestroy = fake.destroy.bind(fake);
    fake.destroy = () => {
      order.push("provider.destroy");
      realDestroy();
    };
    handle.connect();
    fake.simulateClose(4404);
    await flush();
    expect(order).toEqual(["provider.destroy", "onTerminal"]);
  });

  it("retryable 1011: no terminal, no destroy; provider may reconnect", async () => {
    const onTerminal = vi.fn();
    const { handle, fake } = withFake({ onTerminal });
    handle.connect();
    fake.simulateClose(1011);
    await flush();
    expect(onTerminal).not.toHaveBeenCalled();
    expect(fake.destroyCalls).toBe(0);
    expect(handle.destroyed).toBe(false);
    expect(fake.shouldConnect).toBe(true);
    fake.attemptScheduledReconnect();
    expect(fake.connectCalls).toBe(2);
  });

  it("ordinary transport drop (1006): retryable, not terminal", async () => {
    const onTerminal = vi.fn();
    const { handle, fake } = withFake({ onTerminal });
    handle.connect();
    fake.simulateClose(1006);
    await flush();
    expect(onTerminal).not.toHaveBeenCalled();
    expect(handle.destroyed).toBe(false);
    expect(fake.shouldConnect).toBe(true);
  });

  it("duplicate terminal events notify once and destroy once", async () => {
    const onTerminal = vi.fn();
    const { handle, fake } = withFake({ onTerminal });
    handle.connect();
    fake.simulateClose(4404);
    fake.simulateClose(4404); // duplicate, same tick
    fake.simulateClose(4500); // different terminal code, same tick
    await flush();
    await flush();
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledWith({ code: 4404, reason: "unavailable" });
    expect(fake.destroyCalls).toBe(1);
  });

  it("manual destroy racing the queued terminal teardown does not double-destroy", async () => {
    const onTerminal = vi.fn();
    const { handle, fake } = withFake({ onTerminal });
    handle.connect();
    fake.simulateClose(4404); // schedules microtask teardown
    handle.destroy(); // manual teardown wins synchronously
    expect(fake.destroyCalls).toBe(1);
    await flush(); // queued teardown must not destroy again
    expect(fake.destroyCalls).toBe(1);
    // The recognized terminal is still reported exactly once (after teardown).
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it("completes teardown and reports (does not swallow) when onTerminal throws", async () => {
    const boom = new Error("consumer failure");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handle, fake } = withFake({
      onTerminal: () => {
        throw boom;
      },
    });
    handle.connect();
    fake.simulateClose(4404);
    await flush();
    // Teardown still completed despite the throwing callback…
    expect(fake.destroyCalls).toBe(1);
    expect(handle.destroyed).toBe(true);
    // …and the error was reported, not silently swallowed.
    expect(consoleError).toHaveBeenCalledWith(
      "sheet provider onTerminal callback threw:",
      boom,
    );
  });

  it("tolerates onTerminal synchronously disposing the owning controller", async () => {
    const session = createDraftSession();
    let controller!: ReturnType<typeof createSharedSessionController>;
    const { handle, fake } = buildProvider({
      doc: session.doc,
      awareness: session.awareness,
      onTerminal: () => controller.dispose(), // consumer disposes from the callback
    });
    controller = createSharedSessionController(session);
    controller.attachAndTakeOwnership(() => handle);

    handle.connect();
    fake.simulateClose(4404);
    // Must not throw or re-enter the close stack (we are on a microtask).
    await flush();
    await flush();
    expect(fake.destroyCalls).toBe(1);
    expect(session.destroyed).toBe(true);
    expect(controller.phase).toBe("disposed");
  });
});
