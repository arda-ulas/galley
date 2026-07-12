import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import {
  openDatabase,
  PersistenceIntegrityError,
  SCHEMA_VERSION_DDL,
  SheetIdCollisionError,
} from "./db.mjs";
import { LATEST_VERSION } from "./migrations.mjs";
import { createTempDb } from "./tmpDb.mjs";

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

/** Build createSheet params from a mutated content doc. */
function makeParams(overrides = {}) {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, overrides.text ?? "hello");
  const canonicalUpdate = Y.encodeStateAsUpdate(doc);
  const canonicalStateVector = Y.encodeStateVector(doc);
  doc.destroy();
  return {
    sheetId: overrides.sheetId ?? "sheetAAAAAAAAAA1",
    creationToken: overrides.creationToken ?? "token-default",
    canonicalUpdate,
    canonicalStateVector,
    title: overrides.title ?? "my-sheet",
    language: overrides.language ?? "typescript",
    schemaVersion: overrides.schemaVersion ?? 0,
    committedAt: overrides.committedAt ?? 1000,
  };
}

/** Read a single row on a throwaway connection (post-commit, WAL-safe). */
function rawGet(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath);
  const row = db.prepare(sql).get(...params);
  db.close();
  return row;
}

/** Row counts across the three create-path tables. */
function counts(dbPath) {
  const db = new DatabaseSync(dbPath);
  const n = (sql) => Number(db.prepare(sql).get().c);
  const result = {
    sheets: n("SELECT COUNT(*) c FROM sheets"),
    metadata: n("SELECT COUNT(*) c FROM metadata"),
    idempotency: n("SELECT COUNT(*) c FROM idempotency"),
  };
  db.close();
  return result;
}

/** Run against a raw FK-enforcing connection. */
function withRaw(dbPath, fn) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Corrupt persisted rows on a raw connection with FK enforcement explicitly
 * OFF (node:sqlite defaults it ON), so a dangling reference can be created
 * without cascade deleting the receipt. */
function corrupt(dbPath, fn) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

describe("createSheet — successful atomic creation", () => {
  it("creates a sheet at revision 1 with metadata revision 1", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const p = makeParams();
      const r = db.createSheet(p);
      expect(r.alreadyExisted).toBe(false);
      expect(r.sheetId).toBe(p.sheetId);
      expect(r.serverRevision).toBe(1);
      expect(r.committedMetadataRevision).toBe(1);
      expect(r.committedAt).toBe(1000);
      expect([...r.committedStateVector]).toEqual([...p.canonicalStateVector]);
    } finally {
      db.close();
    }
  });

  it("persists state, vector, timestamps, metadata, and the immutable receipt", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    const p = makeParams({ committedAt: 4242, title: "notes", language: "go" });
    try {
      db.createSheet(p);
      const sheet = db.getSheet(p.sheetId);
      expect(sheet.serverRevision).toBe(1);
      expect([...sheet.state]).toEqual([...p.canonicalUpdate]);
      expect([...sheet.stateVector]).toEqual([...p.canonicalStateVector]);
    } finally {
      db.close();
    }

    const extra = rawGet(
      t.dbPath,
      "SELECT created_at, document_schema_version FROM sheets WHERE id = ?",
      p.sheetId,
    );
    expect(Number(extra.created_at)).toBe(4242);
    expect(Number(extra.document_schema_version)).toBe(0);

    const meta = rawGet(
      t.dbPath,
      "SELECT title, language, metadata_revision, updated_at FROM metadata WHERE sheet_id = ?",
      p.sheetId,
    );
    expect(meta.title).toBe("notes");
    expect(meta.language).toBe("go");
    expect(Number(meta.metadata_revision)).toBe(1);
    expect(Number(meta.updated_at)).toBe(4242);

    const receipt = rawGet(
      t.dbPath,
      `SELECT sheet_id, server_revision_at_create, committed_metadata_revision_at_create,
              committed_at, committed_state_vector_at_create
         FROM idempotency WHERE creation_token = ?`,
      p.creationToken,
    );
    expect(receipt.sheet_id).toBe(p.sheetId);
    expect(Number(receipt.server_revision_at_create)).toBe(1);
    expect(Number(receipt.committed_metadata_revision_at_create)).toBe(1);
    expect(Number(receipt.committed_at)).toBe(4242);
    expect([...receipt.committed_state_vector_at_create]).toEqual([
      ...p.canonicalStateVector,
    ]);
  });

  it("retains state, vector, metadata, and receipt across close/reopen", async () => {
    const t = await tmp();
    const p = makeParams({ text: "durable body", committedAt: 99 });
    const a = openDatabase(t.dbPath);
    a.createSheet(p);
    a.close();

    const b = openDatabase(t.dbPath);
    try {
      const sheet = b.getSheet(p.sheetId);
      expect(sheet.serverRevision).toBe(1);
      expect([...sheet.state]).toEqual([...p.canonicalUpdate]);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(sheet.state));
      expect(doc.getText("content").toString()).toBe("durable body");
      doc.destroy();
    } finally {
      b.close();
    }

    const meta = rawGet(
      t.dbPath,
      "SELECT metadata_revision FROM metadata WHERE sheet_id = ?",
      p.sheetId,
    );
    expect(Number(meta.metadata_revision)).toBe(1);
    const receipt = rawGet(
      t.dbPath,
      "SELECT sheet_id FROM idempotency WHERE creation_token = ?",
      p.creationToken,
    );
    expect(receipt.sheet_id).toBe(p.sheetId);
  });
});

describe("createSheet — idempotent replay from the immutable receipt", () => {
  it("replays the same token: returns the receipt, inserts exactly once", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const first = db.createSheet(
        makeParams({ creationToken: "tok-r", sheetId: "sheetRRRRRRRRRR1", title: "orig" }),
      );
      const replay = db.createSheet(
        makeParams({ creationToken: "tok-r", sheetId: "sheetXXXXXXXXXX2", title: "changed" }),
      );
      expect(replay.alreadyExisted).toBe(true);
      expect(replay.sheetId).toBe(first.sheetId);
      expect(replay.serverRevision).toBe(1);
      expect(replay.committedMetadataRevision).toBe(1);
      expect(counts(t.dbPath)).toEqual({ sheets: 1, metadata: 1, idempotency: 1 });
    } finally {
      db.close();
    }
  });

  it("returns the ORIGINAL receipt even after later state + metadata changes", async () => {
    const t = await tmp();
    const p = makeParams({
      creationToken: "tok-imm",
      sheetId: "sheetIMM0000000A",
      committedAt: 700,
    });
    const db = openDatabase(t.dbPath);
    try {
      const created = db.createSheet(p);
      const originalVector = [...created.committedStateVector];

      // Later state write bumps revision and changes the current vector.
      db.persistState(p.sheetId, {
        state: new Uint8Array([9, 9]),
        stateVector: new Uint8Array([1, 2, 3]),
      });
      expect(db.getSheet(p.sheetId).serverRevision).toBe(2);

      // Replay still yields the creation-time receipt, not the latest state.
      const replay = db.createSheet(
        makeParams({ creationToken: "tok-imm", sheetId: "sheetLATER00000A", committedAt: 999 }),
      );
      expect(replay.alreadyExisted).toBe(true);
      expect(replay.sheetId).toBe(p.sheetId);
      expect(replay.serverRevision).toBe(1);
      expect(replay.committedMetadataRevision).toBe(1);
      expect(replay.committedAt).toBe(700);
      expect([...replay.committedStateVector]).toEqual(originalVector);
    } finally {
      db.close();
    }
  });

  it("ignores direct metadata mutation and still returns the receipt revision", async () => {
    const t = await tmp();
    const p = makeParams({ creationToken: "tok-mm", sheetId: "sheetMM00000000A" });
    const db = openDatabase(t.dbPath);
    db.createSheet(p);
    db.close();

    // Bump the current metadata revision directly.
    corrupt(t.dbPath, (raw) =>
      raw
        .prepare("UPDATE metadata SET metadata_revision = 5 WHERE sheet_id = ?")
        .run(p.sheetId),
    );

    const db2 = openDatabase(t.dbPath);
    try {
      const replay = db2.createSheet(makeParams({ creationToken: "tok-mm", sheetId: "x" }));
      expect(replay.committedMetadataRevision).toBe(1); // receipt value, not 5
    } finally {
      db2.close();
    }
  });

  it("replays the receipt after a restart (lost-response retry)", async () => {
    const t = await tmp();
    const p = makeParams({ creationToken: "tok-rs", sheetId: "sheetRS00000000A", committedAt: 321 });
    const a = openDatabase(t.dbPath);
    const created = a.createSheet(p);
    a.close();

    const b = openDatabase(t.dbPath);
    try {
      const replay = b.createSheet(makeParams({ creationToken: "tok-rs", sheetId: "x", committedAt: 1 }));
      expect(replay.alreadyExisted).toBe(true);
      expect(replay.sheetId).toBe(created.sheetId);
      expect(replay.serverRevision).toBe(1);
      expect(replay.committedAt).toBe(321);
      expect([...replay.committedStateVector]).toEqual([
        ...created.committedStateVector,
      ]);
    } finally {
      b.close();
    }
  });
});

describe("createSheet — id collision", () => {
  it("throws SheetIdCollisionError on a duplicate id and leaves no partial rows", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const first = db.createSheet(
        makeParams({ sheetId: "sheetDUP0000000A", creationToken: "tok-a" }),
      );
      expect(first.alreadyExisted).toBe(false);

      expect(() =>
        db.createSheet(
          makeParams({ sheetId: "sheetDUP0000000A", creationToken: "tok-b" }),
        ),
      ).toThrow(SheetIdCollisionError);

      expect(counts(t.dbPath)).toEqual({ sheets: 1, metadata: 1, idempotency: 1 });
      expect(db.__test.state()).toBe("idle");
    } finally {
      db.close();
    }
  });
});

describe("createSheet — atomic rollback at each insert boundary", () => {
  for (const step of ["sheet", "metadata", "idempotency"]) {
    it(`rolls back all rows when it fails right after the ${step} insert`, async () => {
      const t = await tmp();
      const db = openDatabase(t.dbPath);
      try {
        db.__test.failCreateSheetAfter(step);
        const p = makeParams();
        expect(() => db.createSheet(p)).toThrow(new RegExp(`after ${step} insert`, "i"));

        expect(counts(t.dbPath)).toEqual({ sheets: 0, metadata: 0, idempotency: 0 });
        expect(db.getSheet(p.sheetId)).toBeNull();

        const ok = db.createSheet(p);
        expect(ok.alreadyExisted).toBe(false);
        expect(ok.serverRevision).toBe(1);
        expect(counts(t.dbPath)).toEqual({ sheets: 1, metadata: 1, idempotency: 1 });
      } finally {
        db.close();
      }
    });
  }
});

describe("createSheet — replay integrity failures (typed, not TypeError)", () => {
  // A well-formed single-client vector and hand-built malformed variants. These
  // exercise the strict receipt-vector parser without asserting any historical
  // relationship to the sheet — only syntactic validity is checked on replay.
  const setVector = (raw, token, bytes) =>
    raw
      .prepare(
        "UPDATE idempotency SET committed_state_vector_at_create = ? WHERE creation_token = ?",
      )
      .run(bytes, token);
  const setColumn = (column) => (raw, token, value) =>
    raw
      .prepare(`UPDATE idempotency SET ${column} = ? WHERE creation_token = ?`)
      .run(value, token);

  /** Run fn, returning the thrown error (or undefined) — captured exactly once. */
  function captureThrow(fn) {
    try {
      fn();
      return undefined;
    } catch (e) {
      return e;
    }
  }

  /**
   * Create one sheet+receipt (file-backed), apply a raw corruption with FK OFF,
   * reopen, and replay the token exactly once. Asserts a typed integrity error
   * with a safe message and that the adapter remains usable (idle).
   */
  async function expectReplayIntegrity(corruptFn, match) {
    const t = await tmp();
    const token = "tok-corrupt";
    const sheetId = "sheetCORRUPT001A";
    const a = openDatabase(t.dbPath);
    a.createSheet(makeParams({ creationToken: token, sheetId }));
    a.close();

    corrupt(t.dbPath, (raw) => corruptFn(raw, token, sheetId));

    const db = openDatabase(t.dbPath);
    try {
      const err = captureThrow(() =>
        db.createSheet(makeParams({ creationToken: token, sheetId: "sheetREPLAY0001A" })),
      );
      expect(err).toBeInstanceOf(PersistenceIntegrityError);
      expect(err.message).toMatch(match);
      // Safe message: no SQLite/parser internals leaked.
      expect(err.message).not.toMatch(/sqlite|varint|lib0|decoder/i);
      expect(db.__test.state()).toBe("idle");
    } finally {
      db.close();
    }
  }

  const cases = [
    // Referenced-row existence (shape valid, rows missing).
    {
      name: "dangling receipt → missing sheet row",
      corrupt: (raw, _t, id) => raw.prepare("DELETE FROM sheets WHERE id = ?").run(id),
      match: /missing sheet/i,
    },
    {
      name: "missing metadata row",
      corrupt: (raw, _t, id) => raw.prepare("DELETE FROM metadata WHERE sheet_id = ?").run(id),
      match: /missing metadata/i,
    },
    // Stored-vector strict parsing.
    {
      name: "empty committed state vector",
      corrupt: (raw, token) => setVector(raw, token, new Uint8Array(0)),
      match: /state vector/i,
    },
    {
      name: "non-empty malformed vector",
      corrupt: (raw, token) => setVector(raw, token, new Uint8Array([0xff])),
      match: /state vector/i,
    },
    {
      name: "vector with trailing bytes",
      corrupt: (raw, token) => setVector(raw, token, new Uint8Array([0x01, 0x05, 0x01, 0x00])),
      match: /state vector/i,
    },
    {
      name: "vector with a duplicate client id",
      corrupt: (raw, token) => setVector(raw, token, new Uint8Array([0x02, 0x05, 0x01, 0x05, 0x02])),
      match: /state vector/i,
    },
    {
      name: "vector with a truncated varint",
      corrupt: (raw, token) => setVector(raw, token, new Uint8Array([0x01, 0x05])),
      match: /state vector/i,
    },
    // Numeric fields — raw type checks, no coercion.
    {
      name: "server revision not exactly 1",
      corrupt: setColumn("server_revision_at_create"),
      value: 2,
      match: /server revision/i,
    },
    {
      name: "server revision stored as text",
      corrupt: setColumn("server_revision_at_create"),
      value: "not-a-number",
      match: /server revision/i,
    },
    {
      name: "metadata revision not exactly 1",
      corrupt: setColumn("committed_metadata_revision_at_create"),
      value: 7,
      match: /metadata revision/i,
    },
    {
      name: "committed_at fractional",
      corrupt: setColumn("committed_at"),
      value: 2.5,
      match: /timestamp/i,
    },
    {
      name: "committed_at negative",
      corrupt: setColumn("committed_at"),
      value: -5,
      match: /timestamp/i,
    },
    {
      name: "committed_at stored as text",
      corrupt: setColumn("committed_at"),
      value: "not-a-number",
      match: /timestamp/i,
    },
    {
      name: "committed_at beyond safe integer range",
      corrupt: setColumn("committed_at"),
      value: 9007199254740993n, // unreadable as a JS number
      match: /could not be read/i,
    },
    // Sheet-id shape (must match the 16-char base64url minted format).
    {
      name: "sheet id with an invalid length",
      corrupt: setColumn("sheet_id"),
      value: "short",
      match: /sheet id/i,
    },
    {
      name: "sheet id with an invalid alphabet",
      corrupt: setColumn("sheet_id"),
      value: "sheet/invalid16A",
      match: /sheet id/i,
    },
    {
      name: "empty sheet id",
      corrupt: setColumn("sheet_id"),
      value: "",
      match: /sheet id/i,
    },
  ];

  for (const c of cases) {
    it(`rejects: ${c.name}`, async () => {
      const corruptFn =
        "value" in c ? (raw, token) => c.corrupt(raw, token, c.value) : c.corrupt;
      await expectReplayIntegrity(corruptFn, c.match);
    });
  }

  it("converts ONLY an out-of-range receipt read into a typed integrity error", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      const rangeErr = new RangeError("value is too large");
      rangeErr.code = "ERR_OUT_OF_RANGE";
      db.__test.failNextReceiptReadWith(rangeErr);
      let err;
      try {
        db.createSheet(makeParams({ creationToken: "tok-oor", sheetId: "sheetOOR00001A00" }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PersistenceIntegrityError);
      expect(err.message).toMatch(/could not be read/i);
      expect(db.__test.state()).toBe("idle");

      // The fault is one-shot: the very next create succeeds normally.
      const ok = db.createSheet(
        makeParams({ creationToken: "tok-oor-2", sheetId: "sheetOOR00002A00" }),
      );
      expect(ok.alreadyExisted).toBe(false);
      expect(ok.serverRevision).toBe(1);
    } finally {
      db.close();
    }
  });

  it("rethrows an unrelated operational read error unchanged (not mislabeled)", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      // A SQLite-style operational error must propagate as-is, never wrapped as
      // receipt corruption.
      const opErr = new Error("database is locked");
      opErr.code = "SQLITE_BUSY";
      db.__test.failNextReceiptReadWith(opErr);
      let err;
      try {
        db.createSheet(makeParams({ creationToken: "tok-busy", sheetId: "sheetBUSY0001A00" }));
      } catch (e) {
        err = e;
      }
      expect(err).toBe(opErr); // exact same error object
      expect(err).not.toBeInstanceOf(PersistenceIntegrityError);
      expect(err.code).toBe("SQLITE_BUSY");
      expect(db.__test.state()).toBe("idle"); // clean rollback, still usable

      // The fault is one-shot: the very next create succeeds normally.
      const ok = db.createSheet(
        makeParams({ creationToken: "tok-busy-2", sheetId: "sheetBUSY0002A00" }),
      );
      expect(ok.alreadyExisted).toBe(false);
      expect(ok.serverRevision).toBe(1);
    } finally {
      db.close();
    }
  });

  it("remains usable for a fresh create after an integrity error", async () => {
    const t = await tmp();
    const token = "tok-after";
    const sheetId = "sheetAFTER0001A0";
    const a = openDatabase(t.dbPath);
    a.createSheet(makeParams({ creationToken: token, sheetId }));
    a.close();
    corrupt(t.dbPath, (raw) =>
      raw
        .prepare("UPDATE idempotency SET server_revision_at_create = 9 WHERE creation_token = ?")
        .run(token),
    );

    const db = openDatabase(t.dbPath);
    try {
      const err = captureThrow(() =>
        db.createSheet(makeParams({ creationToken: token, sheetId: "sheetREPLAY0002A" })),
      );
      expect(err).toBeInstanceOf(PersistenceIntegrityError);
      const ok = db.createSheet(
        makeParams({ creationToken: "tok-fresh", sheetId: "sheetFRESH00001A" }),
      );
      expect(ok.alreadyExisted).toBe(false);
      expect(ok.serverRevision).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("createSheet — schema, foreign keys, and cascade", () => {
  it("idempotency carries the immutable receipt columns with a NOT NULL vector", async () => {
    const t = await tmp();
    openDatabase(t.dbPath).close();
    const cols = withRaw(t.dbPath, (db) =>
      db.prepare("PRAGMA table_info('idempotency')").all(),
    );
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const name of [
      "creation_token",
      "sheet_id",
      "server_revision_at_create",
      "committed_state_vector_at_create",
      "committed_metadata_revision_at_create",
      "committed_at",
    ]) {
      expect(byName.has(name)).toBe(true);
    }
    expect(byName.get("committed_state_vector_at_create").type).toBe("BLOB");
    expect(byName.get("committed_state_vector_at_create").notnull).toBe(1);
  });

  it("migrates v1 → v2, backfilling created_at and metadata with no receipts", async () => {
    const t = await tmp();
    {
      const db = new DatabaseSync(t.dbPath);
      db.exec(SCHEMA_VERSION_DDL);
      db.prepare("INSERT INTO schema_version (id, version) VALUES (1, 1)").run();
      db.exec(`CREATE TABLE sheets (
        id TEXT PRIMARY KEY, server_revision INTEGER NOT NULL,
        state BLOB, state_vector BLOB, updated_at INTEGER NOT NULL
      );`);
      db.prepare(
        "INSERT INTO sheets (id, server_revision, state, state_vector, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("legacy", 3, null, null, 555);
      db.close();
    }

    const db = openDatabase(t.dbPath);
    expect(db.schemaVersion).toBe(LATEST_VERSION);
    db.close();

    const sheet = rawGet(
      t.dbPath,
      "SELECT created_at, document_schema_version FROM sheets WHERE id = ?",
      "legacy",
    );
    expect(Number(sheet.created_at)).toBe(555);
    expect(Number(sheet.document_schema_version)).toBe(0);

    const meta = rawGet(
      t.dbPath,
      "SELECT title, language, metadata_revision, updated_at FROM metadata WHERE sheet_id = ?",
      "legacy",
    );
    expect(meta.title).toBe("");
    expect(meta.language).toBe("plaintext");
    expect(Number(meta.metadata_revision)).toBe(1);
    expect(Number(meta.updated_at)).toBe(555);

    expect(counts(t.dbPath).idempotency).toBe(0); // none fabricated
  });

  it("enforces the metadata → sheets foreign key", async () => {
    const t = await tmp();
    openDatabase(t.dbPath).close();
    withRaw(t.dbPath, (db) => {
      expect(() =>
        db
          .prepare(
            "INSERT INTO metadata (sheet_id, title, language, metadata_revision, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("ghost", "", "plaintext", 1, 0),
      ).toThrow();
    });
  });

  it("cascades a sheet delete to metadata and idempotency", async () => {
    const t = await tmp();
    const p = makeParams({ sheetId: "sheetCASCADE001A", creationToken: "tok-c" });
    const db = openDatabase(t.dbPath);
    db.createSheet(p);
    db.close();

    withRaw(t.dbPath, (raw) => {
      raw.prepare("DELETE FROM sheets WHERE id = ?").run(p.sheetId);
      const metaCount = Number(
        raw.prepare("SELECT COUNT(*) c FROM metadata WHERE sheet_id = ?").get(p.sheetId).c,
      );
      const idemCount = Number(
        raw.prepare("SELECT COUNT(*) c FROM idempotency WHERE sheet_id = ?").get(p.sheetId).c,
      );
      expect(metaCount).toBe(0);
      expect(idemCount).toBe(0);
    });
  });
});
