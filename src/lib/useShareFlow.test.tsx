import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftSession } from "./draftSession";
import type { ShareReceipt, ShareSuccess } from "./shareCoordinator";
import { peekCreationToken, ROOT_DRAFT_SCOPE } from "./creationToken";
import {
  displayedMetadata,
  metadataEditable,
  shareStatusPhrase,
  useShareFlow,
  type UseShareFlowSeams,
} from "./useShareFlow";

const RECEIPT: ShareReceipt = Object.freeze({
  sheetId: "abcdefghij123456",
  serverRevision: 1,
  committedStateVector: "AA==",
  committedMetadataRevision: 1,
  committedAt: 1,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeSession(): DraftSession {
  return {
    doc: {} as never,
    text: {} as never,
    awareness: {} as never,
    undoManager: {} as never,
    destroyed: false,
    destroy: vi.fn(),
    disposeUnlessTransferred: vi.fn(),
    transferOwnership: vi.fn(),
  };
}

function fakeController() {
  return { phase: "shared" as const, dispose: vi.fn(), attachAndTakeOwnership: vi.fn() };
}

const connectedResult = (controller: ReturnType<typeof fakeController>): ShareSuccess =>
  ({ status: "connected", sheetId: RECEIPT.sheetId, receipt: RECEIPT, controller }) as unknown as ShareSuccess;
const retryablePending = (controller: ReturnType<typeof fakeController>): ShareSuccess =>
  ({
    status: "connection-pending",
    retryable: true,
    sheetId: RECEIPT.sheetId,
    receipt: RECEIPT,
    controller,
    connectError: new Error("x"),
    retryConnect: vi.fn(),
  }) as unknown as ShareSuccess;
const terminalPending = (controller: ReturnType<typeof fakeController>): ShareSuccess =>
  ({
    status: "connection-pending",
    retryable: false,
    sheetId: RECEIPT.sheetId,
    receipt: RECEIPT,
    controller,
    connectError: new Error("x"),
  }) as unknown as ShareSuccess;

function Harness({ seams }: { seams: UseShareFlowSeams }) {
  const { session, state, share, copyLink } = useShareFlow(seams);
  const shown = displayedMetadata(state, "mytitle", "python");
  return (
    <div>
      <span data-testid="ready">{session ? "1" : "0"}</span>
      <span data-testid="kind">{state.kind}</span>
      <span data-testid="phrase">{shareStatusPhrase(state)}</span>
      <span data-testid="editable">{metadataEditable(state) ? "1" : "0"}</span>
      <span data-testid="clip">{"clip" in state ? state.clip : "-"}</span>
      <span data-testid="forceUrl">{"forceUrl" in state && state.forceUrl ? "1" : "0"}</span>
      <span data-testid="url">{"url" in state ? state.url : "-"}</span>
      <span data-testid="shownTitle">{shown.title}</span>
      <span data-testid="shownLang">{shown.language}</span>
      <button onClick={() => share("mytitle", "python")}>share</button>
      <button onClick={copyLink}>copy</button>
    </div>
  );
}

function setup(over: Partial<UseShareFlowSeams> = {}) {
  const session = fakeSession();
  const controller = fakeController();
  const { share: shareImpl, ...restOver } = over;
  const defaultImpl: NonNullable<UseShareFlowSeams["share"]> = async () =>
    connectedResult(controller);
  const share = vi.fn(shareImpl ?? defaultImpl);
  const replaceUrl = vi.fn();
  const copyText = vi.fn(async () => true);
  // Default reconciliation returns authoritative metadata identical to a
  // first-time create so it is a visible no-op; individual tests override it.
  const fetchBootstrap = vi.fn(async () => ({
    sheetId: RECEIPT.sheetId,
    title: "mytitle",
    language: "python" as const,
    schemaVersion: 0,
    serverRevision: 1,
    metadataRevision: 1,
  }));
  const seams: UseShareFlowSeams = {
    createSession: () => session,
    share,
    replaceUrl,
    copyText,
    fetchBootstrap,
    ...restOver,
  };
  const utils = render(<Harness seams={seams} />);
  return { session, controller, share, replaceUrl, copyText, fetchBootstrap, seams, ...utils };
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const META_PENDING = { status: "pending" } as const;
const post = (kind: "shared" | "connecting" | "stopped", clip: "idle" | "copied" | "failed") =>
  ({ kind, sheetId: "x", url: "u", clip, forceUrl: false, meta: META_PENDING }) as const;

describe("shareStatusPhrase / metadataEditable (pure, exact copy)", () => {
  it("maps every state to the exact approved phrase", () => {
    expect(shareStatusPhrase({ kind: "local" })).toBe("Local draft — not uploaded");
    expect(shareStatusPhrase({ kind: "sharing" })).toBe("Sharing…");
    expect(shareStatusPhrase(post("shared", "idle"))).toBe("Shared");
    expect(shareStatusPhrase(post("shared", "copied"))).toBe("Shared · link copied");
    expect(shareStatusPhrase(post("connecting", "idle"))).toBe("Connecting…");
    expect(shareStatusPhrase(post("stopped", "idle"))).toBe("Connection stopped.");
    expect(shareStatusPhrase({ kind: "failed" })).toBe("Couldn’t share — your draft is safe here");
  });

  it("is editable only while local or failed", () => {
    expect(metadataEditable({ kind: "local" })).toBe(true);
    expect(metadataEditable({ kind: "failed" })).toBe(true);
    expect(metadataEditable({ kind: "sharing" })).toBe(false);
    expect(metadataEditable(post("shared", "idle"))).toBe(false);
  });
});

describe("useShareFlow — local → sharing → shared", () => {
  it("freezes the request metadata, replaces the URL, then clears the token", async () => {
    const d = deferred<ShareSuccess>();
    const { share, replaceUrl, controller } = setup({ share: () => d.promise });
    expect(screen.getByTestId("kind").textContent).toBe("local");

    fireEvent.click(screen.getByText("share"));
    expect(screen.getByTestId("kind").textContent).toBe("sharing");
    // Frozen request values captured at click time.
    expect(share).toHaveBeenCalledTimes(1);
    const input = share.mock.calls[0][0];
    expect(input.title).toBe("mytitle");
    expect(input.language).toBe("python");
    // Token exists while in flight; URL not yet replaced.
    expect(peekCreationToken(ROOT_DRAFT_SCOPE)).not.toBeNull();
    expect(replaceUrl).not.toHaveBeenCalled();

    await act(async () => {
      d.resolve(connectedResult(controller));
    });

    expect(screen.getByTestId("kind").textContent).toBe("shared");
    expect(replaceUrl).toHaveBeenCalledWith(RECEIPT);
    // Token cleared ONLY after adoption + URL replacement.
    expect(peekCreationToken(ROOT_DRAFT_SCOPE)).toBeNull();
    // Metadata now locked.
    expect(screen.getByTestId("editable").textContent).toBe("0");
  });

  it("suppresses a duplicate activation while sharing", async () => {
    const d = deferred<ShareSuccess>();
    const { share } = setup({ share: () => d.promise });
    fireEvent.click(screen.getByText("share"));
    fireEvent.click(screen.getByText("share"));
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(connectedResult(fakeController())));
  });
});

describe("useShareFlow — every success shape replaces the URL", () => {
  it.each([
    ["connected", connectedResult, "shared"],
    ["retryable pending", retryablePending, "connecting"],
    ["terminal pending", terminalPending, "stopped"],
  ] as const)("%s → URL replaced, kind %s", async (_label, mk, expectedKind) => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    const { replaceUrl } = setup({ share: () => d.promise, createSession: fakeSession });
    fireEvent.click(screen.getByText("share"));
    await act(async () => d.resolve(mk(controller)));
    expect(replaceUrl).toHaveBeenCalledWith(RECEIPT);
    expect(screen.getByTestId("kind").textContent).toBe(expectedKind);
  });
});

describe("useShareFlow — rejection stays local", () => {
  it("never replaces the URL, retains the token, re-enables metadata", async () => {
    const d = deferred<ShareSuccess>();
    const { replaceUrl } = setup({ share: () => d.promise });
    fireEvent.click(screen.getByText("share"));
    await act(async () => {
      d.reject(new Error("http failed"));
      await d.promise.catch(() => {});
    });
    expect(screen.getByTestId("kind").textContent).toBe("failed");
    expect(screen.getByTestId("phrase").textContent).toBe("Couldn’t share — your draft is safe here");
    expect(replaceUrl).not.toHaveBeenCalled();
    expect(peekCreationToken(ROOT_DRAFT_SCOPE)).not.toBeNull();
    expect(screen.getByTestId("editable").textContent).toBe("1");
  });
});

describe("useShareFlow — in-flight unmount lease", () => {
  it("abandoned SUCCESS disposes the controller and keeps the token (no URL replace)", async () => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    const { replaceUrl, unmount } = setup({ share: () => d.promise });
    fireEvent.click(screen.getByText("share"));
    unmount(); // unmount while the share is in flight
    await act(async () => d.resolve(connectedResult(controller)));
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    expect(replaceUrl).not.toHaveBeenCalled();
    expect(peekCreationToken(ROOT_DRAFT_SCOPE)).not.toBeNull();
  });

  it("abandoned REJECTION disposes the still-local session and keeps the token", async () => {
    const d = deferred<ShareSuccess>();
    const session = fakeSession();
    const { unmount } = setup({ share: () => d.promise, createSession: () => session });
    fireEvent.click(screen.getByText("share"));
    unmount();
    await act(async () => {
      d.reject(new Error("pre-transfer"));
      await d.promise.catch(() => {});
    });
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(peekCreationToken(ROOT_DRAFT_SCOPE)).not.toBeNull();
  });

  it("normal local unmount (no share) disposes via disposeUnlessTransferred", () => {
    const session = fakeSession();
    const { unmount } = setup({ createSession: () => session });
    unmount();
    expect(session.disposeUnlessTransferred).toHaveBeenCalledTimes(1);
    expect(session.destroy).not.toHaveBeenCalled();
  });

  it("adopted + mounted unmount disposes via the controller (not the session)", async () => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    const session = fakeSession();
    const { unmount } = setup({ share: () => d.promise, createSession: () => session });
    fireEvent.click(screen.getByText("share"));
    await act(async () => d.resolve(connectedResult(controller)));
    unmount();
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    expect(session.disposeUnlessTransferred).not.toHaveBeenCalled();
  });
});

describe("useShareFlow — clipboard is independent", () => {
  it("success briefly shows `Shared · link copied`", async () => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    setup({ share: () => d.promise, copyText: async () => true });
    fireEvent.click(screen.getByText("share"));
    await act(async () => d.resolve(connectedResult(controller)));
    await waitFor(() =>
      expect(screen.getByTestId("phrase").textContent).toBe("Shared · link copied"),
    );
    expect(screen.getByTestId("clip").textContent).toBe("copied");
  });

  it("failure keeps `Shared` and marks the clip failed (URL fallback)", async () => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    setup({ share: () => d.promise, copyText: async () => false });
    fireEvent.click(screen.getByText("share"));
    await act(async () => d.resolve(connectedResult(controller)));
    await waitFor(() => expect(screen.getByTestId("clip").textContent).toBe("failed"));
    expect(screen.getByTestId("phrase").textContent).toBe("Shared");
  });
});

describe("useShareFlow — creation-token acquisition failure keeps the draft local", () => {
  it("a throwing token store issues NO POST and moves to failed (draft still editable)", () => {
    const share = vi.fn(async () => connectedResult(fakeController()));
    setup({
      share,
      getToken: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    fireEvent.click(screen.getByText("share"));
    // No POST, no Sharing… strand — the UI is in the failed state and editable.
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByTestId("kind").textContent).toBe("failed");
    expect(screen.getByTestId("editable").textContent).toBe("1");
    // The local session remains available (editor still mounted).
    expect(screen.getByTestId("ready").textContent).toBe("1");
  });
});

describe("useShareFlow — replaceState failure retains the durable success", () => {
  it.each([
    ["connected", connectedResult, "shared"],
    ["retryable pending", retryablePending, "connecting"],
    ["terminal pending", terminalPending, "stopped"],
  ] as const)(
    "%s: keeps the connection-derived state, exposes the URL, retains token+controller, no clipboard",
    async (_label, mk, expectedKind) => {
      const d = deferred<ShareSuccess>();
      const controller = fakeController();
      const replaceUrl = vi.fn(() => {
        throw new Error("replaceState blocked");
      });
      const { copyText, unmount } = setup({ share: () => d.promise, replaceUrl });
      fireEvent.click(screen.getByText("share"));
      await act(async () => d.resolve(mk(controller)));

      // Connection-derived state preserved; never a rollback to local/failed.
      expect(screen.getByTestId("kind").textContent).toBe(expectedKind);
      // The absolute URL is exposed through the fallback (address bar untrusted).
      expect(screen.getByTestId("forceUrl").textContent).toBe("1");
      expect(screen.getByTestId("url").textContent).toContain(RECEIPT.sheetId);
      // Clipboard was NOT invoked on a failed URL adoption.
      expect(copyText).not.toHaveBeenCalled();
      // Token retained (never cleared without a successful adoption).
      expect(peekCreationToken(ROOT_DRAFT_SCOPE)).not.toBeNull();
      // Metadata stays locked (ownership transferred durably).
      expect(screen.getByTestId("editable").textContent).toBe("0");
      // Controller retained: unmount disposes it exactly once.
      unmount();
      expect(controller.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it("a token-clear failure after a SUCCESSFUL adoption does not strand or roll back", async () => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    setup({
      share: () => d.promise,
      clearToken: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    fireEvent.click(screen.getByText("share"));
    await act(async () => d.resolve(connectedResult(controller)));
    // Sharing succeeded and is not stranded in Sharing…; the URL fallback is shown.
    expect(screen.getByTestId("kind").textContent).toBe("shared");
    expect(screen.getByTestId("forceUrl").textContent).toBe("1");
  });
});

describe("useShareFlow — terminal callback after unmount is inert", () => {
  it("a queued terminal firing post-unmount performs no state update and does not warn", async () => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    let capturedOnTerminal: (() => void) | undefined;
    const share = vi.fn((input: Parameters<NonNullable<UseShareFlowSeams["share"]>>[0]) => {
      capturedOnTerminal = input.onTerminal as () => void;
      return d.promise;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = setup({ share });
    fireEvent.click(screen.getByText("share"));
    await act(async () => d.resolve(connectedResult(controller)));
    // Adopted while mounted, then unmount (controller disposed exactly once).
    unmount();
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    // A previously queued terminal callback now fires — it must be a no-op.
    expect(() => capturedOnTerminal?.()).not.toThrow();
    // No React state-update-after-unmount warning was emitted.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("useShareFlow — authoritative metadata reconciliation", () => {
  it("a stale-token recovery locks AUTHORITATIVE metadata, not the fresh local values", async () => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    // The durable sheet differs from the fresh local draft ("mytitle"/"python").
    const fetchBootstrap = vi.fn(async () => ({
      sheetId: RECEIPT.sheetId,
      title: "durable-title",
      language: "javascript" as const,
      schemaVersion: 0,
      serverRevision: 2,
      metadataRevision: 2,
    }));
    setup({ share: () => d.promise, fetchBootstrap });
    fireEvent.click(screen.getByText("share"));
    await act(async () => d.resolve(connectedResult(controller)));
    await waitFor(() => expect(screen.getByTestId("shownTitle").textContent).toBe("durable-title"));
    expect(screen.getByTestId("shownLang").textContent).toBe("javascript");
    expect(fetchBootstrap).toHaveBeenCalledWith(RECEIPT.sheetId);
  });

  it("never shows fresh local metadata while authoritative bootstrap is still pending", async () => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    // Bootstrap stays UNRESOLVED, so the state remains in the pending-meta window.
    const boot = deferred<Awaited<ReturnType<NonNullable<UseShareFlowSeams["fetchBootstrap"]>>>>();
    setup({ share: () => d.promise, fetchBootstrap: () => boot.promise });
    fireEvent.click(screen.getByText("share"));
    await act(async () => d.resolve(connectedResult(controller)));
    // Adopted + locked, but authoritative metadata has NOT arrived: the fresh
    // local values ("mytitle"/"python") must not be visible — neutral instead.
    expect(screen.getByTestId("kind").textContent).toBe("shared");
    expect(screen.getByTestId("editable").textContent).toBe("0");
    expect(screen.getByTestId("shownTitle").textContent).toBe("");
    expect(screen.getByTestId("shownLang").textContent).toBe("plaintext");
    expect(screen.getByTestId("shownTitle").textContent).not.toBe("mytitle");
    // Once authoritative metadata resolves, it is rendered (still read-only).
    await act(async () => {
      boot.resolve({
        sheetId: RECEIPT.sheetId,
        title: "authoritative",
        language: "javascript",
        schemaVersion: 0,
        serverRevision: 2,
        metadataRevision: 2,
      });
    });
    await waitFor(() => expect(screen.getByTestId("shownTitle").textContent).toBe("authoritative"));
    expect(screen.getByTestId("editable").textContent).toBe("0");
  });

  it("a reconciliation failure shows neutral metadata, never the fresh local values", async () => {
    const d = deferred<ShareSuccess>();
    const controller = fakeController();
    const fetchBootstrap = vi.fn(async () => null);
    setup({ share: () => d.promise, fetchBootstrap });
    fireEvent.click(screen.getByText("share"));
    await act(async () => d.resolve(connectedResult(controller)));
    await waitFor(() => expect(screen.getByTestId("shownLang").textContent).toBe("plaintext"));
    expect(screen.getByTestId("shownTitle").textContent).toBe("");
  });
});
