import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { installWebSocketSpy } from "./test/websocketProbe";

afterEach(cleanup);

// This file intentionally does NOT statically import App, so the WebSocket spy
// is installed BEFORE the active app module is imported. Proves that importing
// and rendering the root draft path constructs no application WebSocket — the
// active graph never reaches the provider module.
it("importing and rendering the active app constructs no application WebSocket", async () => {
  window.history.replaceState({}, "", "/");
  const spy = installWebSocketSpy();
  try {
    const { App } = await import("./App");
    render(<App />);
    expect(spy.count).toBe(0);
    expect(spy.urls).toHaveLength(0);
  } finally {
    spy.restore();
  }
});
