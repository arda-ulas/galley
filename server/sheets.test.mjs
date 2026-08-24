import { afterEach, describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { createServerApplication } from "./app.mjs";
import {
  respondInternalError,
  writeJson,
  writeJsonError,
} from "./errors.mjs";
import { openDatabase } from "./persistence/db.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";

/** @type {Array<{ cleanup: () => Promise<void> }>} */
const temps = [];
const apps = [];

afterEach(async () => {
  while (apps.length) {
    try {
      await apps.pop().shutdown();
    } catch {
      // best-effort
    }
  }
  while (temps.length) await temps.pop().cleanup();
});

async function startApp(options = {}) {
  const t = await createTempDb();
  temps.push(t);
  const app = await createServerApplication(
    {
      GALLEY_TEST: "1",
      GALLEY_TEST_DB_PATH: t.dbPath,
      HOST: "127.0.0.1",
      PORT: "0",
    },
    options,
  );
  await app.start();
  apps.push(app);
  return { app, port: app.address().port, dbPath: t.dbPath };
}

/** HTTP request helper. `body` may be an object (JSON-encoded) or a raw string. */
function send(port, { method = "POST", path = "/api/sheets", headers = {}, body, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const reqHeaders = { "Content-Type": "application/json", ...headers };
    if (payload !== undefined && !chunked && reqHeaders["Content-Length"] === undefined) {
      reqHeaders["Content-Length"] = Buffer.byteLength(payload);
    }
    let responded = false;
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers: reqHeaders },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          responded = true;
          let json;
          try {
            json = JSON.parse(data);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text: data, json });
        });
      },
    );
    req.on("error", (err) => {
      if (!responded) reject(err);
    });
    if (payload !== undefined) {
      if (chunked) {
        const half = Math.ceil(payload.length / 2);
        req.write(payload.slice(0, half));
        req.write(payload.slice(half));
      } else {
        req.write(payload);
      }
    }
    req.end();
  });
}

/**
 * Raw keep-alive request with an oversized declared Content-Length AND an actual
 * (partial) oversized body. Resolves with the server's response text and whether
 * the socket closed.
 */
function rawOversized(port) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let response = "";
    const sock = netConnect(port, "127.0.0.1", () => {
      sock.write(
        "POST /api/sheets HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Content-Type: application/json\r\n" +
          "Content-Length: 2000000\r\n" +
          "Connection: keep-alive\r\n\r\n",
      );
      sock.write("x".repeat(300_000)); // a real (partial) oversized body
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new Error("rawOversized: timed out waiting for close"));
    }, 3000);
    sock.on("data", (c) => (response += c.toString()));
    // An expected socket error (e.g. ECONNRESET after the server closes) must
    // NOT resolve the helper — ignore it and keep waiting for 'close'.
    sock.on("error", () => {});
    sock.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ response, closed: true });
    });
  });
}

/** Send a partial request (declared length not reached) then abort the socket.
 * Resolves only from the socket 'close' event; a bounded timeout guards it. */
function rawAbort(port) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const sock = netConnect(port, "127.0.0.1", () => {
      sock.write(
        "POST /api/sheets HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Content-Type: application/json\r\n" +
          "Content-Length: 5000\r\n" +
          "Connection: keep-alive\r\n\r\n",
      );
      sock.write("x".repeat(100)); // far short of the declared 5000
      setTimeout(() => sock.destroy(), 20); // abort mid-request
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new Error("rawAbort: timed out waiting for close"));
    }, 3000);
    sock.on("error", () => {}); // client-side reset is expected; wait for close
    sock.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });
}

/** A minimal controllable http.ServerResponse stand-in for late-response tests. */
function fakeRes(state = {}) {
  return {
    destroyed: state.destroyed ?? false,
    writableEnded: state.writableEnded ?? false,
    headersSent: state.headersSent ?? false,
    ended: false,
    doubleEnd: false,
    socket: { destroyed: false, destroy() { this.destroyed = true; } },
    writeHead(status, headers) {
      this.headersSent = true;
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(data, cb) {
      if (this.ended) {
        this.doubleEnd = true;
        return;
      }
      this.ended = true;
      this.writableEnded = true;
      if (typeof data === "function") {
        data();
      } else {
        if (data !== undefined) this.body = data;
        if (typeof cb === "function") cb();
      }
    },
  };
}

/** Build a valid create payload from a content string. */
function payload(overrides = {}) {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, overrides.text ?? "hello world");
  const submittedUpdate = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  const submittedStateVector = Buffer.from(Y.encodeStateVector(doc)).toString("base64");
  doc.destroy();
  const body = {
    creationToken: overrides.creationToken ?? randomUUID(),
    submittedUpdate,
    submittedStateVector,
    title: overrides.title ?? "my sheet",
    language: overrides.language ?? "typescript",
    schemaVersion: overrides.schemaVersion ?? 0,
  };
  if (overrides.patch) overrides.patch(body);
  return body;
}

describe("POST /api/sheets — success and idempotency", () => {
  it("returns 201 with the committed representation and no-store headers", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload() });
    expect(res.status).toBe(201);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json.sheetId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(res.json.serverRevision).toBe(1);
    expect(res.json.committedMetadataRevision).toBe(1);
    expect(typeof res.json.committedAt).toBe("number");
    expect(res.json.committedStateVector.length).toBeGreaterThan(0);
  });

  it("accepts application/json with a charset parameter", async () => {
    const { port } = await startApp();
    const res = await send(port, {
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: payload(),
    });
    expect(res.status).toBe(201);
  });

  it("replays the same token with 200 and the same sheet id", async () => {
    const { port } = await startApp();
    const body = payload({ creationToken: randomUUID() });
    const first = await send(port, { body });
    const replay = await send(port, { body });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.json.sheetId).toBe(first.json.sheetId);
    expect(replay.json.committedStateVector).toBe(first.json.committedStateVector);
  });

  it("concurrent duplicate token creates exactly one sheet", async () => {
    const { app, port } = await startApp();
    const body = payload({ creationToken: randomUUID() });
    const [a, b] = await Promise.all([send(port, { body }), send(port, { body })]);
    expect(a.json.sheetId).toBe(b.json.sheetId);
    expect(new Set([a.status, b.status])).toEqual(new Set([201, 200]));
    // Exactly one durable sheet exists.
    const sheet = app.db.getSheet(a.json.sheetId);
    expect(sheet).not.toBeNull();
    expect(sheet.serverRevision).toBe(1);
  });

  it("persists the created sheet across a restart", async () => {
    const { app, port, dbPath } = await startApp();
    const res = await send(port, { body: payload() });
    const sheetId = res.json.sheetId;
    await app.shutdown();
    apps.pop(); // already shut down

    const db = openDatabase(dbPath);
    try {
      const sheet = db.getSheet(sheetId);
      expect(sheet).not.toBeNull();
      expect(sheet.serverRevision).toBe(1);
      expect(sheet.state).not.toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("POST /api/sheets — request validation", () => {
  it("415 on an unsupported media type", async () => {
    const { port } = await startApp();
    const res = await send(port, { headers: { "Content-Type": "text/plain" }, body: "{}" });
    expect(res.status).toBe(415);
    expect(res.json.error).toBe("unsupported_media_type");
  });

  it("400 on malformed JSON", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: "{ not json" });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_json");
  });

  it("400 on an unknown field", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ patch: (b) => (b.extra = 1) }) });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("unknown_field");
  });

  it("400 on a missing creationToken", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ patch: (b) => delete b.creationToken }) });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("missing_field");
  });

  it("400 on a non-UUID creationToken", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ creationToken: "not-a-uuid" }) });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_field");
  });

  it("400 on base64url submittedUpdate", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ patch: (b) => (b.submittedUpdate = "-_8=") }) });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_field");
  });

  it("400 on invalid Yjs state", async () => {
    const { port } = await startApp();
    const garbage = Buffer.from([0xff, 0xff, 0xff, 0xff]).toString("base64");
    const res = await send(port, { body: payload({ patch: (b) => (b.submittedUpdate = garbage) }) });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_yjs_state");
  });

  it("400 on a state-vector mismatch", async () => {
    const { port } = await startApp();
    const emptyVector = Buffer.from(Y.encodeStateVector(new Y.Doc())).toString("base64");
    const res = await send(port, {
      body: payload({ text: "content here", patch: (b) => (b.submittedStateVector = emptyVector) }),
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_yjs_state");
  });

  it("422 on an unsupported language", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ language: "ruby" }) });
    expect(res.status).toBe(422);
    expect(res.json.error).toBe("unsupported_language");
  });

  it("422 on a non-zero schemaVersion", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ schemaVersion: 1 }) });
    expect(res.status).toBe(422);
    expect(res.json.error).toBe("unsupported_schema_version");
  });

  it("400 on a wrong-typed schemaVersion", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ patch: (b) => (b.schemaVersion = "0") }) });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_field");
  });

  it("400 on an over-long title", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ title: "a".repeat(201) }) });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_field");
  });
});

describe("POST /api/sheets — size limits (413)", () => {
  it("rejects a decoded update over 512 KiB", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ text: "a".repeat(600_000) }) });
    expect(res.status).toBe(413);
    expect(res.json.error).toBe("payload_too_large");
  });

  it("rejects a decoded state vector over 64 KiB", async () => {
    const { port } = await startApp();
    const bigVector = Buffer.alloc(70_000, 1).toString("base64");
    const res = await send(port, { body: payload({ patch: (b) => (b.submittedStateVector = bigVector) }) });
    expect(res.status).toBe(413);
    expect(res.json.error).toBe("payload_too_large");
  });

  it("rejects visible content over 250,000 code units", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload({ text: "a".repeat(250_001) }) });
    expect(res.status).toBe(413);
    expect(res.json.error).toBe("payload_too_large");
  });
});

describe("POST /api/sheets — rate limiting", () => {
  it("429 after the per-IP create limit", async () => {
    const { port } = await startApp();
    for (let i = 0; i < 30; i++) {
      const res = await send(port, { body: payload() });
      expect(res.status).toBe(201);
    }
    const limited = await send(port, { body: payload() });
    expect(limited.status).toBe(429);
    expect(limited.json.error).toBe("rate_limited");
  });

  it("429 after the per-token create limit", async () => {
    const { port } = await startApp();
    const token = randomUUID();
    // 1 create + 9 replays = 10 attempts on the same token.
    for (let i = 0; i < 10; i++) {
      const res = await send(port, { body: payload({ creationToken: token }) });
      expect([200, 201]).toContain(res.status);
    }
    const limited = await send(port, { body: payload({ creationToken: token }) });
    expect(limited.status).toBe(429);
    expect(limited.json.error).toBe("rate_limited");
  });
});

describe("POST /api/sheets — id collision retry and internal errors", () => {
  const ID_A = "sheetAAAAAAAAAA1";
  const ID_B = "sheetBBBBBBBBBB1";

  it("retries the atomic attempt on id collision (up to five)", async () => {
    // First create mints ID_A; the second collides on ID_A four times, then B.
    const ids = [ID_A, ID_A, ID_A, ID_A, ID_A, ID_B];
    const { port } = await startApp({ generateSheetId: () => ids.shift() });
    const first = await send(port, { body: payload({ creationToken: randomUUID() }) });
    expect(first.status).toBe(201);
    expect(first.json.sheetId).toBe(ID_A);
    const second = await send(port, { body: payload({ creationToken: randomUUID() }) });
    expect(second.status).toBe(201);
    expect(second.json.sheetId).toBe(ID_B);
  });

  it("500 when id collisions exhaust the retries", async () => {
    const { port } = await startApp({ generateSheetId: () => ID_A });
    const first = await send(port, { body: payload({ creationToken: randomUUID() }) });
    expect(first.status).toBe(201);
    const second = await send(port, { body: payload({ creationToken: randomUUID() }) });
    expect(second.status).toBe(500);
    expect(second.json.error).toBe("internal_error");
  });

  it("500 on a persistence failure, leaking no internals", async () => {
    const { app, port } = await startApp();
    app.db.__test.failNextCommit();
    const res = await send(port, { body: payload() });
    expect(res.status).toBe(500);
    expect(res.json.error).toBe("internal_error");
    expect(res.text).not.toMatch(/sqlite|commit|stack|Error:/i);
  });
});

describe("POST /api/sheets — shutdown clears the rate limiter", () => {
  it("empties limiter state on clean shutdown", async () => {
    const { app, port } = await startApp();
    await send(port, { body: payload() });
    expect(app.rateLimiter.size().ip).toBeGreaterThan(0);
    await app.shutdown();
    apps.pop(); // already shut down
    expect(app.rateLimiter.size()).toEqual({ ip: 0, token: 0 });
  });
});

describe("POST /api/sheets — strict Content-Type", () => {
  const accepted = [
    "application/json",
    "application/json;charset=utf-8",
    "application/json; charset=utf-8",
    "application/json; CHARSET=utf-8",
    'application/json; charset="utf-8"',
  ];
  const rejected = [
    "text/plain",
    "application/json-patch+json",
    "application/json; garbage",
    "application/json;;;;",
    "application/json; charset",
    "application/json; =utf-8",
    "application/json; charset=utf-8; charset",
  ];
  for (const ct of accepted) {
    it(`accepts "${ct}"`, async () => {
      const { port } = await startApp();
      const res = await send(port, { headers: { "Content-Type": ct }, body: payload() });
      expect(res.status).toBe(201);
    });
  }
  for (const ct of rejected) {
    it(`rejects "${ct}" with 415`, async () => {
      const { port } = await startApp();
      const res = await send(port, { headers: { "Content-Type": ct }, body: payload() });
      expect(res.status).toBe(415);
      expect(res.json.error).toBe("unsupported_media_type");
    });
  }
});

describe("POST /api/sheets — UUID normalization", () => {
  it("treats case-equivalent tokens as one identity (replay + shared quota)", async () => {
    const { app, port } = await startApp();
    const lower = randomUUID();
    const upper = lower.toUpperCase();
    const a = await send(port, { body: payload({ creationToken: lower }) });
    const b = await send(port, { body: payload({ creationToken: upper }) });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200); // uppercase replays the normalized lowercase token
    expect(b.json.sheetId).toBe(a.json.sheetId);
    expect(app.db.getSheet(a.json.sheetId)).not.toBeNull();
  });

  it("case-equivalent tokens share the per-token rate-limit quota", async () => {
    const { port } = await startApp();
    const lower = randomUUID();
    const forms = [lower, lower.toUpperCase()];
    // 10 admitted attempts on ONE normalized token (1×201 then 9×200 replays).
    // The per-IP limit (30) is not reached, so a 429 here proves the normalized
    // token reaches the limiter — not just persistence.
    for (let i = 0; i < 10; i++) {
      const res = await send(port, { body: payload({ creationToken: forms[i % 2] }) });
      expect(res.status).toBe(i === 0 ? 201 : 200);
    }
    const limited = await send(port, { body: payload({ creationToken: forms[1] }) });
    expect(limited.status).toBe(429);
    expect(limited.json.error).toBe("rate_limited");
  });
});

describe("POST /api/sheets — exact success payload", () => {
  it("returns exactly the five success keys and no extras", async () => {
    const { port } = await startApp();
    const res = await send(port, { body: payload() });
    expect(res.status).toBe(201);
    expect(Object.keys(res.json).sort()).toEqual([
      "committedAt",
      "committedMetadataRevision",
      "committedStateVector",
      "serverRevision",
      "sheetId",
    ]);
  });
});

describe("POST /api/sheets — oversized body lifecycle", () => {
  it("closes a keep-alive connection after a 413 (oversized Content-Length + real body)", async () => {
    const { port } = await startApp();
    const { response, closed } = await rawOversized(port);
    expect(response).toMatch(/HTTP\/1\.1 413/);
    expect(response.toLowerCase()).toMatch(/connection: close/);
    expect(closed).toBe(true);
  });

  it("rejects an oversized chunked body with a single 413 and no hang", async () => {
    const { port } = await startApp();
    const big = "x".repeat(1024 * 1024 + 4096);
    const res = await send(port, { body: JSON.stringify({ big }), chunked: true });
    expect(res.status).toBe(413);
    expect(res.json.error).toBe("payload_too_large");
  });

  it("an aborted request neither logs an internal error nor prevents later requests", async () => {
    const { port } = await startApp();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await rawAbort(port);
      await new Promise((r) => setTimeout(r, 30)); // let the server process the abort
      const loggedInternal = spy.mock.calls.some((args) =>
        String(args[0]).includes("create-sheet internal error"),
      );
      expect(loggedInternal).toBe(false);
    } finally {
      spy.mockRestore();
    }
    const res = await send(port, { body: payload() });
    expect(res.status).toBe(201);
  });
});

describe("errors — late-response safety", () => {
  it("writes exactly one generic 500 when headers are not sent", () => {
    const res = fakeRes();
    respondInternalError(res);
    expect(res.status).toBe(500);
    expect(res.ended).toBe(true);
    expect(JSON.parse(res.body).error).toBe("internal_error");
  });

  it("ends once (no new headers) when headers are already sent and writable", () => {
    const res = fakeRes({ headersSent: true });
    respondInternalError(res);
    expect(res.status).toBeUndefined(); // no writeHead called
    expect(res.ended).toBe(true);
    expect(res.doubleEnd).toBe(false);
  });

  it("is a no-op when the response is already ended", () => {
    const res = fakeRes({ writableEnded: true });
    respondInternalError(res);
    expect(res.ended).toBe(false);
  });

  it("is a no-op when the response is destroyed", () => {
    const res = fakeRes({ destroyed: true });
    respondInternalError(res);
    expect(res.ended).toBe(false);
  });

  it("a handler-level error write is not double-ended by the last-resort path", () => {
    const res = fakeRes();
    writeJsonError(res, 400, "invalid_field", "bad"); // handler response
    respondInternalError(res); // outer catch last-resort
    expect(res.status).toBe(400);
    expect(res.doubleEnd).toBe(false);
  });

  it("writeJson is a no-op on an already-ended response", () => {
    const res = fakeRes({ writableEnded: true });
    writeJson(res, 200, { ok: true });
    expect(res.ended).toBe(false);
  });
});
