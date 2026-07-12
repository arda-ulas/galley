import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import { openDatabase } from "./persistence/db.mjs";
import { createTempDb } from "./persistence/tmpDb.mjs";
import {
  MAX_CANONICAL_STATE_BYTES,
  MAX_SUBMITTED_VECTOR_BYTES,
} from "./limits.mjs";
import { loadValidatedSheet } from "./loadValidatedSheet.mjs";

/** @type {Array<{ cleanup: () => Promise<void> }>} */
const temps = [];
/** @type {Array<{ close: () => void }>} */
const dbs = [];
afterEach(async () => {
  while (dbs.length) {
    try {
      dbs.pop().close();
    } catch {
      // ignore
    }
  }
  while (temps.length) await temps.pop().cleanup();
});

async function open() {
  const t = await createTempDb();
  temps.push(t);
  const db = openDatabase(t.dbPath);
  dbs.push(db);
  return { db, dbPath: t.dbPath };
}

/** Canonical update + vector for a plain-text content doc. */
function canonicalFor(text) {
  const doc = new Y.Doc();
  if (text) doc.getText("content").insert(0, text);
  const update = Y.encodeStateAsUpdate(doc);
  const vector = Y.encodeStateVector(doc);
  doc.destroy();
  return { update, vector };
}

let tokenCounter = 0;
function createValid(db, overrides = {}) {
  const sheetId = overrides.sheetId ?? "sheetAAAAAAAAAA1";
  const text = overrides.text ?? "hello world";
  const { update, vector } = canonicalFor(text);
  db.createSheet({
    sheetId,
    creationToken: `tok-${tokenCounter++}`,
    canonicalUpdate: update,
    canonicalStateVector: vector,
    title: overrides.title ?? "notes",
    language: overrides.language ?? "typescript",
    schemaVersion: 0,
    committedAt: overrides.committedAt ?? 4242,
  });
  return { sheetId, text, update, vector };
}

/** Corrupt persisted rows on a throwaway connection. */
function raw(dbPath, fn) {
  const c = new DatabaseSync(dbPath);
  try {
    return fn(c);
  } finally {
    c.close();
  }
}

describe("loadValidatedSheet — success", () => {
  it("loads a valid sheet with its metadata and revisions", async () => {
    const { db } = await open();
    const { sheetId } = createValid(db, { title: "my sheet", language: "python" });
    const r = loadValidatedSheet({ db, sheetId });
    expect(r.ok).toBe(true);
    expect(r.sheetId).toBe(sheetId);
    expect(r.title).toBe("my sheet");
    expect(r.language).toBe("python");
    expect(r.schemaVersion).toBe(0);
    expect(r.serverRevision).toBe(1);
    expect(r.metadataRevision).toBe(1);
    expect(r.createdAt).toBe(4242);
  });

  it("reconstructs content that matches the original text", async () => {
    const { db } = await open();
    const { sheetId, text } = createValid(db, { text: "reconstruct me exactly" });
    const r = loadValidatedSheet({ db, sheetId });
    expect(r.ok).toBe(true);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, r.canonicalUpdate);
    expect(doc.getText("content").toString()).toBe(text);
    doc.destroy();
  });

  it("returns a canonical vector that corresponds to the reconstructed doc", async () => {
    const { db } = await open();
    const { sheetId } = createValid(db, { text: "vector check" });
    const r = loadValidatedSheet({ db, sheetId });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, r.canonicalUpdate);
    const expected = Y.encodeStateVector(doc);
    doc.destroy();
    expect([...r.canonicalStateVector]).toEqual([...expected]);
  });
});

describe("loadValidatedSheet — distinguished failures", () => {
  it("rejects a malformed sheet id", async () => {
    const { db } = await open();
    expect(loadValidatedSheet({ db, sheetId: "short" })).toEqual({
      ok: false,
      reason: "invalid_id",
    });
  });

  it("distinguishes a missing sheet", async () => {
    const { db } = await open();
    const r = loadValidatedSheet({ db, sheetId: "sheetMISSING0001" });
    expect(r.reason).toBe("missing");
  });

  it("rejects corrupt (undecodable) Yjs bytes", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE sheets SET state = ? WHERE id = ?")
        .run(new Uint8Array([0xff, 0xff, 0xff, 0xff]), sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects a syntactically valid but structurally unsupported state", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    // A Y.Map root is decodable but outside the plain-text allowlist.
    const doc = new Y.Doc();
    doc.getMap("content").set("k", "v");
    const update = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    doc.destroy();
    raw(dbPath, (c) => {
      c.prepare("UPDATE sheets SET state = ?, state_vector = ? WHERE id = ?").run(
        update,
        vector,
        sheetId,
      );
    });
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects a stored state vector that does not match the update", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db, { text: "content present" });
    const emptyVector = canonicalFor("").vector; // empty-doc vector ≠ real state
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE sheets SET state_vector = ? WHERE id = ?")
        .run(emptyVector, sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects an invalid stored language", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    raw(dbPath, (c) =>
      c.prepare("UPDATE metadata SET language = 'ruby' WHERE sheet_id = ?").run(sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects an incompatible document schema version", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE sheets SET document_schema_version = 1 WHERE id = ?")
        .run(sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects an invalid metadata revision", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE metadata SET metadata_revision = 0 WHERE sheet_id = ?")
        .run(sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects a sheet whose metadata row is missing (corruption, not missing)", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    raw(dbPath, (c) =>
      c.prepare("DELETE FROM metadata WHERE sheet_id = ?").run(sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("reports a db_error when a stored integer is unreadable as a JS number", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE sheets SET server_revision = ? WHERE id = ?")
        .run(9007199254740993n, sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("db_error");
  });
});

describe("loadValidatedSheet — strict durable BLOB types", () => {
  const setState = (dbPath, sheetId, value) =>
    raw(dbPath, (c) =>
      c.prepare("UPDATE sheets SET state = ? WHERE id = ?").run(value, sheetId),
    );
  const setVector = (dbPath, sheetId, value) =>
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE sheets SET state_vector = ? WHERE id = ?")
        .run(value, sheetId),
    );

  for (const [name, value] of [
    ["integer", 5],
    ["text", "not binary"],
    ["null", null],
  ]) {
    it(`rejects a ${name} state`, async () => {
      const { db, dbPath } = await open();
      const { sheetId } = createValid(db);
      setState(dbPath, sheetId, value);
      expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
    });
    it(`rejects a ${name} state vector`, async () => {
      const { db, dbPath } = await open();
      const { sheetId } = createValid(db);
      setVector(dbPath, sheetId, value);
      expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
    });
  }

  it("rejects an oversized raw stored state", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    setState(dbPath, sheetId, new Uint8Array(MAX_CANONICAL_STATE_BYTES + 1));
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects an oversized raw stored state vector", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    setVector(dbPath, sheetId, new Uint8Array(MAX_SUBMITTED_VECTOR_BYTES + 1));
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });
});

describe("loadValidatedSheet — non-canonical durable bytes", () => {
  it("rejects a semantically valid but non-canonical stored update", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    // gc:false keeps the deleted item's content; the server re-encoding GCs it,
    // so the bytes decode to the same content but are NOT canonical.
    const d = new Y.Doc({ gc: false });
    const t = d.getText("content");
    t.insert(0, "hello");
    t.delete(0, 1);
    const update = Y.encodeStateAsUpdate(d);
    const vector = Y.encodeStateVector(d);
    d.destroy();
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE sheets SET state = ?, state_vector = ? WHERE id = ?")
        .run(update, vector, sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects a semantically valid but non-canonical stored state vector", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    // A genuine two-client state; the stored vector reorders its entries — the
    // same clientId→clock map, different (non-canonical) bytes.
    const d1 = new Y.Doc();
    d1.getText("content").insert(0, "ab");
    const d2 = new Y.Doc();
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    d2.getText("content").insert(2, "cd");
    const update = Y.encodeStateAsUpdate(d2);
    const canonicalVector = Y.encodeStateVector(d2);
    d1.destroy();
    d2.destroy();

    const entries = [...Y.decodeStateVector(canonicalVector).entries()].reverse();
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, entries.length);
    for (const [client, clock] of entries) {
      encoding.writeVarUint(enc, client);
      encoding.writeVarUint(enc, clock);
    }
    const reorderedVector = encoding.toUint8Array(enc);

    raw(dbPath, (c) =>
      c
        .prepare("UPDATE sheets SET state = ?, state_vector = ? WHERE id = ?")
        .run(update, reorderedVector, sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });
});

describe("loadValidatedSheet — metadata invariants", () => {
  it("rejects an invalid server revision", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    raw(dbPath, (c) =>
      c.prepare("UPDATE sheets SET server_revision = 0 WHERE id = ?").run(sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects an invalid createdAt", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    raw(dbPath, (c) =>
      c.prepare("UPDATE sheets SET created_at = -5 WHERE id = ?").run(sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });

  it("rejects an overlong persisted title", async () => {
    const { db, dbPath } = await open();
    const { sheetId } = createValid(db);
    raw(dbPath, (c) =>
      c
        .prepare("UPDATE metadata SET title = ? WHERE sheet_id = ?")
        .run("a".repeat(201), sheetId),
    );
    expect(loadValidatedSheet({ db, sheetId }).reason).toBe("corrupt");
  });
});
