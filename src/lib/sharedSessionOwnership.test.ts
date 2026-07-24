import { describe, expect, it, vi } from "vitest";
import { createDraftSession } from "./draftSession";
import type { SheetProviderHandle } from "./providerFactory";
import { createSharedSessionController } from "./sharedSessionOwnership";

/** A minimal provider handle recording destruction into a shared order log. */
function fakeHandle(
  log: string[],
  opts: { throwOnDestroy?: boolean } = {},
): SheetProviderHandle & { destroyCalls: number } {
  let destroyed = false;
  let destroyCalls = 0;
  return {
    connect() {},
    destroy() {
      destroyCalls++;
      log.push("provider.destroy");
      if (opts.throwOnDestroy) throw new Error("provider destroy failed");
      destroyed = true;
    },
    get destroyed() {
      return destroyed;
    },
    get destroyCalls() {
      return destroyCalls;
    },
  };
}

describe("createSharedSessionController — atomic attach + ownership transfer", () => {
  it("transfers ownership synchronously on attach and tears down provider THEN session", () => {
    const log: string[] = [];
    const session = createDraftSession();
    const transfer = vi.spyOn(session, "transferOwnership");
    vi.spyOn(session, "destroy").mockImplementation(() => {
      log.push("session.destroy");
    });
    const controller = createSharedSessionController(session);
    const handle = fakeHandle(log);

    expect(controller.phase).toBe("local");
    const returned = controller.attachAndTakeOwnership(() => handle);
    expect(returned).toBe(handle);
    expect(controller.phase).toBe("shared");
    expect(transfer).toHaveBeenCalledTimes(1); // transfer happened AT attach

    controller.dispose();
    expect(controller.phase).toBe("disposed");
    expect(log).toEqual(["provider.destroy", "session.destroy"]);
  });

  it("INVERSE-ORDER regression: local disposeUnlessTransferred after attach is harmless", () => {
    const log: string[] = [];
    const session = createDraftSession();
    const controller = createSharedSessionController(session);
    const handle = fakeHandle(log);

    controller.attachAndTakeOwnership(() => handle);
    // Local React cleanup fires (in any order); it must NOT destroy the session
    // because ownership already transferred synchronously at attach.
    session.disposeUnlessTransferred();
    expect(session.destroyed).toBe(false);

    controller.dispose();
    expect(handle.destroyed).toBe(true);
    expect(session.destroyed).toBe(true);
    expect(log).toEqual(["provider.destroy"]); // then real session.destroy ran
  });

  it("dispose is idempotent after a successful transfer", () => {
    const log: string[] = [];
    const session = createDraftSession();
    const controller = createSharedSessionController(session);
    const handle = fakeHandle(log);
    controller.attachAndTakeOwnership(() => handle);
    controller.dispose();
    controller.dispose();
    expect(handle.destroyCalls).toBe(1);
    expect(session.destroyed).toBe(true);
  });
});

describe("createSharedSessionController — construction failure", () => {
  it("does not transfer ownership; session stays locally owned", () => {
    const session = createDraftSession();
    const transfer = vi.spyOn(session, "transferOwnership");
    const controller = createSharedSessionController(session);

    expect(() =>
      controller.attachAndTakeOwnership(() => {
        throw new Error("provider construction failed");
      }),
    ).toThrow("provider construction failed");

    expect(controller.phase).toBe("local");
    expect(transfer).not.toHaveBeenCalled();

    // The local owner still owns the session: disposeUnlessTransferred destroys it.
    expect(session.destroyed).toBe(false);
    session.disposeUnlessTransferred();
    expect(session.destroyed).toBe(true);
  });

  it("interruption before successful construction leaves no provider and local ownership", () => {
    const session = createDraftSession();
    const controller = createSharedSessionController(session);
    // Dispose from the local phase (no provider ever constructed).
    controller.dispose();
    expect(controller.phase).toBe("disposed");
    expect(session.destroyed).toBe(false);
    session.disposeUnlessTransferred();
    expect(session.destroyed).toBe(true);
  });
});

describe("createSharedSessionController — transfer failure", () => {
  it("destroys the just-built provider and settles disposed if transferOwnership throws", () => {
    const log: string[] = [];
    const session = createDraftSession();
    vi.spyOn(session, "transferOwnership").mockImplementation(() => {
      throw new Error("transfer failed");
    });
    const controller = createSharedSessionController(session);
    const handle = fakeHandle(log);

    expect(() => controller.attachAndTakeOwnership(() => handle)).toThrow(
      "transfer failed",
    );
    expect(controller.phase).toBe("disposed"); // never a false "shared"
    expect(handle.destroyed).toBe(true); // provider cleaned up
    expect(log).toEqual(["provider.destroy"]);
  });
});

describe("createSharedSessionController — failure-safe teardown", () => {
  it("attempts session.destroy() even when provider.destroy() throws, in order", () => {
    const log: string[] = [];
    const session = createDraftSession();
    const sessionDestroy = vi.spyOn(session, "destroy").mockImplementation(() => {
      log.push("session.destroy");
    });
    const controller = createSharedSessionController(session);
    const handle = fakeHandle(log, { throwOnDestroy: true });

    controller.attachAndTakeOwnership(() => handle);
    expect(() => controller.dispose()).toThrow("provider destroy failed");
    // Both attempted, provider first; the error surfaced (not swallowed).
    expect(log).toEqual(["provider.destroy", "session.destroy"]);
    expect(sessionDestroy).toHaveBeenCalledTimes(1);
    expect(controller.phase).toBe("disposed");
  });

  it("aggregates when BOTH provider and session destruction throw", () => {
    const log: string[] = [];
    const session = createDraftSession();
    vi.spyOn(session, "destroy").mockImplementation(() => {
      log.push("session.destroy");
      throw new Error("session destroy failed");
    });
    const controller = createSharedSessionController(session);
    const handle = fakeHandle(log, { throwOnDestroy: true });

    controller.attachAndTakeOwnership(() => handle);
    let caught: unknown;
    try {
      controller.dispose();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toHaveLength(2);
    expect(log).toEqual(["provider.destroy", "session.destroy"]);
    expect(controller.phase).toBe("disposed");
  });

  it("retrying dispose after a throwing dispose does not double-destroy", () => {
    const log: string[] = [];
    const session = createDraftSession();
    vi.spyOn(session, "destroy").mockImplementation(() => {
      log.push("session.destroy");
    });
    const controller = createSharedSessionController(session);
    const handle = fakeHandle(log, { throwOnDestroy: true });
    controller.attachAndTakeOwnership(() => handle);
    expect(() => controller.dispose()).toThrow();
    // Second dispose is a no-op — phase is already disposed.
    controller.dispose();
    expect(handle.destroyCalls).toBe(1);
    expect(log).toEqual(["provider.destroy", "session.destroy"]);
  });
});

describe("createSharedSessionController — guards", () => {
  it("rejects attach after ownership already taken", () => {
    const session = createDraftSession();
    const controller = createSharedSessionController(session);
    controller.attachAndTakeOwnership(() => fakeHandle([]));
    expect(() => controller.attachAndTakeOwnership(() => fakeHandle([]))).toThrow(
      /cannot attach from "shared"/,
    );
    controller.dispose();
  });
});
