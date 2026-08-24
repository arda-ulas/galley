// M4.5 T4 — deployment surface: environment-configurable database path,
// production static serving of the built client, route precedence, and the
// bounded trusted-proxy client address as observed END TO END through a real
// socket (not just the pure resolver, which clientAddress.test.mjs covers).

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import * as Y from "yjs";
import { createServerApplication, resolveConfig } from "./app.mjs";
import { PRODUCTION_DB_PATH } from "./persistence/db.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";

/** @type {Array<{ cleanup: () => Promise<void> }>} */
const temps = [];
const apps = [];
const dirs = [];
afterEach(async () => {
  while (apps.length) {
    try {
      await apps.pop().shutdown();
    } catch {
      // ignore
    }
  }
  while (temps.length) await temps.pop().cleanup();
  while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true });
});

/** A throwaway directory shaped like a real Vite `dist/`. */
async function makeStaticDir() {
  const root = await mkdtemp(path.join(tmpdir(), "galley-static-"));
  dirs.push(root);
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(
    path.join(root, "index.html"),
    '<!doctype html><html><head><title>Galley</title>' +
      '<script type="module" crossorigin src="/assets/app-HASH.js"></script>' +
      '</head><body><div id="root"></div></body></html>',
  );
  await writeFile(path.join(root, "assets", "app-HASH.js"), 'console.log("galley");\n');
  await writeFile(path.join(root, "assets", "app-HASH.css"), "body{margin:0}\n");
  return root;
}

async function startApp(extraEnv = {}) {
  const t = await createTempDb();
  temps.push(t);
  const app = await createServerApplication({
    GALLEY_TEST: "1",
    GALLEY_TEST_DB_PATH: t.dbPath,
    HOST: "127.0.0.1",
    PORT: "0",
    ...extraEnv,
  });
  await app.start();
  apps.push(app);
  return { app, port: app.address().port };
}

/** Raw request helper: needed because forged headers must reach the socket verbatim. */
function send(port, { method = "GET", path: reqPath = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const reqHeaders = { ...headers };
    if (payload !== undefined) {
      reqHeaders["Content-Type"] = reqHeaders["Content-Type"] ?? "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = httpRequest(
      { host: "127.0.0.1", port, path: reqPath, method, headers: reqHeaders },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, text: data }),
        );
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** Seed one durable sheet directly, so /api precedence can be tested against a real id. */
function seedSheet(app, sheetId = "sheetDEPLOY00001") {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, "deployed");
  const canonicalUpdate = Y.encodeStateAsUpdate(doc);
  const canonicalStateVector = Y.encodeStateVector(doc);
  doc.destroy();
  app.db.createSheet({
    sheetId,
    creationToken: randomUUID(),
    canonicalUpdate,
    canonicalStateVector,
    title: "deployed sheet",
    language: "typescript",
    schemaVersion: 0,
    committedAt: 11,
  });
  return sheetId;
}

function createPayload() {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, "hello");
  const submittedUpdate = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  const submittedStateVector = Buffer.from(Y.encodeStateVector(doc)).toString("base64");
  doc.destroy();
  return {
    creationToken: randomUUID(),
    submittedUpdate,
    submittedStateVector,
    title: "t",
    language: "typescript",
    schemaVersion: 0,
  };
}

describe("resolveConfig — GALLEY_DB_PATH (T4 A1)", () => {
  it("uses GALLEY_DB_PATH in normal mode and exposes an absolute resolved path", () => {
    const cfg = resolveConfig({ GALLEY_DB_PATH: "/srv/galley/data/galley.db" });
    expect(cfg.testMode).toBe(false);
    expect(cfg.dbPath).toBe("/srv/galley/data/galley.db");
    expect(cfg.resolvedDbPath).toBe("/srv/galley/data/galley.db");
    expect(path.isAbsolute(cfg.resolvedDbPath)).toBe(true);
  });

  it("resolves a relative GALLEY_DB_PATH to an absolute path for auditability", () => {
    const cfg = resolveConfig({ GALLEY_DB_PATH: "var/db/galley.db" });
    expect(path.isAbsolute(cfg.resolvedDbPath)).toBe(true);
    expect(cfg.resolvedDbPath.endsWith(path.join("var", "db", "galley.db"))).toBe(true);
  });

  it("falls back to the production default when unset or blank", () => {
    expect(resolveConfig({}).dbPath).toBe(PRODUCTION_DB_PATH);
    expect(resolveConfig({ GALLEY_DB_PATH: "" }).dbPath).toBe(PRODUCTION_DB_PATH);
    expect(resolveConfig({ GALLEY_DB_PATH: "   " }).dbPath).toBe(PRODUCTION_DB_PATH);
  });

  it("still requires GALLEY_TEST_DB_PATH in test mode and ignores GALLEY_DB_PATH", () => {
    expect(() =>
      resolveConfig({ GALLEY_TEST: "1", GALLEY_DB_PATH: "/srv/should-be-ignored.db" }),
    ).toThrow(/GALLEY_TEST_DB_PATH/i);
    const cfg = resolveConfig({
      GALLEY_TEST: "1",
      GALLEY_TEST_DB_PATH: "/tmp/explicit.db",
      GALLEY_DB_PATH: "/srv/should-be-ignored.db",
    });
    expect(cfg.dbPath).toBe("/tmp/explicit.db");
  });
});

describe("resolveConfig — static client and trust-proxy defaults", () => {
  it("defaults staticDir to ./dist in normal mode", () => {
    const cfg = resolveConfig({});
    expect(cfg.staticDir).toBe(path.resolve("dist"));
  });

  it("leaves staticDir null in test mode so the e2e stack is untouched", () => {
    const cfg = resolveConfig({ GALLEY_TEST: "1", GALLEY_TEST_DB_PATH: "/tmp/x.db" });
    expect(cfg.staticDir).toBeNull();
  });

  it("honours an explicit GALLEY_STATIC_DIR, including in test mode", () => {
    const cfg = resolveConfig({
      GALLEY_TEST: "1",
      GALLEY_TEST_DB_PATH: "/tmp/x.db",
      GALLEY_STATIC_DIR: "/srv/client",
    });
    expect(cfg.staticDir).toBe("/srv/client");
  });

  it("GALLEY_DISABLE_STATIC=1 wins over everything", () => {
    const cfg = resolveConfig({ GALLEY_STATIC_DIR: "/srv/client", GALLEY_DISABLE_STATIC: "1" });
    expect(cfg.staticDir).toBeNull();
  });

  it("trust-proxy is disabled by default", () => {
    expect(resolveConfig({}).trustProxy.enabled).toBe(false);
  });
});

describe("production static serving (T4 A7)", () => {
  it("serves index.html at the root", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { path: "/" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="root">');
  });

  it("serves the SPA shell for a direct /{sheetId} deep link", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { path: "/sheetDEPLOY00001" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="root">');
  });

  it("serves hashed assets with the right type and an immutable cache policy", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const js = await send(port, { path: "/assets/app-HASH.js" });
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toMatch(/text\/javascript/);
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(js.text).toContain("galley");

    const css = await send(port, { path: "/assets/app-HASH.css" });
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toMatch(/text\/css/);
  });

  it("serves index.html with no-cache so a redeploy is picked up", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { path: "/" });
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("404s a MISSING asset instead of masking it with the HTML shell", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { path: "/assets/does-not-exist.js" });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("<div id=\"root\">");
  });

  it("404s /favicon.ico rather than returning HTML with an image content-type", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { path: "/favicon.ico" });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("<div id=\"root\">");
  });

  it("refuses path traversal out of the static root", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { path: "/%2e%2e/%2e%2e/%2e%2e/etc/passwd" });
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(/root:/);
  });

  it("answers HEAD without a body", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { method: "HEAD", path: "/" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("");
  });

  it("keeps the plain 404 when no static directory is configured", async () => {
    const { port } = await startApp();
    const res = await send(port, { path: "/sheetDEPLOY00001" });
    expect(res.status).toBe(404);
    expect(res.text).toBe("");
  });

  it("falls through to 404 when the configured directory does not exist", async () => {
    const { port } = await startApp({ GALLEY_STATIC_DIR: "/nonexistent/galley/client" });
    const res = await send(port, { path: "/" });
    expect(res.status).toBe(404);
  });
});

describe("route precedence over the SPA fallback (T4 A8)", () => {
  it("GET /api/sheets/{id} returns JSON, not the HTML shell", async () => {
    const root = await makeStaticDir();
    const { app, port } = await startApp({ GALLEY_STATIC_DIR: root });
    const sheetId = seedSheet(app);
    const res = await send(port, { path: `/api/sheets/${sheetId}` });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(JSON.parse(res.text).sheetId).toBe(sheetId);
  });

  it("an UNKNOWN /api path 404s rather than falling back to the SPA", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { path: "/api/not-a-route" });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("<div id=\"root\">");
  });

  it("a plain GET on the WebSocket path 404s rather than returning the SPA", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { path: "/ws/sheetDEPLOY00001" });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("<div id=\"root\">");
  });

  it("the test-mode health probe still answers with static serving enabled", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { path: "/__test/health" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("ok");
  });

  it("POST to a static-looking path is not answered by the static handler", async () => {
    const root = await makeStaticDir();
    const { port } = await startApp({ GALLEY_STATIC_DIR: root });
    const res = await send(port, { method: "POST", path: "/", body: {} });
    expect(res.status).toBe(404);
  });
});

describe("trusted-proxy client address, end to end (T4 A10/A11)", () => {
  it("IGNORES a forged X-Forwarded-For from an untrusted direct client", async () => {
    const { app, port } = await startApp();
    await send(port, {
      method: "POST",
      path: "/api/sheets",
      headers: { "X-Forwarded-For": "9.9.9.9" },
      body: createPayload(),
    });
    // The rate limiter must have counted the REAL peer, never the forged value.
    expect(app.rateLimiter.__test.ipEntry("9.9.9.9")).toBeUndefined();
    expect(app.rateLimiter.__test.ipEntry("127.0.0.1")).toBeDefined();
  });

  it("ignores a forged multi-hop chain from an untrusted client", async () => {
    const { app, port } = await startApp();
    await send(port, {
      method: "POST",
      path: "/api/sheets",
      headers: { "X-Forwarded-For": "1.1.1.1, 2.2.2.2, 3.3.3.3" },
      body: createPayload(),
    });
    for (const forged of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      expect(app.rateLimiter.__test.ipEntry(forged)).toBeUndefined();
    }
    expect(app.rateLimiter.__test.ipEntry("127.0.0.1")).toBeDefined();
  });

  it("HONOURS X-Forwarded-For when the peer is a configured trusted proxy", async () => {
    const { app, port } = await startApp({ GALLEY_TRUSTED_PROXIES: "loopback" });
    await send(port, {
      method: "POST",
      path: "/api/sheets",
      headers: { "X-Forwarded-For": "203.0.113.7" },
      body: createPayload(),
    });
    expect(app.rateLimiter.__test.ipEntry("203.0.113.7")).toBeDefined();
    expect(app.rateLimiter.__test.ipEntry("127.0.0.1")).toBeUndefined();
  });

  it("with one trusted hop, a client-prepended entry cannot win", async () => {
    const { app, port } = await startApp({ GALLEY_TRUSTED_PROXIES: "loopback" });
    await send(port, {
      method: "POST",
      path: "/api/sheets",
      // The client forged "6.6.6.6"; the trusted proxy appended the peer it saw.
      headers: { "X-Forwarded-For": "6.6.6.6, 203.0.113.7" },
      body: createPayload(),
    });
    expect(app.rateLimiter.__test.ipEntry("203.0.113.7")).toBeDefined();
    expect(app.rateLimiter.__test.ipEntry("6.6.6.6")).toBeUndefined();
  });

  it("a trusted proxy that sends no header still attributes the peer", async () => {
    const { app, port } = await startApp({ GALLEY_TRUSTED_PROXIES: "loopback" });
    await send(port, { method: "POST", path: "/api/sheets", body: createPayload() });
    expect(app.rateLimiter.__test.ipEntry("127.0.0.1")).toBeDefined();
  });
});
