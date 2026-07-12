import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
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
function createSheet(app, overrides = {}) {
  const sheetId = overrides.sheetId ?? "sheetBOOT000001A";
  const doc = new Y.Doc();
  doc.getText("content").insert(0, overrides.text ?? "hello");
  const canonicalUpdate = Y.encodeStateAsUpdate(doc);
  const canonicalStateVector = Y.encodeStateVector(doc);
  doc.destroy();
  app.db.createSheet({
    sheetId,
    creationToken: `tok-${tokenCounter++}`,
    canonicalUpdate,
    canonicalStateVector,
    title: overrides.title ?? "bootstrapped",
    language: overrides.language ?? "typescript",
    schemaVersion: 0,
    committedAt: 7,
  });
  return sheetId;
}

const get = (port, path) => fetch(`http://127.0.0.1:${port}${path}`);

describe("GET /api/sheets/:id — success", () => {
  it("returns the safe metadata for a valid sheet", async () => {
    const { app, port } = await startApp();
    const sheetId = createSheet(app, { title: "the title", language: "python" });
    const res = await get(port, `/api/sheets/${sheetId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({
      sheetId,
      title: "the title",
      language: "python",
      schemaVersion: 0,
      serverRevision: 1,
      metadataRevision: 1,
    });
  });

  it("never exposes raw update / state-vector bytes", async () => {
    const { app, port } = await startApp();
    const sheetId = createSheet(app);
    const body = await (await get(port, `/api/sheets/${sheetId}`)).json();
    for (const key of [
      "state",
      "stateVector",
      "canonicalUpdate",
      "canonicalStateVector",
      "committedStateVector",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });
});

describe("GET /api/sheets/:id — errors", () => {
  it("400 on a malformed id", async () => {
    const { port } = await startApp();
    const res = await get(port, "/api/sheets/short");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_field");
  });

  it("404 on a missing sheet", async () => {
    const { port } = await startApp();
    const res = await get(port, "/api/sheets/sheetMISSING0001");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("500 generic on corrupt durable state (no internals leaked)", async () => {
    const { app, port, dbPath } = await startApp();
    const sheetId = createSheet(app);
    // Corrupt the persisted Yjs bytes on a throwaway connection.
    const c = new DatabaseSync(dbPath);
    c.prepare("UPDATE sheets SET state = ? WHERE id = ?").run(
      new Uint8Array([0xff, 0xff, 0xff, 0xff]),
      sheetId,
    );
    c.close();
    const res = await get(port, `/api/sheets/${sheetId}`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("internal_error");
    expect(text).not.toMatch(/sqlite|yjs|decode|varint/i);
  });

  it("404 on a query string (not the exact route)", async () => {
    const { app, port } = await startApp();
    const sheetId = createSheet(app);
    const res = await get(port, `/api/sheets/${sheetId}?x=1`);
    expect(res.status).toBe(404);
  });

  it("404 on an extra subpath (not the exact route)", async () => {
    const { app, port } = await startApp();
    const sheetId = createSheet(app);
    const res = await get(port, `/api/sheets/${sheetId}/extra`);
    expect(res.status).toBe(404);
  });

  it("404 on a trailing slash (not the exact route)", async () => {
    const { app, port } = await startApp();
    const sheetId = createSheet(app);
    const res = await get(port, `/api/sheets/${sheetId}/`);
    expect(res.status).toBe(404);
  });

  it("400 on a percent-encoded slash in the id (not decoded to a separator)", async () => {
    const { port } = await startApp();
    // Single raw segment containing %2F — the server does not decode it, so it
    // is one (malformed) id, never a path separator.
    const res = await get(port, "/api/sheets/aaaa%2Faaaaaaaaaaa");
    expect(res.status).toBe(400);
  });

  it("400 on a percent-encoded identifier (server does not decode the id)", async () => {
    const { port } = await startApp();
    // 16 × %41 would decode to 16 'A's, but the raw literal contains '%'.
    const res = await get(port, `/api/sheets/${"%41".repeat(16)}`);
    expect(res.status).toBe(400);
  });

  it("404 on an unsupported HTTP method", async () => {
    const { app, port } = await startApp();
    const sheetId = createSheet(app);
    const res = await fetch(`http://127.0.0.1:${port}/api/sheets/${sheetId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/sheets/:id — does not disturb the create endpoint", () => {
  it("POST /api/sheets still creates", async () => {
    const { port } = await startApp();
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "created via api");
    const submittedUpdate = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    const submittedStateVector = Buffer.from(Y.encodeStateVector(doc)).toString("base64");
    doc.destroy();
    const res = await fetch(`http://127.0.0.1:${port}/api/sheets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creationToken: crypto.randomUUID(),
        submittedUpdate,
        submittedStateVector,
        title: "t",
        language: "typescript",
        schemaVersion: 0,
      }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).sheetId).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});
