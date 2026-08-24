import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

/**
 * DEF-8 (M4.5 §5.2): browser Back/Forward must re-resolve the route.
 *
 * Before this, `App` read `window.location.pathname` at render time only, so
 * pressing Back changed the address bar while the page kept rendering whatever
 * route it had resolved at mount.
 *
 * The second half of the fix matters as much as the first: subscribing to
 * `popstate` must NOT resurrect a re-render on `history.replaceState`, which is
 * what Share calls. If it did, the sharer's editor would remount at the moment
 * of Share and lose its selection and undo history — the invariant
 * `DraftPage.noRemount.test.tsx` exists to protect.
 */

const VALID_ID = "abcdefghij123456";
const OTHER_ID = "zyxwvutsrq654321";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  // Sheet routes bootstrap over fetch; a never-resolving stub keeps them in
  // "Connecting…" and makes no real network call.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Drive a real Back/Forward: change the URL, then fire the event the browser fires. */
function navigateBack(pathname: string) {
  act(() => {
    window.history.replaceState({}, "", pathname);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

describe("App — popstate re-resolves the route (DEF-8)", () => {
  it("moves from the draft to a sheet route on Back/Forward", () => {
    render(<App />);
    expect(screen.getByText("Local draft — not uploaded")).toBeInTheDocument();

    navigateBack(`/${VALID_ID}`);

    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.queryByText("Local draft — not uploaded")).toBeNull();
  });

  it("moves from a sheet route back to the draft", () => {
    window.history.replaceState({}, "", `/${VALID_ID}`);
    render(<App />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();

    navigateBack("/");

    expect(screen.getByText("Local draft — not uploaded")).toBeInTheDocument();
    expect(screen.queryByText("Connecting…")).toBeNull();
  });

  it("re-resolves to the unavailable surface for a non-route path", () => {
    render(<App />);
    navigateBack("/not/a/route");

    expect(screen.getByText("This link is unavailable")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code editor")).toBeNull();
  });

  it("re-resolves BETWEEN two sheet ids without stranding the previous one", () => {
    window.history.replaceState({}, "", `/${VALID_ID}`);
    render(<App />);

    navigateBack(`/${OTHER_ID}`);

    // Still the sheet surface, now for the other id — SheetPage's own generation
    // guard aborts the first open rather than publishing it under the new id.
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.queryByText("This link is unavailable")).toBeNull();
  });

  it("does NOT re-render on replaceState — the Share handoff stays mounted", () => {
    render(<App />);
    const editorBefore = screen.getByLabelText("Code editor");
    expect(screen.getByText("Local draft — not uploaded")).toBeInTheDocument();

    // Exactly what Share does: swap the URL with no popstate.
    act(() => {
      window.history.replaceState(null, "", `/${VALID_ID}`);
    });

    // The draft is still rendered against the SAME editor element: App did not
    // re-resolve, so DraftPage never unmounted.
    expect(screen.getByText("Local draft — not uploaded")).toBeInTheDocument();
    expect(screen.getByLabelText("Code editor")).toBe(editorBefore);
    expect(screen.queryByText("Connecting…")).toBeNull();
  });

  it("removes the popstate listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<App />);
    unmount();
    expect(remove).toHaveBeenCalledWith("popstate", expect.any(Function));
    remove.mockRestore();
  });
});
