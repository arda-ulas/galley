import { useEffect, useState } from "react";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { DraftEditor } from "../components/DraftEditor";
import type { DraftSession } from "../lib/draftSession";
import type { LanguageId } from "../lib/languages";
import { encodeStandardBase64 } from "../lib/base64";
import type {
  CreateSheetProviderOptions,
  SheetProviderHandle,
} from "../lib/providerFactory";
import { shareDraftSession, type ShareReceipt } from "../lib/shareCoordinator";
import { useShareFlow } from "../lib/useShareFlow";

const VALID_SV = encodeStandardBase64(Y.encodeStateVector(new Y.Doc()));
const RECEIPT: ShareReceipt = Object.freeze({
  sheetId: "abcdefghij123456",
  serverRevision: 1,
  committedStateVector: VALID_SV,
  committedMetadataRevision: 1,
  committedAt: 1,
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

type Rec = {
  createCalls: number;
  connectCalls: number;
  lastOpts?: CreateSheetProviderOptions;
};
function fakeCreateProvider(rec: Rec) {
  return (opts: CreateSheetProviderOptions): SheetProviderHandle => {
    rec.createCalls++;
    rec.lastOpts = opts;
    let destroyed = false;
    return {
      connect() {
        rec.connectCalls++;
      },
      destroy() {
        destroyed = true;
      },
      get destroyed() {
        return destroyed;
      },
    };
  };
}

/** Mirrors DraftPage's real composition (useShareFlow + DraftEditor) but injects
 *  coordinator seams, so the assertion exercises the true share→attach path. */
function ShareHarness({
  fetchImpl,
  rec,
  replaceUrl,
  onSession,
}: {
  fetchImpl: typeof fetch;
  rec: Rec;
  replaceUrl: (r: Readonly<ShareReceipt>) => void;
  onSession: (s: DraftSession) => void;
}) {
  const { session, state, share } = useShareFlow({
    share: (input) =>
      shareDraftSession({ ...input, fetch: fetchImpl, createProvider: fakeCreateProvider(rec) }),
    replaceUrl,
    copyText: async () => true,
  });
  const [language] = useState<LanguageId>("typescript");
  useEffect(() => {
    if (session) onSession(session);
  }, [session, onSession]);
  return (
    <div>
      <span data-testid="kind">{state.kind}</span>
      <button onClick={() => share("t", language)}>share</button>
      {session ? <DraftEditor language={language} session={session} /> : null}
    </div>
  );
}

// jsdom implements no layout, so CodeMirror's measuring (Range/element
// geometry) throws a `getClientRects` TypeError that would otherwise be emitted
// to stderr even though the assertions pass. A narrow, safe geometry shim (an
// empty rect list / zeroed bounding rect) silences the runtime exception without
// weakening any assertion — no measurement result is relied upon here.
beforeAll(() => {
  const emptyRect = (): DOMRect => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  });
  const emptyRectList = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
  Range.prototype.getClientRects = emptyRectList;
  Range.prototype.getBoundingClientRect = emptyRect;
  if (!Element.prototype.getClientRects || Element.prototype.getClientRects.length === 0) {
    Element.prototype.getClientRects = emptyRectList;
  }
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Share does not remount the editor (M4 no-remount guarantee)", () => {
  it("reuses the exact DOM node, doc, awareness, and undo manager across Share", async () => {
    const rec: Rec = { createCalls: 0, connectCalls: 0 };
    const replaceUrl = vi.fn();
    let session!: DraftSession;

    // A deferred create response so we can edit WHILE the share is in flight.
    let resolveFetch!: (r: Response) => void;
    const fetchImpl = (() =>
      new Promise<Response>((r) => (resolveFetch = r))) as unknown as typeof fetch;

    const { container } = render(
      <ShareHarness
        fetchImpl={fetchImpl}
        onSession={(s) => (session = s)}
        rec={rec}
        replaceUrl={replaceUrl}
      />,
    );

    // Editor mounted; capture the live view + DOM node + primitives.
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const cmNode = container.querySelector(".cm-editor")!;
    const view = EditorView.findFromDOM(cmNode as HTMLElement)!;
    expect(view).toBeTruthy();
    const beforeDoc = session.doc;
    const beforeAwareness = session.awareness;
    const beforeUndo = session.undoManager;

    // A pre-Share edit THROUGH the editor (tracked origin ⇒ undoable).
    act(() => {
      view.dispatch({ changes: { from: 0, insert: "PRE" } });
    });
    expect(session.text.toString()).toBe("PRE");
    expect(session.undoManager.undoStack.length).toBeGreaterThan(0);

    // Begin Share; while pending, make another edit.
    fireEvent.click(screen.getByText("share"));
    expect(screen.getByTestId("kind").textContent).toBe("sharing");
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "MID" } });
    });

    // Resolve durable creation + connection.
    await act(async () => {
      resolveFetch(jsonResponse(201, RECEIPT));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("kind").textContent).toBe("shared"));

    // Same editor view + DOM node — no remount.
    expect(container.querySelector(".cm-editor")).toBe(cmNode);
    expect(EditorView.findFromDOM(cmNode as HTMLElement)).toBe(view);
    // Same collaboration primitives, reused (not rebuilt).
    expect(session.doc).toBe(beforeDoc);
    expect(session.awareness).toBe(beforeAwareness);
    expect(session.undoManager).toBe(beforeUndo);
    // Provider attached to the EXACT existing primitives.
    expect(rec.createCalls).toBe(1);
    expect(rec.connectCalls).toBe(1);
    expect(rec.lastOpts?.doc).toBe(beforeDoc);
    expect(rec.lastOpts?.awareness).toBe(beforeAwareness);
    // The edit made DURING share survived.
    expect(session.text.toString()).toBe("PREMID");
    // URL changed via the receipt.
    expect(replaceUrl).toHaveBeenCalledWith(RECEIPT);
    // Pre-Share undo still works through the same manager.
    const lenBefore = session.text.toString().length;
    act(() => {
      session.undoManager.undo();
    });
    expect(session.text.toString().length).toBeLessThan(lenBefore);

    // Clean up the retained shared controller by unmounting.
    cleanup();
  });
});
