import * as Y from "yjs";

export type Snapshot = {
  id: string;
  text: string;
  createdAt: number;
};

export const SNAPSHOT_IDLE_MS = 1500;

export function createSnapshotRecorder(
  ytext: Y.Text,
  ySnapshots: Y.Array<Snapshot>,
  idleMs: number = SNAPSHOT_IDLE_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function captureSnapshot() {
    const text = ytext.toString();
    if (!text.trim()) return;

    const all = ySnapshots.toArray();
    if (all.length > 0 && all[all.length - 1].text === text) return;

    ySnapshots.push([
      {
        id: crypto.randomUUID(),
        text,
        createdAt: Date.now(),
      },
    ]);
  }

  function onTextChange(_event: Y.YTextEvent, transaction: Y.Transaction) {
    if (!transaction.local) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(captureSnapshot, idleMs);
  }

  ytext.observe(onTextChange);

  return () => {
    ytext.unobserve(onTextChange);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
