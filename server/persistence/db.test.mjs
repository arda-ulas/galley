import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { openDatabase, TransactionRollbackError } from "./db.mjs";
import { LATEST_VERSION } from "./migrations.mjs";
import { assertFileBacked, createTempDb } from "./tmpDb.mjs";

/** @type {Array<{ cleanup: () => Promise<void> }>} */
const temps = [];
async function tmp() {
  const t = await createTempDb();
  temps.push(t);
  return t;
}
afterEach(async () => {
  while (temps.length) await temps.pop().cleanup();
});

describe("openDatabase — initialization & durability enforcement", () => {
  it("sets and verifies WAL + synchronous=FULL, migrates, on a real file", async () => {
    const t = await tmp();
    assertFileBacked(t.dbPath);
    const db = openDatabase(t.dbPath);
    try {
      expect(db.journalMode).toBe("wal");
      expect(db.synchronous).toBe(2);
      expect(db.busyTimeout).toBe(5000);
      expect(db.foreignKeys).toBe(1);
      expect(db.schemaVersion).toBe(LATEST_VERSION);
      expect(db.integrityCheck()).toBe("ok");
      expect(t.exists(t.dbPath)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("reads back the configured busy_timeout", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      expect(db.busyTimeout).toBe(5000);
    } finally {
      db.close();
    }
  });

  it("rejects :memory: and empty paths (no silent in-memory fallback)", () => {
    expect(() => openDatabase(":memory:")).toThrow(/in-memory/i);
    expect(() => openDatabase("")).toThrow(/file path is required/i);
  });

  it("aborts open when WAL cannot be verified", async () => {
    const t = await tmp();
    expect(() => openDatabase(t.dbPath, { faults: { walVerify: true } })).toThrow(
      /WAL was not enabled/i,
    );
  });

  it("aborts open when synchronous=FULL cannot be verified", async () => {
    const t = await tmp();
    expect(() =>
      openDatabase(t.dbPath, { faults: { fullVerify: true } }),
    ).toThrow(/synchronous = FULL/i);
  });

  it("closes the partial handle and surfaces an init failure; reopen works", async () => {
    const t = await tmp();
    expect(() => openDatabase(t.dbPath, { faults: { open: true } })).toThrow(
      /injected open/i,
    );
    const db = openDatabase(t.dbPath); // partial handle was closed → reopen succeeds
    try {
      expect(db.schemaVersion).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });

  it("preserves BOTH init and close failures when cleanup close also fails", async () => {
    const t = await tmp();
    let caught;
    try {
      openDatabase(t.dbPath, { faults: { open: true, initClose: true } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/injected open/i);
    expect(caught.closeError).toBeDefined();
    expect(String(caught.closeError.message)).toMatch(/injected init-close/i);
  });

  it("surfaces an error opening a corrupt file and does not recreate it", async () => {
    const t = await tmp();
    const garbage = Buffer.from("this is not a sqlite database");
    writeFileSync(t.dbPath, garbage);
    expect(() => openDatabase(t.dbPath)).toThrow();
    expect(readFileSync(t.dbPath)).toEqual(garbage); // no destructive recovery
  });

  it("survives graceful close/reopen: data, pragmas, and version persist", async () => {
    const t = await tmp();
    const a = openDatabase(t.dbPath);
    a.persistState("sheet-x", { state: new Uint8Array([7, 7, 7]) });
    a.close();

    const b = openDatabase(t.dbPath);
    try {
      const sheet = b.getSheet("sheet-x");
      expect(sheet.serverRevision).toBe(1);
      expect([...sheet.state]).toEqual([7, 7, 7]);
      expect(b.journalMode).toBe("wal");
      expect(b.synchronous).toBe(2);
      expect(b.schemaVersion).toBe(LATEST_VERSION);
      expect(b.integrityCheck()).toBe("ok");
    } finally {
      b.close();
    }
  });
});

describe("repository — current-state foundation", () => {
  it("starts at revision 1 and increments by exactly 1; round-trips blobs", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const r1 = db.persistState("a", {
        state: new Uint8Array([10, 20]),
        stateVector: new Uint8Array([1]),
      });
      const r2 = db.persistState("a", { state: new Uint8Array([30]) });
      expect(r1.serverRevision).toBe(1);
      expect(r2.serverRevision).toBe(2);
      const sheet = db.getSheet("a");
      expect(sheet.serverRevision).toBe(2);
      expect([...sheet.state]).toEqual([30]);
    } finally {
      db.close();
    }
  });

  it("has explicit null semantics and a finite integer updated_at", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const r = db.persistState("n"); // no payload
      const sheet = db.getSheet("n");
      expect(sheet.state).toBeNull();
      expect(sheet.stateVector).toBeNull();
      expect(Number.isInteger(r.updatedAt)).toBe(true);
      expect(r.updatedAt).toBeGreaterThan(0);
      expect(db.getSheet("missing")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("groups multiple tx writes atomically (commit)", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      db.inTransaction((tx) => {
        tx.persistState("a", { state: new Uint8Array([1]) });
        tx.persistState("b", { state: new Uint8Array([2]) });
      });
      expect(db.getSheet("a").serverRevision).toBe(1);
      expect(db.getSheet("b").serverRevision).toBe(1);
    } finally {
      db.close();
    }
  });

  it("rolls back ALL grouped tx writes when the callback throws", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      expect(() =>
        db.inTransaction((tx) => {
          tx.persistState("c", { state: new Uint8Array([1]) });
          tx.persistState("d", { state: new Uint8Array([2]) });
          throw new Error("group boom");
        }),
      ).toThrow("group boom");
      expect(db.getSheet("c")).toBeNull();
      expect(db.getSheet("d")).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("transaction model — non-nested, tx-scoped, poison-safe", () => {
  it("commits a successful transaction and returns to idle", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const rev = db.inTransaction((tx) => tx.persistState("s", {}).serverRevision);
      expect(rev).toBe(1);
      expect(db.__test.state()).toBe("idle");
    } finally {
      db.close();
    }
  });

  it("recovers after an ordinary failure: a later transaction succeeds", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      expect(() => db.inTransaction(() => { throw new Error("x"); })).toThrow("x");
      expect(db.__test.state()).toBe("idle");
      expect(db.persistState("s", {}).serverRevision).toBe(1);
    } finally {
      db.close();
    }
  });

  it("preserves a primitive thrown value", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      let caught;
      try {
        db.inTransaction(() => { throw 42; });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(42);
      expect(db.__test.state()).toBe("idle");
    } finally {
      db.close();
    }
  });

  it("rejects a nested inTransaction clearly", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      expect(() =>
        db.inTransaction(() => { db.inTransaction(() => {}); }),
      ).toThrow(/already in progress|nested/i);
    } finally {
      db.close();
    }
  });

  it("rejects a top-level repository method inside a transaction (no secret nesting)", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      expect(() =>
        db.inTransaction(() => { db.persistState("x", {}); }),
      ).toThrow(/already in progress|nested/i);
      expect(db.getSheet("x")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("rejects a thenable-returning callback", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      expect(() => db.inTransaction(() => Promise.resolve(1))).toThrow(
        /must be synchronous/i,
      );
    } finally {
      db.close();
    }
  });

  it("BEGIN failure leaves idle state and does not persist", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      db.__test.failNextBegin();
      expect(() => db.inTransaction((tx) => tx.persistState("s", {}))).toThrow(
        /injected BEGIN/i,
      );
      expect(db.__test.state()).toBe("idle");
      // subsequent work is fine
      expect(db.persistState("s", {}).serverRevision).toBe(1);
    } finally {
      db.close();
    }
  });

  it("COMMIT failure poisons the adapter and propagates", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      db.__test.failNextCommit();
      expect(() => db.persistState("s", {})).toThrow(/injected COMMIT/i);
      expect(db.__test.state()).toBe("poisoned");
      // poisoned rejects reads, writes, and transactions
      expect(() => db.getSheet("s")).toThrow(/poisoned/i);
      expect(() => db.persistState("s2", {})).toThrow(/poisoned/i);
      expect(() => db.inTransaction(() => {})).toThrow(/poisoned/i);
    } finally {
      // ...but can still be closed
      expect(() => db.close()).not.toThrow();
    }
  });

  it("ROLLBACK failure wraps the original + rollback error and poisons; still closes", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const original = new Error("work boom");
      db.__test.failNextRollback();
      let caught;
      try {
        db.inTransaction(() => { throw original; });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TransactionRollbackError);
      expect(caught.original).toBe(original);
      expect(caught.cause).toBe(original);
      expect(caught.rollbackError).toBeDefined();
      expect(String(caught.rollbackError.message)).toMatch(/injected ROLLBACK/i);
      expect(caught.message).toMatch(/rollback also failed/i);
      expect(db.__test.state()).toBe("poisoned");
    } finally {
      expect(() => db.close()).not.toThrow(); // poisoned adapter still closes
    }
  });

  it("preserves a primitive original when rollback also fails", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      db.__test.failNextRollback();
      let caught;
      try {
        db.inTransaction(() => { throw "primitive-boom"; });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TransactionRollbackError);
      expect(caught.original).toBe("primitive-boom"); // exact primitive preserved
      expect(caught.rollbackError).toBeDefined();
      expect(db.__test.state()).toBe("poisoned");
    } finally {
      expect(() => db.close()).not.toThrow();
    }
  });

  it("preserves a FROZEN Error original (unmutated) when rollback also fails", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const frozen = Object.freeze(new Error("frozen boom"));
      db.__test.failNextRollback();
      let caught;
      try {
        db.inTransaction(() => { throw frozen; });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TransactionRollbackError);
      expect(caught.original).toBe(frozen);
      expect(caught.rollbackError).toBeDefined();
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(frozen.rollbackError).toBeUndefined(); // original not mutated
    } finally {
      expect(() => db.close()).not.toThrow();
    }
  });

  it("preserves a FROZEN plain object original when rollback also fails", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const frozen = Object.freeze({ code: "X" });
      db.__test.failNextRollback();
      let caught;
      try {
        db.inTransaction(() => { throw frozen; });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TransactionRollbackError);
      expect(caught.original).toBe(frozen);
      expect(caught.rollbackError).toBeDefined();
      expect(frozen).toEqual({ code: "X" }); // unmutated
    } finally {
      expect(() => db.close()).not.toThrow();
    }
  });
});

describe("transaction capability — escaped tx handles are rejected", () => {
  it("rejects a tx retained from a committed transaction (and writes nothing)", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      let escaped;
      db.inTransaction((tx) => {
        escaped = tx;
      });
      expect(() =>
        escaped.persistState("x", { state: new Uint8Array([1]) }),
      ).toThrow(/no longer valid/i);
      expect(db.getSheet("x")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("rejects a tx retained from a rolled-back transaction", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      let escaped;
      expect(() =>
        db.inTransaction((tx) => {
          escaped = tx;
          throw new Error("fail");
        }),
      ).toThrow("fail");
      expect(() => escaped.persistState("x", {})).toThrow(/no longer valid/i);
    } finally {
      db.close();
    }
  });

  it("rejects a tx from transaction A when used during transaction B", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      let escapedA;
      db.inTransaction((txA) => {
        escapedA = txA;
      });
      db.inTransaction(() => {
        // Inside B: A's handle must be rejected (token mismatch).
        expect(() => escapedA.persistState("x", {})).toThrow(/no longer valid/i);
      });
    } finally {
      db.close();
    }
  });

  it("rejects a stale tx after the adapter is poisoned", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      let escaped;
      db.inTransaction((tx) => {
        escaped = tx;
      });
      db.__test.failNextCommit();
      expect(() => db.persistState("p", {})).toThrow(/injected COMMIT/i);
      expect(db.__test.state()).toBe("poisoned");
      expect(() => escaped.persistState("x", {})).toThrow(/no longer valid/i);
    } finally {
      expect(() => db.close()).not.toThrow();
    }
  });

  it("rejects a stale tx after the adapter is closed", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    let escaped;
    db.inTransaction((tx) => {
      escaped = tx;
    });
    db.close();
    expect(() => escaped.persistState("x", {})).toThrow(/no longer valid/i);
  });
});

describe("adapter lifecycle — close semantics", () => {
  it("marks closed only after success; second close is a no-op; ops then fail", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    db.close();
    expect(db.__test.state()).toBe("closed");
    expect(() => db.close()).not.toThrow(); // no-op
    expect(() => db.getSheet("s")).toThrow(/closed/i);
    expect(() => db.persistState("s", {})).toThrow(/closed/i);
    expect(() => db.inTransaction(() => {})).toThrow(/closed/i);
  });

  it("a close failure propagates and leaves the adapter retryable", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      db.__test.failNextClose();
      expect(() => db.close()).toThrow(/injected close/i);
      expect(db.__test.state()).not.toBe("closed"); // not marked closed
      // retry succeeds (the fault was one-shot)
      expect(() => db.close()).not.toThrow();
      expect(db.__test.state()).toBe("closed");
    } finally {
      // already closed
    }
  });
});
