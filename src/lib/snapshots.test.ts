import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as Y from "yjs";
import {
  createSnapshotRecorder,
  SNAPSHOT_IDLE_MS,
  type Snapshot,
} from "./snapshots";
import { useSnapshots } from "./useSnapshots";

// ─── createSnapshotRecorder ───────────────────────────────────────────────────

describe("createSnapshotRecorder", () => {
  let testDoc: Y.Doc;
  let ytext: Y.Text;
  let ySnapshots: Y.Array<Snapshot>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    testDoc = new Y.Doc();
    ytext = testDoc.getText("content");
    ySnapshots = testDoc.getArray<Snapshot>("snapshots");
    cleanup = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("creates a snapshot after the debounce idle period", () => {
    cleanup = createSnapshotRecorder(ytext, ySnapshots);

    ytext.insert(0, "hello world");
    expect(ySnapshots.length).toBe(0);

    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS);

    expect(ySnapshots.length).toBe(1);
    expect(ySnapshots.get(0).text).toBe("hello world");
    expect(typeof ySnapshots.get(0).id).toBe("string");
    expect(ySnapshots.get(0).id.length).toBeGreaterThan(0);
    expect(typeof ySnapshots.get(0).createdAt).toBe("number");
  });

  it("does not fire before the idle period elapses", () => {
    cleanup = createSnapshotRecorder(ytext, ySnapshots);

    ytext.insert(0, "partial");
    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS - 1);

    expect(ySnapshots.length).toBe(0);
  });

  it("does not snapshot whitespace-only text", () => {
    cleanup = createSnapshotRecorder(ytext, ySnapshots);

    ytext.insert(0, "   \n\t  ");
    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS);

    expect(ySnapshots.length).toBe(0);
  });

  it("does not add a duplicate when text is unchanged since last snapshot", () => {
    cleanup = createSnapshotRecorder(ytext, ySnapshots);

    ytext.insert(0, "same text");
    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS);
    expect(ySnapshots.length).toBe(1);

    // Delete and re-insert the same content — net text is identical
    ytext.delete(0, ytext.length);
    ytext.insert(0, "same text");
    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS);

    expect(ySnapshots.length).toBe(1);
  });

  it("resets the debounce timer on each edit", () => {
    cleanup = createSnapshotRecorder(ytext, ySnapshots);

    ytext.insert(0, "typing");
    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS / 2);

    ytext.insert(ytext.length, " more");
    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS / 2);

    // Second edit pushed the timer forward — not enough time has elapsed yet
    expect(ySnapshots.length).toBe(0);

    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS);
    expect(ySnapshots.length).toBe(1);
    expect(ySnapshots.get(0).text).toBe("typing more");
  });

  it("cancels the pending timer on cleanup", () => {
    cleanup = createSnapshotRecorder(ytext, ySnapshots);

    ytext.insert(0, "pending text");
    cleanup();
    cleanup = () => {}; // prevent double-cleanup in afterEach

    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS);
    expect(ySnapshots.length).toBe(0);
  });

  it("does not create snapshots for mutations after cleanup (observer removed)", () => {
    cleanup = createSnapshotRecorder(ytext, ySnapshots);

    ytext.insert(0, "before cleanup");
    cleanup();
    cleanup = () => {};

    // Pending timer was cancelled — no snapshot
    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS);
    expect(ySnapshots.length).toBe(0);

    // Further mutations after cleanup must also not create snapshots
    ytext.insert(ytext.length, " and more");
    vi.advanceTimersByTime(SNAPSHOT_IDLE_MS);
    expect(ySnapshots.length).toBe(0);
  });

  it("remote text transactions do not schedule a snapshot in the receiving doc", () => {
    // Two docs representing two connected clients with bidirectional sync
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    docA.on("update", (update: Uint8Array) => Y.applyUpdate(docB, update));
    docB.on("update", (update: Uint8Array) => Y.applyUpdate(docA, update));

    const ytextA = docA.getText("content");
    const ytextB = docB.getText("content");
    const ySnapshotsA = docA.getArray<Snapshot>("snapshots");
    const ySnapshotsB = docB.getArray<Snapshot>("snapshots");

    const cleanupA = createSnapshotRecorder(ytextA, ySnapshotsA);
    const cleanupB = createSnapshotRecorder(ytextB, ySnapshotsB);

    try {
      // Edit in docA — local to A, remote to B
      ytextA.insert(0, "hello from A");
      vi.advanceTimersByTime(SNAPSHOT_IDLE_MS);

      // Only docA's recorder fires. Its snapshot syncs to docB via the update
      // listener above, so both arrays reflect exactly one snapshot — not two.
      expect(ySnapshotsA.length).toBe(1);
      expect(ySnapshotsB.length).toBe(1);
      expect(ySnapshotsA.get(0).id).toBe(ySnapshotsB.get(0).id);
      expect(ySnapshotsA.get(0).text).toBe("hello from A");
    } finally {
      cleanupA();
      cleanupB();
    }
  });
});

// ─── useSnapshots ─────────────────────────────────────────────────────────────

describe("useSnapshots", () => {
  it("returns current array contents on mount", () => {
    const testDoc = new Y.Doc();
    const ySnapshots = testDoc.getArray<Snapshot>("snapshots");
    ySnapshots.push([{ id: "1", text: "initial", createdAt: 1000 }]);

    const { result } = renderHook(() => useSnapshots(ySnapshots));

    expect(result.current).toHaveLength(1);
    expect(result.current[0].text).toBe("initial");
  });

  it("updates state when a new snapshot is pushed", () => {
    const testDoc = new Y.Doc();
    const ySnapshots = testDoc.getArray<Snapshot>("snapshots");

    const { result } = renderHook(() => useSnapshots(ySnapshots));
    expect(result.current).toHaveLength(0);

    act(() => {
      ySnapshots.push([{ id: "2", text: "new snapshot", createdAt: 2000 }]);
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].text).toBe("new snapshot");
  });
});
