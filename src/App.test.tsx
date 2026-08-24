import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

// App reads window.location.pathname at render. Default jsdom path is "/".
beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("App — root path renders the local draft", () => {
  it("renders the truthful state phrase, title, language control and editor", () => {
    render(<App />);
    expect(screen.getByText("Local draft — not uploaded")).toBeInTheDocument();
    expect(screen.getByLabelText("Sheet title")).toBeInTheDocument();
    expect(screen.getByLabelText("Sheet language")).toBeInTheDocument();
    // The editable content carries an accessible name, not just a wrapper.
    expect(screen.getByLabelText("Code editor")).toBeInTheDocument();
  });

  it("exposes the Share control but no post-share/remote-save claims yet", () => {
    render(<App />);
    // The visible Share control is present at the M4 gate.
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    // …but no post-share or forbidden wording before the gesture.
    expect(screen.queryByText(/Connecting|Shared|Saving|Saved|Reconnecting/)).toBeNull();
    expect(screen.queryByText("Copy link")).toBeNull();
    // `echo://` is the RETIRED prototype's room-address aria-label, named here
    // deliberately: this guard is only meaningful against the literal string it
    // asserts is absent. Not a current product name — see D-026.
    expect(screen.queryByLabelText(/echo:\/\//)).toBeNull();
  });

  it("does not write a prototype identity to sessionStorage", () => {
    render(<App />);
    // Likewise the RETIRED prototype's sessionStorage key, quoted verbatim so
    // the guard fails if that key is ever written again. Galley writes no
    // browser-storage key at all.
    expect(sessionStorage.getItem("echo-rewind:identity")).toBeNull();
  });

  it("language control changes local state", () => {
    render(<App />);
    const select = screen.getByLabelText("Sheet language") as HTMLSelectElement;
    expect(select.value).toBe("typescript");
    fireEvent.change(select, { target: { value: "python" } });
    expect(select.value).toBe("python");
  });
});

describe("App — non-root paths do not render a draft", () => {
  it.each(["/r/demo", "/some/arbitrary/path"])(
    "renders the unavailable state for %s",
    (path) => {
      window.history.replaceState({}, "", path);
      render(<App />);
      expect(screen.getByText("This link is unavailable")).toBeInTheDocument();
      // No draft chrome or editor.
      expect(screen.queryByText("Local draft — not uploaded")).toBeNull();
      expect(screen.queryByLabelText("Sheet title")).toBeNull();
      expect(screen.queryByLabelText("Code editor")).toBeNull();
      expect(screen.queryByText(/\bLive\b|Connecting|Shared|Saved/)).toBeNull();
    },
  );
});

describe("App — a valid sheet route activates the join page", () => {
  it("shows Connecting… with no editor before first sync (never an unavailable claim)", () => {
    // A never-resolving bootstrap keeps the page in its initial connecting state
    // and makes no real network call.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    window.history.replaceState({}, "", "/abcdefghij123456");
    render(<App />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code editor")).toBeNull();
    expect(screen.queryByText("This link is unavailable")).toBeNull();
    // No forbidden state wording during connect.
    expect(screen.queryByText(/Saving|Saved|Reconnecting/)).toBeNull();
  });
});
