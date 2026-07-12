import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db.mjs";
import { createWriteQueue } from "./writeQueue.mjs";
import { createTempDb } from "./tmpDb.mjs";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => setTimeout(r, 0));

/** @type {Array<{ cleanup: () => Promise<void> }>} */
const temps = [];
afterEach(async () => {
  while (temps.length) await temps.pop().cleanup();
});

describe("createWriteQueue — ordering & isolation", () => {
  it("runs same-sheet tasks in enqueue order regardless of duration", async () => {
    const q = createWriteQueue();
    const order = [];
    await Promise.all([
      q.enqueue("s", async () => { await delay(30); order.push("a"); }),
      q.enqueue("s", async () => { await delay(5); order.push("b"); }),
      q.enqueue("s", async () => { await delay(1); order.push("c"); }),
    ]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("lets different sheets interleave their async phases independently", async () => {
    const q = createWriteQueue();
    const order = [];
    await Promise.all([
      q.enqueue("slow", async () => { await delay(30); order.push("slow"); }),
      q.enqueue("fast", async () => { await delay(1); order.push("fast"); }),
    ]);
    expect(order).toEqual(["fast", "slow"]);
  });

  it("does not poison the queue: a failed write still lets later writes run", async () => {
    const q = createWriteQueue();
    const ran = [];
    const failing = q.enqueue("s", async () => { await delay(5); throw new Error("write failed"); });
    const following = q.enqueue("s", async () => { ran.push("after"); return "ok"; });
    await expect(failing).rejects.toThrow("write failed");
    await expect(following).resolves.toBe("ok");
    expect(ran).toEqual(["after"]);
  });

  it("propagates the task's real result and error", async () => {
    const q = createWriteQueue();
    await expect(q.enqueue("s", () => 123)).resolves.toBe(123);
    await expect(q.enqueue("s", () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

describe("createWriteQueue — activeSheets tracking & cleanup", () => {
  it("reports active sheets while work is in flight", async () => {
    const q = createWriteQueue();
    let releaseA;
    const gate = new Promise((r) => { releaseA = r; });
    const p = q.enqueue("a", async () => { await gate; });
    expect(q.activeSheets()).toBe(1);
    releaseA();
    await p;
  });

  it("cleans up the id-map after success (no leak)", async () => {
    const q = createWriteQueue();
    await q.enqueue("a", () => "ok");
    await q.enqueue("b", () => "ok");
    await tick();
    expect(q.activeSheets()).toBe(0);
  });

  it("cleans up the id-map after failure (no leak)", async () => {
    const q = createWriteQueue();
    await expect(q.enqueue("a", () => { throw new Error("x"); })).rejects.toThrow("x");
    await tick();
    expect(q.activeSheets()).toBe(0);
  });
});

describe("createWriteQueue + adapter — real monotonic revisions", () => {
  it("assigns strictly increasing revisions 1..N for concurrent same-sheet writes", async () => {
    const t = await createTempDb();
    temps.push(t);
    const db = openDatabase(t.dbPath);
    try {
      const q = createWriteQueue();
      const N = 12;
      const results = await Promise.all(
        Array.from({ length: N }, () =>
          q.enqueue("sheet-1", () =>
            db.persistState("sheet-1", { state: new Uint8Array([1]) }),
          ),
        ),
      );
      expect(results.map((r) => r.serverRevision)).toEqual(
        Array.from({ length: N }, (_, i) => i + 1),
      );
      expect(db.getSheet("sheet-1").serverRevision).toBe(N);
      await tick();
      expect(q.activeSheets()).toBe(0);
    } finally {
      db.close();
    }
  });
});
