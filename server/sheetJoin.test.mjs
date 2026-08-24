// Real-server integration for the M4 S6 direct-load join: share a local draft
// into a durable sheet through the real coordinator, then open that sheet in a
// fresh session via openSheetSession() against the SAME server, and prove the
// two independent peers converge both ways with no duplicated content. Uses the
// installed `ws` package as the WebSocket polyfill; asserts convergence against
// the peers' own docs (never `provider.synced` alone).

import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { createServerApplication } from "./app.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";
import { createDraftSession } from "../src/lib/draftSession.ts";
import { shareDraftSession } from "../src/lib/shareCoordinator.ts";
import { openSheetSession } from "../src/lib/sheetSession.ts";

const temps = [];
const apps = [];
const cleanups = [];

afterEach(async () => {
  const errors = [];
  for (const c of cleanups.splice(0).reverse()) {
    try {
      c();
    } catch (e) {
      errors.push(e);
    }
  }
  while (apps.length) {
    try {
      await apps.pop().shutdown();
    } catch (e) {
      errors.push(e);
    }
  }
  while (temps.length) await temps.pop().cleanup();
  if (errors.length) throw new AggregateError(errors, "integration cleanup failures");
});

class NodeWebsocketProvider extends WebsocketProvider {
  constructor(serverUrl, room, doc, opts) {
    super(serverUrl, room, doc, { ...opts, WebSocketPolyfill: WsWebSocket });
  }
}

const text = (doc) => doc.getText("content").toString();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, label = "condition", timeout = 8000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${label}`);
    await delay(15);
  }
}

async function startApp() {
  const t = await createTempDb();
  temps.push(t);
  const app = await createServerApplication({
    GALLEY_TEST: "1",
    GALLEY_TEST_DB_PATH: t.dbPath,
    HOST: "127.0.0.1",
    PORT: "0",
  });
  await app.start();
  apps.push(app);
  return { app, port: app.address().port };
}

describe("direct-load join (openSheetSession) — real server", () => {
  it("joins a shared sheet, bootstraps authoritative metadata, and converges both ways", async () => {
    const { port } = await startApp();
    const httpFetch = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
    const wsBase = `ws://127.0.0.1:${port}/ws`;

    // ── Sharer: a real draft with content, shared into a durable sheet. ──
    const sharer = createDraftSession();
    cleanups.push(() => sharer.disposeUnlessTransferred());
    sharer.text.insert(0, "hello from A");
    const sharerClientId = sharer.awareness.clientID;

    const shared = await shareDraftSession({
      session: sharer,
      title: "notes",
      language: "typescript",
      creationToken: randomUUID(),
      fetch: httpFetch,
      serverUrl: wsBase,
      WebsocketProviderCtor: NodeWebsocketProvider,
    });
    cleanups.push(() => shared.controller.dispose());
    const sheetId = shared.sheetId;

    // The sharer's Awareness client id survives the draft→shared transfer
    // (same Awareness instance; nothing reconstructed).
    expect(sharer.awareness.clientID).toBe(sharerClientId);

    // ── Joiner: a fresh, independent session opened via the S6 orchestration. ──
    const outcome = await openSheetSession({
      sheetId,
      fetch: httpFetch,
      serverUrl: wsBase,
      WebsocketProviderCtor: NodeWebsocketProvider,
    });
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("join did not become ready");
    cleanups.push(() => outcome.controller.dispose());

    // Authoritative bootstrap metadata.
    expect(outcome.bootstrap.sheetId).toBe(sheetId);
    expect(outcome.bootstrap.title).toBe("notes");
    expect(outcome.bootstrap.language).toBe("typescript");

    // Complete shared text appears EXACTLY once (no duplicated initial content).
    await waitFor(() => text(outcome.session.doc) === "hello from A", "A→B initial sync");
    expect(text(outcome.session.doc)).toBe("hello from A");

    // Edits flow A → B.
    sharer.text.insert(sharer.text.length, " + A2");
    await waitFor(() => text(outcome.session.doc).includes("+ A2"), "A→B edit");

    // Edits flow B → A.
    outcome.session.text.insert(0, "B0 ");
    await waitFor(() => text(sharer.doc).startsWith("B0 "), "B→A edit");

    // Both peers converge to identical text.
    await waitFor(
      () => text(sharer.doc) === text(outcome.session.doc),
      "final convergence",
    );
    expect(text(sharer.doc)).toBe("B0 hello from A + A2");
  });
});
