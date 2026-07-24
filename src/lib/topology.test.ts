import { describe, expect, it, vi } from "vitest";
import { installWebSocketSpy } from "../test/websocketProbe";
import { createSheetPath, sheetBootstrapPath, wsBase } from "./topology";

describe("topology — API paths (same-origin, relative)", () => {
  it("create-sheet path is exactly /api/sheets", () => {
    expect(createSheetPath()).toBe("/api/sheets");
  });

  it("bootstrap path is /api/sheets/{sheetId}", () => {
    expect(sheetBootstrapPath("abc123DEF456ghi7")).toBe(
      "/api/sheets/abc123DEF456ghi7",
    );
  });

  it("uses the sheetId verbatim (id validation is S5's responsibility)", () => {
    // Malformed ids are intentionally NOT this module's concern; topology only
    // assembles the path from whatever it is given.
    expect(sheetBootstrapPath("anything-here")).toBe("/api/sheets/anything-here");
  });

  it("API paths are relative same-origin, never absolute URLs", () => {
    expect(createSheetPath().startsWith("/")).toBe(true);
    expect(sheetBootstrapPath("x").startsWith("/")).toBe(true);
    expect(createSheetPath()).not.toMatch(/^https?:/i);
    expect(sheetBootstrapPath("x")).not.toMatch(/^wss?:/i);
  });
});

describe("topology — WebSocket base", () => {
  it("maps HTTP → ws: and preserves host + port", () => {
    expect(wsBase({ protocol: "http:", host: "127.0.0.1:5173" })).toBe(
      "ws://127.0.0.1:5173/ws",
    );
  });

  it("maps HTTPS → wss: and preserves host + port", () => {
    expect(wsBase({ protocol: "https:", host: "galley.example.com:8443" })).toBe(
      "wss://galley.example.com:8443/ws",
    );
  });

  it("is the canonical /ws base — no trailing sheet id, no query string", () => {
    const base = wsBase({ protocol: "http:", host: "127.0.0.1:5173" });
    expect(base).toBe("ws://127.0.0.1:5173/ws");
    expect(base.endsWith("/ws")).toBe(true);
    expect(base).not.toContain("?");
  });

  it("composes to exactly /ws/{sheetId} when the provider appends the id", () => {
    // y-websocket composes `${serverUrl}/${roomname}` with an empty params set,
    // appending no query string. Assert the composed URL is canonical.
    const url = `${wsBase({ protocol: "http:", host: "127.0.0.1:5173" })}/sheet0000000001`;
    expect(url).toBe("ws://127.0.0.1:5173/ws/sheet0000000001");
    expect(url).not.toContain("?");
  });

  it("defaults to the current browser location (protocol + host)", () => {
    const { protocol, host } = window.location;
    const expected = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/ws`;
    expect(wsBase()).toBe(expected);
    expect(wsBase()).not.toContain("?");
  });
});

describe("topology — purity", () => {
  it("importing the module and calling helpers performs no network activity", async () => {
    const socketSpy = installWebSocketSpy();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      vi.resetModules();
      const mod = await import("./topology");
      // Exercise every helper; none may open a socket or issue a request.
      mod.createSheetPath();
      mod.sheetBootstrapPath("x");
      mod.wsBase({ protocol: "http:", host: "h:1" });
      expect(socketSpy.count).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      socketSpy.restore();
    }
  });
});
