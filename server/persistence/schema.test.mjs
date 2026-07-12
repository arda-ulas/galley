import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, SCHEMA_VERSION_DDL } from "./db.mjs";
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

/** Raw handle for test-only setup of malformed / pre-existing DB state. */
function raw(dbPath, sql) {
  const db = new DatabaseSync(dbPath);
  db.exec(sql);
  db.close();
}

describe("schema_version — bootstrap only on a fresh database", () => {
  it("migrates a fresh (empty) database from 0 to the latest version", async () => {
    const t = await tmp();
    const db = openDatabase(t.dbPath);
    try {
      expect(db.schemaVersion).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });

  it("is a no-op on a database already at the latest version", async () => {
    const t = await tmp();
    openDatabase(t.dbPath).close();
    const db = openDatabase(t.dbPath);
    try {
      expect(db.schemaVersion).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });

  it("persists the version across close/reopen", async () => {
    const t = await tmp();
    const a = openDatabase(t.dbPath);
    const v = a.schemaVersion;
    a.close();
    const b = openDatabase(t.dbPath);
    try {
      expect(b.schemaVersion).toBe(v);
    } finally {
      b.close();
    }
  });

  it("rejects an existing non-empty database that lacks schema_version", async () => {
    const t = await tmp();
    raw(t.dbPath, "CREATE TABLE some_app_table (x INTEGER);");
    expect(() => openDatabase(t.dbPath)).toThrow(/refusing to bootstrap|no schema_version/i);
  });

  it("accepts a database with the exact valid singleton definition", async () => {
    const t = await tmp();
    raw(
      t.dbPath,
      SCHEMA_VERSION_DDL + " INSERT INTO schema_version (id, version) VALUES (1, 0);",
    );
    const db = openDatabase(t.dbPath); // valid definition → validates → migrates
    try {
      expect(db.schemaVersion).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });
});

describe("schema_version — definition validation", () => {
  it("rejects a definition with no constraints (id INTEGER, version INTEGER)", async () => {
    const t = await tmp();
    raw(t.dbPath, "CREATE TABLE schema_version (id INTEGER, version INTEGER);");
    expect(() => openDatabase(t.dbPath)).toThrow(/INTEGER PRIMARY KEY/i);
  });

  it("rejects a missing PRIMARY KEY on id", async () => {
    const t = await tmp();
    raw(
      t.dbPath,
      "CREATE TABLE schema_version (id INTEGER CHECK (id = 1), version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 0));",
    );
    expect(() => openDatabase(t.dbPath)).toThrow(/INTEGER PRIMARY KEY/i);
  });

  it("rejects a missing NOT NULL on version", async () => {
    const t = await tmp();
    raw(
      t.dbPath,
      "CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER CHECK (typeof(version) = 'integer' AND version >= 0));",
    );
    expect(() => openDatabase(t.dbPath)).toThrow(/INTEGER NOT NULL/i);
  });

  it("rejects a missing CHECK (id = 1)", async () => {
    const t = await tmp();
    raw(
      t.dbPath,
      "CREATE TABLE schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 0));",
    );
    expect(() => openDatabase(t.dbPath)).toThrow(/CHECK \(id = 1\)/i);
  });

  it("rejects a missing version CHECK", async () => {
    const t = await tmp();
    raw(
      t.dbPath,
      "CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);",
    );
    expect(() => openDatabase(t.dbPath)).toThrow(/integer\/>=0 CHECK/i);
  });

  it("rejects an extra column", async () => {
    const t = await tmp();
    raw(
      t.dbPath,
      "CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 0), extra INTEGER);",
    );
    expect(() => openDatabase(t.dbPath)).toThrow(/exactly columns/i);
  });

  it("rejects a legacy single-column shape", async () => {
    const t = await tmp();
    raw(t.dbPath, "CREATE TABLE schema_version (version INTEGER);");
    expect(() => openDatabase(t.dbPath)).toThrow(/exactly columns/i);
  });

  it("rejects a definition whose CHECKs exist only inside comments", async () => {
    const t = await tmp();
    // Column shape is valid (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)
    // but the required CHECK expressions appear ONLY inside block comments, so
    // they are not real constraints and must be rejected.
    raw(
      t.dbPath,
      `CREATE TABLE schema_version (
         id INTEGER PRIMARY KEY,
         version INTEGER NOT NULL
         /* CHECK (id = 1) */
         /* CHECK (typeof(version) = 'integer' AND version >= 0) */
       );
       INSERT INTO schema_version (id, version) VALUES (1, 0);`,
    );
    expect(() => openDatabase(t.dbPath)).toThrow(/CHECK \(id = 1\)/i);
  });

  it("accepts a valid definition with harmless comments elsewhere", async () => {
    const t = await tmp();
    // Real CHECK constraints, plus harmless line and block comments around them.
    // Stripping comments must not disturb a genuinely-valid schema.
    raw(
      t.dbPath,
      `CREATE TABLE schema_version (
         id      INTEGER PRIMARY KEY CHECK (id = 1), -- the singleton row
         version INTEGER NOT NULL /* bumped on migrate */ CHECK (typeof(version) = 'integer' AND version >= 0)
       );
       INSERT INTO schema_version (id, version) VALUES (1, 0);`,
    );
    const db = openDatabase(t.dbPath); // valid definition → validates → migrates
    try {
      expect(db.schemaVersion).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });
});

describe("schema_version — row validation", () => {
  it("rejects a valid definition with zero rows", async () => {
    const t = await tmp();
    raw(t.dbPath, SCHEMA_VERSION_DDL); // valid definition, no row inserted
    expect(() => openDatabase(t.dbPath)).toThrow(/exactly one row; found 0/i);
  });

  it("rejects a future version (no destructive recovery)", async () => {
    const t = await tmp();
    openDatabase(t.dbPath).close(); // valid DB at LATEST
    raw(
      t.dbPath,
      `UPDATE schema_version SET version = ${LATEST_VERSION + 1} WHERE id = 1;`,
    );
    expect(() => openDatabase(t.dbPath)).toThrow(/newer than supported/i);
    const check = new DatabaseSync(t.dbPath);
    const v = check
      .prepare("SELECT version FROM schema_version WHERE id = 1")
      .get().version;
    check.close();
    expect(Number(v)).toBe(LATEST_VERSION + 1); // not repaired/recreated
  });

  it("a migration failure preserves the prior version and aborts open", async () => {
    const t = await tmp();
    expect(() => openDatabase(t.dbPath, { faults: { migrate: true } })).toThrow(
      /injected migration/i,
    );
    const check = new DatabaseSync(t.dbPath);
    const version = check
      .prepare("SELECT version FROM schema_version WHERE id = 1")
      .get().version;
    const sheets = check
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sheets'")
      .get();
    check.close();
    expect(Number(version)).toBe(0);
    expect(sheets).toBeUndefined();

    const db = openDatabase(t.dbPath); // reopen without fault migrates cleanly
    try {
      expect(db.schemaVersion).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });
});
