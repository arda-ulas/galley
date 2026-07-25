import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

// App reads window.location.pathname at render. Default jsdom path is "/".
beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
afterEach(cleanup);

describe("App — root path renders the local draft", () => {
  it("renders the truthful state phrase, title, language control and editor", () => {
    render(<App />);
    expect(screen.getByText("Local draft — not uploaded")).toBeInTheDocument();
    expect(screen.getByLabelText("Sheet title")).toBeInTheDocument();
    expect(screen.getByLabelText("Sheet language")).toBeInTheDocument();
    // The editable content carries an accessible name, not just a wrapper.
    expect(screen.getByLabelText("Code editor")).toBeInTheDocument();
  });

  it("renders no remote claims or controls", () => {
    render(<App />);
    expect(screen.queryByText(/\bLive\b|Connecting|Shared|Saving|Saved/)).toBeNull();
    expect(screen.queryByLabelText(/echo:\/\//)).toBeNull();
    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy .*link/i })).toBeNull();
    expect(screen.queryByTitle(/·/)).toBeNull();
  });

  it("does not write a prototype identity to sessionStorage", () => {
    render(<App />);
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

describe("App — a well-formed sheet route is dormant in S5", () => {
  it("renders the neutral unavailable surface, not the editor or any state claim", () => {
    // A valid-SHAPE id (16 base64url chars). S5 recognizes it as a sheet route
    // but does not activate it: no server contact, no editor, no connection
    // wording. S6 activates shared routes.
    window.history.replaceState({}, "", "/abcdefghij123456");
    render(<App />);
    expect(screen.getByText("This link is unavailable")).toBeInTheDocument();
    // No draft chrome or editor.
    expect(screen.queryByText("Local draft — not uploaded")).toBeNull();
    expect(screen.queryByLabelText("Sheet title")).toBeNull();
    expect(screen.queryByLabelText("Code editor")).toBeNull();
    // No connection-state claim of any kind.
    expect(screen.queryByText(/\bLive\b|Connecting|Shared|Saving|Saved/)).toBeNull();
    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy .*link/i })).toBeNull();
  });
});
