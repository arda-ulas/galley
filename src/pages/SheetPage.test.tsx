import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDraftSession, type DraftSession } from "../lib/draftSession";
import type { OpenSheetOptions, OpenSheetOutcome } from "../lib/sheetSession";
import { openSheetSession } from "../lib/sheetSession";
import { SheetPage } from "./SheetPage";

vi.mock("../lib/sheetSession", async (orig) => {
  const actual = await orig<typeof import("../lib/sheetSession")>();
  return { ...actual, openSheetSession: vi.fn() };
});
const mockedOpen = vi.mocked(openSheetSession);

const SHEET_ID = "abcdefghij123456";
const sessions: DraftSession[] = [];

afterEach(() => {
  cleanup();
  while (sessions.length) sessions.pop()!.destroy();
  vi.clearAllMocks();
});

function readySession(): DraftSession {
  const s = createDraftSession();
  sessions.push(s);
  return s;
}
function fakeController() {
  return { phase: "shared" as const, dispose: vi.fn(), attachAndTakeOwnership: vi.fn() };
}

describe("SheetPage — render matrix", () => {
  it("shows Connecting… and no editor before the open resolves", () => {
    mockedOpen.mockReturnValue(new Promise<OpenSheetOutcome>(() => {}));
    render(<SheetPage sheetId={SHEET_ID} />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code editor")).toBeNull();
  });

  it("mounts the editor with read-only metadata and `Shared` on ready", async () => {
    const session = readySession();
    mockedOpen.mockResolvedValue({
      status: "ready",
      controller: fakeController() as never,
      session,
      bootstrap: {
        sheetId: SHEET_ID,
        title: "joined-title",
        language: "typescript",
        schemaVersion: 0,
        serverRevision: 1,
        metadataRevision: 1,
      },
    });
    render(<SheetPage sheetId={SHEET_ID} />);
    await waitFor(() => expect(screen.getByLabelText("Code editor")).toBeInTheDocument());
    expect(screen.getByText("Shared")).toBeInTheDocument();
    const title = screen.getByLabelText("Sheet title") as HTMLInputElement;
    expect(title.value).toBe("joined-title");
    expect(title.readOnly).toBe(true);
    expect((screen.getByLabelText("Sheet language") as HTMLSelectElement).disabled).toBe(true);
  });

  it("keeps the editor mounted and shows `Connection stopped.` on terminal after sync", async () => {
    const session = readySession();
    let captured: OpenSheetOptions | undefined;
    mockedOpen.mockImplementation((opts) => {
      captured = opts;
      return Promise.resolve<OpenSheetOutcome>({
        status: "ready",
        controller: fakeController() as never,
        session,
        bootstrap: {
          sheetId: SHEET_ID,
          title: "t",
          language: "typescript",
          schemaVersion: 0,
          serverRevision: 1,
          metadataRevision: 1,
        },
      });
    });
    render(<SheetPage sheetId={SHEET_ID} />);
    await waitFor(() => expect(screen.getByLabelText("Code editor")).toBeInTheDocument());

    act(() => {
      captured?.onStopped?.({ code: 4500, reason: "corrupt" });
    });
    expect(screen.getByText("Connection stopped.")).toBeInTheDocument();
    // Editor stays mounted (locally editable).
    expect(screen.getByLabelText("Code editor")).toBeInTheDocument();
  });

  it("renders the neutral unavailable surface on unavailable", async () => {
    mockedOpen.mockResolvedValue({ status: "unavailable" });
    render(<SheetPage sheetId={SHEET_ID} />);
    await waitFor(() =>
      expect(screen.getByText("This link is unavailable")).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Code editor")).toBeNull();
  });

  it("renders the open-failure copy on error", async () => {
    mockedOpen.mockResolvedValue({ status: "error" });
    render(<SheetPage sheetId={SHEET_ID} />);
    await waitFor(() =>
      expect(screen.getByText("This sheet couldn’t be opened.")).toBeInTheDocument(),
    );
  });

  it("renders `Connection stopped.` with no editor on a pre-sync terminal", async () => {
    mockedOpen.mockResolvedValue({ status: "stopped" });
    render(<SheetPage sheetId={SHEET_ID} />);
    await waitFor(() =>
      expect(screen.getByText("Connection stopped.")).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Code editor")).toBeNull();
  });

  it("treats an unexpected rejected open as an open error (no unhandled rejection)", async () => {
    mockedOpen.mockRejectedValue(new Error("should have totalized"));
    render(<SheetPage sheetId={SHEET_ID} />);
    await waitFor(() =>
      expect(screen.getByText("This sheet couldn’t be opened.")).toBeInTheDocument(),
    );
  });
});

describe("SheetPage — generation safety", () => {
  function readyOutcome(controller: ReturnType<typeof fakeController>, title = "t"): OpenSheetOutcome {
    return {
      status: "ready",
      controller: controller as never,
      session: readySession(),
      bootstrap: {
        sheetId: SHEET_ID,
        title,
        language: "typescript",
        schemaVersion: 0,
        serverRevision: 1,
        metadataRevision: 1,
      },
    };
  }

  it("Strict Mode double-invoke publishes exactly one controller and disposes the stale one", async () => {
    const controllers: ReturnType<typeof fakeController>[] = [];
    mockedOpen.mockImplementation(() => {
      const c = fakeController();
      controllers.push(c);
      return Promise.resolve(readyOutcome(c));
    });
    const { unmount } = render(
      <StrictMode>
        <SheetPage sheetId={SHEET_ID} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByLabelText("Code editor")).toBeInTheDocument());
    // Two invocations under Strict Mode; the first (stale) controller is disposed.
    expect(controllers.length).toBe(2);
    expect(controllers[0].dispose).toHaveBeenCalledTimes(1);
    expect(controllers[1].dispose).not.toHaveBeenCalled();
    // The surviving published controller is disposed exactly once on unmount.
    unmount();
    expect(controllers[1].dispose).toHaveBeenCalledTimes(1);
  });

  it("a route sheetId change immediately leaves ready rendering and shows Connecting…", async () => {
    const first = fakeController();
    mockedOpen.mockImplementationOnce(() => Promise.resolve(readyOutcome(first, "first")));
    // Second id: a never-resolving open keeps the page connecting.
    mockedOpen.mockImplementationOnce(() => new Promise<OpenSheetOutcome>(() => {}));

    const { rerender } = render(<SheetPage sheetId="abcdefghij123456" />);
    await waitFor(() => expect(screen.getByLabelText("Code editor")).toBeInTheDocument());

    rerender(<SheetPage sheetId="ponmlkjihg654321" />);
    // The old editor is gone immediately; the new id shows Connecting…
    expect(screen.queryByLabelText("Code editor")).toBeNull();
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    // The first sheet's controller was disposed when its generation was retired.
    expect(first.dispose).toHaveBeenCalledTimes(1);
  });

  it("a stale terminal callback after unmount cannot mutate state or throw", async () => {
    let captured: OpenSheetOptions | undefined;
    const controller = fakeController();
    mockedOpen.mockImplementation((opts) => {
      captured = opts;
      return Promise.resolve(readyOutcome(controller));
    });
    const { unmount } = render(<SheetPage sheetId={SHEET_ID} />);
    await waitFor(() => expect(screen.getByLabelText("Code editor")).toBeInTheDocument());
    unmount();
    // A terminal queued for a now-retired generation must be a no-op.
    expect(() => act(() => captured?.onStopped?.({ code: 4500, reason: "corrupt" }))).not.toThrow();
  });
});
