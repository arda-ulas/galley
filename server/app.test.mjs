import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer as createNetServer } from "node:net";
import * as Y from "yjs";
import { createServerApplication, resolveConfig } from "./app.mjs";
import { PRODUCTION_DB_PATH } from "./persistence/db.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";

/** @type {Array<{ cleanup: () => Promise<void> }>} */
const temps = [];
async function tmp() {
  const t = await createTempDb();
  temps.push(t);
  return t;
}

/** Bind an ephemeral port, release it, and return the number — a real free port
 * a subsequent app can deterministically claim (and re-claim after shutdown). */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Pure teardown decision used by afterEach AND unit-tested directly. Suppresses
 * ONLY an explicitly-expected shutdown rejection; every other rejection, and any
 * resource left open, is a teardown failure.
 * @param {{ shutdownRejected: boolean, expected: boolean, dbClosed: boolean, addressNull: boolean }} r
 * @returns {string[]} problems (empty ⇒ clean)
 */
function teardownFailures({ shutdownRejected, expected, dbClosed, addressNull }) {
  const problems = [];
  if (shutdownRejected && !expected) problems.push("unexpected shutdown rejection");
  if (!dbClosed) problems.push("db not closed after teardown");
  if (!addressNull) problems.push("port still bound after teardown");
  return problems;
}

/** Apps whose shutdown() is expected to reject at least once (injected fault). */
const expectedShutdownFailure = new WeakSet();
function markExpectedShutdownFailure(app) {
  expectedShutdownFailure.add(app);
  return app;
}

/**
 * Every application created by a test is tracked here IMMEDIATELY on creation
 * (before any assertion), so teardown always closes it even if the test throws.
 */
const apps = [];
function track(app) {
  apps.push(app);
  return app;
}

afterEach(async () => {
  /** @type {Error[]} */
  const failures = [];
  while (apps.length) {
    const app = apps.pop();
    const expected = expectedShutdownFailure.has(app);
    let shutdownRejected = false;
    try {
      await app.shutdown();
    } catch {
      shutdownRejected = true;
    }
    // If cleanup was incomplete, retry once to finish releasing resources.
    if (shutdownRejected) {
      try {
        await app.shutdown();
      } catch {
        // Whether resources were released is decided by the invariants below.
      }
    }
    const problems = teardownFailures({
      shutdownRejected,
      expected,
      dbClosed: app.db.__test.state() === "closed",
      addressNull: app.address() === null,
    });
    for (const p of problems) failures.push(new Error(`${p} [state=${app.state}]`));
  }
  while (temps.length) await temps.pop().cleanup();
  if (failures.length) {
    throw new AggregateError(failures, "teardown found problems");
  }
});

/** Create one durable sheet directly through the persistence boundary so a
 * client can connect to its canonical `/ws/:sheetId` route. */
let wsTokenCounter = 0;
function createDurableSheet(app, sheetId, text = "live") {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  const canonicalUpdate = Y.encodeStateAsUpdate(doc);
  const canonicalStateVector = Y.encodeStateVector(doc);
  doc.destroy();
  app.db.createSheet({
    sheetId,
    creationToken: `ws-tok-${wsTokenCounter++}`,
    canonicalUpdate,
    canonicalStateVector,
    title: "t",
    language: "typescript",
    schemaVersion: 0,
    committedAt: 1,
  });
  return sheetId;
}

/** Build a test application bound to an ephemeral port and a temp database. */
function makeApp(t, extraEnv = {}, options = {}) {
  return createServerApplication(
    {
      ECHO_REWIND_TEST: "1",
      GALLEY_TEST_DB_PATH: t.dbPath,
      HOST: "127.0.0.1",
      PORT: "0",
      ...extraEnv,
    },
    options,
  );
}

describe("teardownFailures — pure teardown discipline", () => {
  it("passes a clean teardown", () => {
    expect(
      teardownFailures({ shutdownRejected: false, expected: false, dbClosed: true, addressNull: true }),
    ).toEqual([]);
  });

  it("fails an UNEXPECTED shutdown rejection", () => {
    expect(
      teardownFailures({ shutdownRejected: true, expected: false, dbClosed: true, addressNull: true }),
    ).toContain("unexpected shutdown rejection");
  });

  it("suppresses an EXPECTED shutdown rejection when resources are released", () => {
    expect(
      teardownFailures({ shutdownRejected: true, expected: true, dbClosed: true, addressNull: true }),
    ).toEqual([]);
  });

  it("still fails an expected rejection that left the DB open", () => {
    expect(
      teardownFailures({ shutdownRejected: true, expected: true, dbClosed: false, addressNull: true }),
    ).toContain("db not closed after teardown");
  });

  it("fails when a port is still bound", () => {
    expect(
      teardownFailures({ shutdownRejected: false, expected: false, dbClosed: true, addressNull: false }),
    ).toContain("port still bound after teardown");
  });
});

describe("resolveConfig — test-mode boundary", () => {
  it("uses the fixed production path in normal mode, ignoring GALLEY_TEST_DB_PATH", () => {
    const cfg = resolveConfig({ GALLEY_TEST_DB_PATH: "/tmp/should-be-ignored.db" });
    expect(cfg.testMode).toBe(false);
    expect(cfg.dbPath).toBe(PRODUCTION_DB_PATH);
  });

  it("requires GALLEY_TEST_DB_PATH under ECHO_REWIND_TEST=1", () => {
    expect(() => resolveConfig({ ECHO_REWIND_TEST: "1" })).toThrow(
      /GALLEY_TEST_DB_PATH/i,
    );
  });

  it("uses the provided test DB path under ECHO_REWIND_TEST=1", () => {
    const cfg = resolveConfig({
      ECHO_REWIND_TEST: "1",
      GALLEY_TEST_DB_PATH: "/tmp/explicit.db",
    });
    expect(cfg.testMode).toBe(true);
    expect(cfg.dbPath).toBe("/tmp/explicit.db");
  });

  it("defaults host/port and reads PORT", () => {
    const cfg = resolveConfig({ PORT: "4321" });
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(4321);
  });
});

describe("createServerApplication — start/stop lifecycle", () => {
  it("starts on an ephemeral port and reports its bound address", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await app.start();

    expect(app.state).toBe("running");
    const addr = app.address();
    expect(addr).not.toBeNull();
    expect(addr.port).toBeGreaterThan(0);
    expect(app.db.foreignKeys).toBe(1);
  });

  it("releases the port on shutdown (a new app can rebind it)", async () => {
    const t1 = await tmp();
    const first = track(await makeApp(t1));
    await first.start();
    const port = first.address().port;
    await first.shutdown();
    expect(first.state).toBe("stopped");

    const t2 = await tmp();
    const second = track(await makeApp(t2, { PORT: String(port) }));
    await second.start();
    expect(second.address().port).toBe(port);
  });

  it("has an idempotent shutdown that returns one shared promise", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await app.start();

    const p1 = app.shutdown();
    const p2 = app.shutdown();
    expect(p1).toBe(p2);
    await expect(p1).resolves.toBeUndefined();
    expect(app.shutdown()).toBe(p1); // still the same settled promise
  });

  it("leaves teardown to close a running app the test never shuts down", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await app.start();
    // Intentionally no shutdown() here: afterEach must close it AND verify the
    // DB ends up closed, or the suite fails.
    expect(app.state).toBe("running");
  });
});

describe("createServerApplication — shutdown/start coordination", () => {
  it("shutdown before start closes the DB and resolves cleanly", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await expect(app.shutdown()).resolves.toBeUndefined();
    expect(app.state).toBe("stopped");
    expect(app.db.__test.state()).toBe("closed");
    expect(app.address()).toBeNull();
  });

  it("start after shutdown rejects cleanly with no port bound", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await app.shutdown();
    await expect(app.start()).rejects.toThrow(/cannot start/i);
    expect(app.address()).toBeNull();
    expect(app.db.__test.state()).toBe("closed");
  });

  it("shutdown requested during a pending start closes the bound port before resolving", async () => {
    const port = await freePort();
    const t = await tmp();
    let releaseGate;
    const gate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    const app = track(
      await makeApp(t, { PORT: String(port) }, { hooks: { beforeListen: () => gate } }),
    );

    const startP = app.start();
    expect(app.state).toBe("starting");
    const shutdownP = app.shutdown();
    // Attach the rejection expectation before releasing the gate so the aborted
    // start is never an unhandled rejection.
    const startAssert = expect(startP).rejects.toThrow(/aborted by shutdown/i);

    releaseGate(); // let the listen proceed AND bind the port
    await expect(shutdownP).resolves.toBeUndefined();
    await startAssert;

    // shutdown must never resolve while a port is still bound.
    expect(app.state).toBe("stopped");
    expect(app.address()).toBeNull();
    expect(app.db.__test.state()).toBe("closed");

    // The port the race bound-then-closed is free to rebind.
    const t2 = await tmp();
    const rebound = track(await makeApp(t2, { PORT: String(port) }));
    await rebound.start();
    expect(rebound.address().port).toBe(port);
  });

  it("closes the DB when listen fails, and shutdown stays safe/idempotent", async () => {
    const t1 = await tmp();
    const first = track(await makeApp(t1));
    await first.start();
    const port = first.address().port;

    const t2 = await tmp();
    const second = track(await makeApp(t2, { PORT: String(port) }));
    await expect(second.start()).rejects.toThrow(); // EADDRINUSE
    expect(second.db.__test.state()).toBe("closed");

    const p1 = second.shutdown();
    const p2 = second.shutdown();
    expect(p1).toBe(p2);
    await expect(p1).resolves.toBeUndefined();
  });

  it("rejects (binding no port) when the database fails to open", async () => {
    const t = await tmp();
    await expect(
      makeApp(t, {}, { dbFaults: { open: true } }),
    ).rejects.toThrow(/injected open/i);
    // Nothing was constructed, so there is no app to track/teardown.
  });
});

describe("createServerApplication — cleanup failure and retry", () => {
  it("retries after a db-close failure and completes on the second shutdown", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await app.start();

    // One injected db-close failure: first shutdown must reject but still have
    // closed HTTP/WS, leaving the DB retryable.
    app.db.__test.failNextClose();
    await expect(app.shutdown()).rejects.toThrow(/cleanup failed/i);
    expect(app.state).toBe("cleanup_failed");
    expect(app.address()).toBeNull();
    expect(app.db.__test.state()).not.toBe("closed");

    // Second shutdown retries only the unfinished step (db close) and completes.
    const p2 = app.shutdown();
    await expect(p2).resolves.toBeUndefined();
    expect(app.db.__test.state()).toBe("closed");
    expect(app.state).toBe("stopped");

    // A third shutdown returns the settled successful promise for the stop.
    const p3 = app.shutdown();
    expect(p3).toBe(p2);
    await expect(p3).resolves.toBeUndefined();
  });

  it("keeps the DB close on an intermediate wss-close failure (expected teardown failure)", async () => {
    const t = await tmp();
    const app = markExpectedShutdownFailure(
      track(await makeApp(t, {}, { faults: { closeWss: true } })),
    );
    await app.start();

    // The wss-close step fails, but the pipeline must still reach db.close().
    await expect(app.shutdown()).rejects.toThrow(/cleanup failed/i);
    expect(app.db.__test.state()).toBe("closed");
    expect(app.address()).toBeNull();
    // The permanent fault keeps shutdown() rejecting; afterEach recognizes this
    // as the marked, expected failure and verifies resources are released.
  });
});

describe("createServerApplication — room disposal", () => {
  it("creates a fresh room with empty content (no starter seeding)", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    const room = app.getRoom("fresh");
    expect(room.doc.getText("content").toString()).toBe("");
  });

  it("reset does not recreate starter content — a rebuilt room is still empty", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await app.start();
    app.getRoom("demo"); // create a live in-memory room

    const res = await fetch(
      `http://127.0.0.1:${app.address().port}/__test/reset`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(app.rooms.size).toBe(0); // live room state cleared

    // A room recreated after reset carries no starter content.
    const rebuilt = app.getRoom("demo");
    expect(rebuilt.doc.getText("content").toString()).toBe("");
  });

  it("destroys room Awareness and Y.Doc on reset (not just clears the map)", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await app.start();

    const room = app.getRoom("demo");
    let docDestroyed = false;
    let awarenessDestroyed = false;
    room.doc.once("destroy", () => {
      docDestroyed = true;
    });
    room.awareness.once("destroy", () => {
      awarenessDestroyed = true;
    });

    const res = await fetch(
      `http://127.0.0.1:${app.address().port}/__test/reset`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");

    expect(docDestroyed).toBe(true);
    expect(awarenessDestroyed).toBe(true);
    expect(app.rooms.size).toBe(0);
  });

  it("destroys room Awareness and Y.Doc on shutdown", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await app.start();

    const room = app.getRoom("demo");
    let docDestroyed = false;
    let awarenessDestroyed = false;
    room.doc.once("destroy", () => {
      docDestroyed = true;
    });
    room.awareness.once("destroy", () => {
      awarenessDestroyed = true;
    });

    await app.shutdown();

    expect(docDestroyed).toBe(true);
    expect(awarenessDestroyed).toBe(true);
    expect(app.rooms.size).toBe(0);
  });

  it("terminates live WebSocket clients and shuts down without hanging", async () => {
    const t = await tmp();
    const app = track(await makeApp(t));
    await app.start();
    const port = app.address().port;
    const sheetId = createDurableSheet(app, "sheetLIVE0000001");

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${sheetId}`);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    expect(app.wss.clients.size).toBe(1);

    const clientClosed = new Promise((resolve) => ws.once("close", resolve));
    await app.shutdown();
    await clientClosed;
    expect(app.wss.clients.size).toBe(0);
  });
});
