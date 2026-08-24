import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import { createServerApplication } from "./app.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";

/** @type {Array<{ cleanup: () => Promise<void> }>} */
const temps = [];
const apps = [];
afterEach(async () => {
  while (apps.length) {
    try {
      await apps.pop().shutdown();
    } catch {
      // ignore
    }
  }
  while (temps.length) await temps.pop().cleanup();
});

async function startApp() {
  const t = await createTempDb();
  temps.push(t);
  const app = await createServerApplication({
    ECHO_REWIND_TEST: "1",
    GALLEY_TEST_DB_PATH: t.dbPath,
    HOST: "127.0.0.1",
    PORT: "0",
  });
  await app.start();
  apps.push(app);
  return { app, port: app.address().port, dbPath: t.dbPath };
}

let tokenCounter = 0;
function createSheet(app, sheetId = "sheetRESET0001A0") {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, "content");
  const canonicalUpdate = Y.encodeStateAsUpdate(doc);
  const canonicalStateVector = Y.encodeStateVector(doc);
  doc.destroy();
  app.db.createSheet({
    sheetId,
    creationToken: `tok-${tokenCounter++}`,
    canonicalUpdate,
    canonicalStateVector,
    title: "t",
    language: "typescript",
    schemaVersion: 0,
    committedAt: 1,
  });
  return sheetId;
}

function rawCounts(dbPath) {
  const c = new DatabaseSync(dbPath);
  const n = (sql) => Number(c.prepare(sql).get().c);
  const result = {
    sheets: n("SELECT COUNT(*) c FROM sheets"),
    metadata: n("SELECT COUNT(*) c FROM metadata"),
    idempotency: n("SELECT COUNT(*) c FROM idempotency"),
  };
  c.close();
  return result;
}

describe("POST /__test/reset — durable reset", () => {
  it("clears rooms, durable rows (via cascade), and limiter, then stays usable", async () => {
    const { app, port, dbPath } = await startApp();
    const sheetId = createSheet(app);
    app.__test.getRoom("live-room");
    app.rateLimiter.checkCreate("1.2.3.4", "some-token");

    // Preconditions.
    expect(app.db.getSheetRecord(sheetId)).not.toBeNull();
    expect(app.rooms.size).toBe(1);
    expect(app.rateLimiter.size().ip).toBeGreaterThan(0);
    expect(rawCounts(dbPath)).toEqual({ sheets: 1, metadata: 1, idempotency: 1 });

    const res = await fetch(`http://127.0.0.1:${port}/__test/reset`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");

    // Live rooms destroyed, durable rows cleared through FK cascade, limiter clear.
    expect(app.rooms.size).toBe(0);
    expect(app.db.getSheetRecord(sheetId)).toBeNull();
    expect(rawCounts(dbPath)).toEqual({ sheets: 0, metadata: 0, idempotency: 0 });
    expect(app.rateLimiter.size()).toEqual({ ip: 0, token: 0 });

    // The server is ready for the next test.
    const next = createSheet(app, "sheetAFTER00001A");
    expect(app.db.getSheetRecord(next)).not.toBeNull();
  });

  it("contains a durable-delete failure without clearing the limiter, then recovers", async () => {
    const { app, port, dbPath } = await startApp();
    const sheetId = createSheet(app);
    app.__test.getRoom("live-room");
    app.rateLimiter.checkCreate("1.2.3.4", "some-token");
    expect(app.rooms.size).toBe(1);
    expect(app.rateLimiter.size().ip).toBe(1);

    // Arm a one-shot BEGIN failure so the durable-delete transaction fails.
    app.db.__test.failNextBegin();
    const res = await fetch(`http://127.0.0.1:${port}/__test/reset`, { method: "POST" });
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("internal_error");
    expect(text).not.toMatch(/sqlite|begin/i);

    // Rooms were disposed first; the durable rows survive (rolled back); the
    // limiter was NOT cleared; the adapter stays usable.
    expect(app.rooms.size).toBe(0);
    expect(rawCounts(dbPath)).toEqual({ sheets: 1, metadata: 1, idempotency: 1 });
    expect(app.rateLimiter.size().ip).toBe(1);
    expect(app.db.__test.state()).toBe("idle");

    // A subsequent reset succeeds (the fault was one-shot).
    const res2 = await fetch(`http://127.0.0.1:${port}/__test/reset`, { method: "POST" });
    expect(res2.status).toBe(200);
    expect(rawCounts(dbPath)).toEqual({ sheets: 0, metadata: 0, idempotency: 0 });
    expect(app.rateLimiter.size()).toEqual({ ip: 0, token: 0 });

    // And the server is ready for the next test.
    const next = createSheet(app, "sheetAFTER00002A");
    expect(app.db.getSheetRecord(next)).not.toBeNull();
  });

  it("is unavailable outside test mode (404)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "galley-normalmode-"));
    const cwd = process.cwd();
    process.chdir(dir);
    let app;
    try {
      // No ECHO_REWIND_TEST → normal mode; the fixed production DB path resolves
      // under the throwaway cwd.
      app = await createServerApplication({ PORT: "0" });
      await app.start();
      const res = await fetch(
        `http://127.0.0.1:${app.address().port}/__test/reset`,
        { method: "POST" },
      );
      expect(res.status).toBe(404);
    } finally {
      if (app) await app.shutdown();
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
