import { StrictMode, createElement } from "react";
import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  createDraftSession,
  useDraftSession,
  type DraftSession,
} from "./draftSession";

afterEach(cleanup);

describe("createDraftSession — wiring", () => {
  it("doc, text, awareness and undo manager belong to the same session", () => {
    const s = createDraftSession();
    try {
      // Not merely instanceof: prove they are wired to the same document.
      expect(s.text.doc).toBe(s.doc);
      expect(s.awareness.doc).toBe(s.doc);
      expect(s.text).toBe(s.doc.getText("content"));
      // The undo manager operates on this session's text.
      const origin = {};
      s.undoManager.addTrackedOrigin(origin);
      s.doc.transact(() => s.text.insert(0, "abc"), origin);
      s.undoManager.undo();
      expect(s.text.toString()).toBe("");
    } finally {
      s.destroy();
    }
  });

  it("starts empty (no seed)", () => {
    const s = createDraftSession();
    try {
      expect(s.text.toString()).toBe("");
    } finally {
      s.destroy();
    }
  });
});

describe("createDraftSession — disposal", () => {
  it("destroy() releases resources and is idempotent", () => {
    const s = createDraftSession();
    expect(s.destroyed).toBe(false);
    s.destroy();
    expect(s.destroyed).toBe(true);
    // Idempotent: a second call is a safe no-op.
    expect(() => s.destroy()).not.toThrow();
    expect(s.destroyed).toBe(true);
  });

  it("disposeUnlessTransferred destroys a non-transferred session", () => {
    const s = createDraftSession();
    s.disposeUnlessTransferred();
    expect(s.destroyed).toBe(true);
  });

  it("transferOwnership prevents disposeUnlessTransferred from destroying", () => {
    const s = createDraftSession();
    s.transferOwnership();
    s.disposeUnlessTransferred();
    expect(s.destroyed).toBe(false);
    // Still explicitly destroyable (cleanup for the test).
    s.destroy();
    expect(s.destroyed).toBe(true);
  });
});

describe("createDraftSession — undo scoping (UndoManager origins)", () => {
  // This is a unit test of Y.UndoManager origin scoping using stand-in origins.
  // It does NOT claim to exercise the y-codemirror binding — the real binding is
  // covered by the DraftEditor Playwright undo/redo tests.
  it("only tracked-origin edits are undoable; untracked edits are not", () => {
    const { text, undoManager, destroy } = createDraftSession();
    try {
      const localOrigin = {};
      const remoteOrigin = {};
      undoManager.addTrackedOrigin(localOrigin);

      text.doc!.transact(() => text.insert(0, "hello"), localOrigin);
      text.doc!.transact(() => text.insert(5, "-remote"), remoteOrigin);
      expect(text.toString()).toBe("hello-remote");

      undoManager.undo();
      expect(text.toString()).toBe("-remote");
    } finally {
      destroy();
    }
  });

  it("a purely untracked (null-origin) change is not undoable", () => {
    const { text, undoManager, destroy } = createDraftSession();
    try {
      text.insert(0, "unmanaged");
      undoManager.undo();
      expect(text.toString()).toBe("unmanaged");
    } finally {
      destroy();
    }
  });
});

describe("useDraftSession — lifecycle ownership", () => {
  it("returns one stable session across re-renders", () => {
    const { result, rerender } = renderHook(() => useDraftSession());
    const first = result.current;
    expect(first).not.toBeNull();
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });

  it("disposes the committed session on normal unmount", () => {
    const { result, unmount } = renderHook(() => useDraftSession());
    const s = result.current!;
    expect(s.destroyed).toBe(false);
    unmount();
    expect(s.destroyed).toBe(true);
  });

  it("under Strict Mode, leaves exactly one live session and disposes the discarded one", () => {
    const created: DraftSession[] = [];
    const factory = () => {
      const s = createDraftSession();
      created.push(s);
      return s;
    };

    function Probe() {
      useDraftSession(factory);
      return null;
    }

    const { unmount } = render(
      createElement(StrictMode, null, createElement(Probe)),
    );

    // Strict Mode ran the creation effect twice (mount → cleanup → mount).
    expect(created.length).toBe(2);
    // Exactly one live session; the speculative one was disposed.
    expect(created.filter((s) => !s.destroyed)).toHaveLength(1);

    unmount();
    // After unmount, none remain live.
    expect(created.filter((s) => !s.destroyed)).toHaveLength(0);
  });
});

describe("session primitives are the expected Yjs/awareness types", () => {
  it("exposes Y.Doc / Y.Text / Awareness / Y.UndoManager", () => {
    const s = createDraftSession();
    try {
      expect(s.doc).toBeInstanceOf(Y.Doc);
      expect(s.text).toBeInstanceOf(Y.Text);
      expect(s.awareness).toBeInstanceOf(Awareness);
      expect(s.undoManager).toBeInstanceOf(Y.UndoManager);
    } finally {
      s.destroy();
    }
  });
});
