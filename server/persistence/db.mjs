// The single SQLite adapter — the ONLY production module that imports
// `node:sqlite`. Higher layers call the returned repository API and never touch
// the binding, so swapping to `better-sqlite3` (the documented fallback) would
// change only this file (docs/SQLITE_DECISION.md).
//
// One synchronous connection per server process. Explicit open/close lifecycle.
// WAL + `synchronous = FULL` + `busy_timeout` (all verified on open).
// Parameterized, cached statements only. `DatabaseSync` is never exposed.
//
// Transaction model (M2 — no savepoints, no nesting, no depth counter):
//   db.inTransaction((tx) => { tx.persistState(...) })
// - Exactly one top-level synchronous transaction at a time.
// - `BEGIN IMMEDIATE` → synchronous callback → `COMMIT` (success) / `ROLLBACK`
//   (failure). Thenable returns and nested calls are rejected.
// - A FRESH transaction-scoped repository `tx` is created per transaction and
//   bound to a unique capability token. Every `tx` method verifies the adapter
//   is `active` AND the token is the currently-active one, so a `tx` that
//   escapes its callback cannot write later (after commit/rollback, during an
//   unrelated transaction, after poison, or after close).
//
// Lifecycle states: idle | active | poisoned | closed. An unrecoverable COMMIT
// failure, or a ROLLBACK that itself fails, poisons the adapter: it then rejects
// reads, writes, and transactions, but can still be closed.
//
// Test-only fault seam: `openDatabase(path, { faults })` injects open-phase
// failures; the returned adapter's `__test` arms one-shot begin/commit/rollback/
// close failures. Per-instance, not global, never product-exposed.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LATEST_VERSION, MIGRATIONS } from "./migrations.mjs";

// PRAGMA values cannot be parameter-bound by SQLite, so this fixed integer
// constant is interpolated. It is a compile-time constant, never user input.
const BUSY_TIMEOUT_MS = 5000;

// Fixed production database path. The server composition layer (server/app.mjs)
// resolves the actual path — honoring an explicit test path only under the
// server-level ECHO_REWIND_TEST flag — and passes it to openDatabase(). This
// module no longer reads any environment variable.
export const PRODUCTION_DB_PATH = "data/galley.db";

// Singleton bookkeeping table: exactly one row (id = 1). The CHECKs make bad
// writes impossible; open-time validation additionally rejects any database
// whose schema_version definition does not match this exact shape. Exported so
// tests can construct a genuinely-valid singleton.
export const SCHEMA_VERSION_DDL = `
  CREATE TABLE schema_version (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 0)
  );
`;

/**
 * Thrown when a transaction callback fails AND the subsequent ROLLBACK also
 * fails. Preserves the exact original thrown value (primitive, null, frozen
 * object, …) without mutating it, alongside the rollback failure diagnostics.
 */
export class TransactionRollbackError extends Error {
  /**
   * @param {unknown} original the exact value thrown by the callback
   * @param {unknown} rollbackError the error raised while rolling back
   */
  constructor(original, rollbackError) {
    super(
      "transaction callback failed and ROLLBACK also failed; the adapter is poisoned",
    );
    this.name = "TransactionRollbackError";
    this.original = original;
    this.rollbackError = rollbackError;
    // Standard `cause` (any value permitted) mirrors `original`.
    this.cause = original;
  }
}

/** Create the (controlled) parent directory of a DB path if needed. */
function ensureParentDir(path) {
  const dir = dirname(path);
  if (dir && dir !== "." && dir !== "/") {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * List user (non-internal) tables.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string[]}
 */
function listUserTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((r) => r.name);
}

/**
 * Ensure schema_version exists — but ONLY bootstrap a genuinely fresh/empty
 * database. If the database already contains application tables yet lacks
 * schema_version, it is an incompatible database and is rejected (no silent
 * bootstrap or recreation).
 * @param {import('node:sqlite').DatabaseSync} db
 */
function ensureSchemaVersionTable(db) {
  const tables = listUserTables(db);
  if (tables.includes("schema_version")) return;

  const others = tables.filter((n) => n !== "schema_version");
  if (others.length > 0) {
    throw new Error(
      `database has existing tables (${others.join(", ")}) but no schema_version; ` +
        `refusing to bootstrap an incompatible database`,
    );
  }
  db.exec(SCHEMA_VERSION_DDL);
  db.prepare("INSERT INTO schema_version (id, version) VALUES (1, ?)").run(0);
}

/**
 * Strip SQL line (`-- …`) and block (`/* … *\/`) comments from a DDL string,
 * leaving single-quoted string literals untouched (a comment marker inside a
 * string literal is real content, not a comment). Without this, a CHECK
 * expression that exists ONLY inside a comment would be counted as a real
 * constraint by the substring/regex checks below.
 * @param {string} sql
 * @returns {string}
 */
function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'") {
      // Copy a single-quoted string literal verbatim, honoring '' escapes.
      out += ch;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      // Line comment: skip to end of line (keep the newline as whitespace).
      i += 2;
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      // Block comment: skip through the closing */ (or end of string).
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      out += " "; // collapse to a separator so tokens don't fuse
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Validate the ACTUAL schema_version definition (not just column names): exactly
 * columns (id, version); id INTEGER PRIMARY KEY; version INTEGER NOT NULL; the
 * CHECK (id = 1) and the version integer/>=0 CHECK. Rejects extra columns,
 * missing constraints, and malformed definitions.
 * @param {import('node:sqlite').DatabaseSync} db
 */
function validateSchemaVersionDefinition(db) {
  const info = db.prepare("PRAGMA table_info('schema_version')").all();
  const names = info.map((c) => c.name);
  if (names.length !== 2 || !names.includes("id") || !names.includes("version")) {
    throw new Error(
      `schema_version must have exactly columns (id, version); found (${names.join(", ")})`,
    );
  }
  const id = info.find((c) => c.name === "id");
  const version = info.find((c) => c.name === "version");
  if (String(id.type).toUpperCase() !== "INTEGER" || id.pk !== 1) {
    throw new Error("schema_version.id must be INTEGER PRIMARY KEY");
  }
  if (String(version.type).toUpperCase() !== "INTEGER" || version.notnull !== 1) {
    throw new Error("schema_version.version must be INTEGER NOT NULL");
  }

  const sql =
    db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
      )
      .get()?.sql ?? "";
  // Strip comments first: a CHECK that appears only inside a `--` or `/* */`
  // comment is not a real constraint and must not satisfy the checks below.
  const normalized = stripSqlComments(sql).replace(/\s+/g, " ").toLowerCase();
  if (!normalized.includes("check (id = 1)")) {
    throw new Error("schema_version.id is missing CHECK (id = 1)");
  }
  if (
    !/check \(typeof\(version\) = 'integer' and version >= 0\)/.test(normalized)
  ) {
    throw new Error("schema_version.version is missing its integer/>=0 CHECK");
  }
}

/**
 * Validate the singleton row and return the version. Rejects zero/multiple rows,
 * a missing id=1 row, and a non-integer/negative/future version. (On a valid
 * definition the CHECKs make most of these impossible; kept as defense in depth.)
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {number}
 */
function readAndValidateSchemaVersionRow(db) {
  const rows = db.prepare("SELECT id FROM schema_version").all();
  if (rows.length !== 1) {
    throw new Error(
      `schema_version must contain exactly one row; found ${rows.length}`,
    );
  }
  const row = db.prepare("SELECT version FROM schema_version WHERE id = 1").get();
  if (!row) throw new Error("schema_version row id = 1 is missing");
  const v = row.version;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new Error(`schema_version.version is invalid: ${JSON.stringify(v)}`);
  }
  if (v > LATEST_VERSION) {
    throw new Error(
      `schema version ${v} is newer than supported ${LATEST_VERSION}; ` +
        `refusing to open (no destructive recovery).`,
    );
  }
  return v;
}

/** Lightweight read of the singleton version (post-validation, for getters). */
function readSchemaVersionValue(db) {
  const row = db.prepare("SELECT version FROM schema_version WHERE id = 1").get();
  return row ? Number(row.version) : 0;
}

/**
 * Apply forward-only migrations above `current`. Each migration's SQL and the
 * version bump run in the SAME transaction, so a failure rolls back and leaves
 * the prior version intact.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {<T>(useTx: (tx: any) => T) => T} runExclusive
 * @param {{ migrate?: boolean }} faults
 * @param {number} current
 */
function runMigrations(db, runExclusive, faults, current) {
  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );
  for (const step of pending) {
    runExclusive(() => {
      if (faults.migrate) throw new Error("injected migration failure");
      db.exec(step.up);
      db.prepare("UPDATE schema_version SET version = ? WHERE id = 1").run(
        step.version,
      );
    });
  }
}

/** Prepare and cache repository statements once per adapter. */
function prepareStatements(db) {
  return {
    selectRevision: db.prepare(
      "SELECT server_revision FROM sheets WHERE id = ?",
    ),
    upsertSheet: db.prepare(
      `INSERT INTO sheets (id, server_revision, state, state_vector, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         server_revision = excluded.server_revision,
         state           = excluded.state,
         state_vector    = excluded.state_vector,
         updated_at      = excluded.updated_at`,
    ),
    selectSheet: db.prepare(
      "SELECT id, server_revision, state, state_vector, updated_at FROM sheets WHERE id = ?",
    ),
  };
}

/**
 * Open (and migrate) a file-backed database, returning the adapter only after a
 * fully successful initialization. Rejects `:memory:` and empty paths. On any
 * initialization failure the partial handle is closed and BOTH the init and
 * (if any) close failures are preserved; the database is never recreated or
 * replaced with an in-memory store.
 *
 * @param {string} path
 * @param {{ faults?: { open?: boolean, walVerify?: boolean, fullVerify?: boolean, migrate?: boolean, initClose?: boolean } }} [options]
 */
export function openDatabase(path, options = {}) {
  const faults = options.faults ?? {};

  if (typeof path !== "string" || path.length === 0) {
    throw new Error("openDatabase: a non-empty file path is required");
  }
  if (path === ":memory:") {
    throw new Error(
      "openDatabase: in-memory databases are not permitted; a file path is required",
    );
  }

  ensureParentDir(path);

  // Construction failure surfaces directly (there is no handle to close).
  const db = new DatabaseSync(path);

  // Lifecycle state, active-transaction capability token, and per-instance
  // one-shot fault flags (test-only).
  let state = "idle"; // idle | active | poisoned | closed
  /** @type {object | null} the capability token of the currently active tx */
  let activeToken = null;
  const testFaults = { begin: false, commit: false, rollback: false, close: false };
  /** @param {'begin'|'commit'|'rollback'|'close'} key */
  const takeFault = (key) => {
    if (testFaults[key]) {
      testFaults[key] = false;
      return true;
    }
    return false;
  };

  function assertUsable() {
    if (state === "poisoned") {
      throw new Error(
        "adapter is poisoned by a prior unrecoverable failure; it can only be closed",
      );
    }
    if (state === "closed") throw new Error("adapter is closed");
  }

  /** Build a fresh transaction-scoped repository bound to `token`. */
  function makeTx(token) {
    function guard() {
      if (state !== "active" || activeToken !== token) {
        throw new Error(
          "this transaction handle is no longer valid; it was used outside its transaction",
        );
      }
    }
    return {
      /**
       * @param {string} sheetId
       * @param {{ state?: Uint8Array | null, stateVector?: Uint8Array | null }} [payload]
       * @returns {{ serverRevision: number, updatedAt: number }}
       */
      persistState(sheetId, payload = {}) {
        guard();
        const stateBlob = payload.state ?? null;
        const stateVector = payload.stateVector ?? null;
        const row = stmts.selectRevision.get(sheetId);
        const nextRevision = (row ? Number(row.server_revision) : 0) + 1;
        const updatedAt = Date.now();
        stmts.upsertSheet.run(
          sheetId,
          nextRevision,
          stateBlob,
          stateVector,
          updatedAt,
        );
        return { serverRevision: nextRevision, updatedAt };
      },
    };
  }

  /**
   * @template T
   * @param {(tx: ReturnType<typeof makeTx>) => T} useTx
   * @returns {T}
   */
  function runExclusive(useTx) {
    assertUsable();
    if (state === "active") {
      throw new Error(
        "a transaction is already in progress; nested transactions are not supported. " +
          "Use the transaction-scoped repository (the `tx` argument) inside the callback.",
      );
    }

    // BEGIN failure must not leave active state, so state flips to active only
    // after BEGIN succeeds.
    if (takeFault("begin")) throw new Error("injected BEGIN failure");
    db.exec("BEGIN IMMEDIATE;");
    state = "active";
    const token = {};
    activeToken = token;
    const tx = makeTx(token);

    let result;
    try {
      result = useTx(tx);
      if (result != null && typeof (/** @type {any} */ (result).then) === "function") {
        throw new TypeError(
          "transaction callback must be synchronous (it returned a thenable)",
        );
      }
    } catch (err) {
      // End the transaction: invalidate the capability first.
      activeToken = null;
      let rollbackError;
      let rollbackFailed = false;
      try {
        if (takeFault("rollback")) throw new Error("injected ROLLBACK failure");
        db.exec("ROLLBACK;");
      } catch (rbErr) {
        rollbackFailed = true;
        rollbackError = rbErr;
      }
      if (rollbackFailed) {
        state = "poisoned"; // rollback failed → poison
        // Wrapper preserves the exact original AND the rollback diagnostics
        // without mutating the original value.
        throw new TransactionRollbackError(err, rollbackError);
      }
      state = "idle"; // clean rollback → recoverable
      throw err; // preserve the original thrown value exactly
    }

    // Success: COMMIT.
    activeToken = null;
    try {
      if (takeFault("commit")) throw new Error("injected COMMIT failure");
      db.exec("COMMIT;");
      state = "idle";
      return result;
    } catch (commitErr) {
      state = "poisoned"; // clean state is uncertain → poison
      throw commitErr;
    }
  }

  /** @type {ReturnType<typeof prepareStatements>} */
  let stmts;

  // Initialization sequence — the adapter is returned only on full success.
  try {
    if (faults.open) throw new Error("injected open failure");

    db.exec("PRAGMA journal_mode = WAL;");
    const journalMode = db.prepare("PRAGMA journal_mode").get().journal_mode;
    if (faults.walVerify || journalMode !== "wal") {
      throw new Error(`WAL was not enabled (journal_mode = ${journalMode})`);
    }

    db.exec("PRAGMA synchronous = FULL;");
    const synchronous = Number(
      db.prepare("PRAGMA synchronous").get().synchronous,
    );
    if (faults.fullVerify || synchronous !== 2) {
      throw new Error(
        `synchronous = FULL was not set (synchronous = ${synchronous})`,
      );
    }

    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    const busyTimeout = Number(
      db.prepare("PRAGMA busy_timeout").get().timeout,
    );
    if (busyTimeout !== BUSY_TIMEOUT_MS) {
      throw new Error(
        `busy_timeout was not set (busy_timeout = ${busyTimeout}, expected ${BUSY_TIMEOUT_MS})`,
      );
    }

    // Enforce foreign-key constraints on every connection. `foreign_keys` is a
    // per-connection pragma (default OFF in SQLite) and must be set outside any
    // transaction — here, before migrations run. Later schema (metadata,
    // idempotency) relies on ON DELETE CASCADE, so this must always be active.
    db.exec("PRAGMA foreign_keys = ON;");
    const foreignKeys = Number(
      db.prepare("PRAGMA foreign_keys").get().foreign_keys,
    );
    if (foreignKeys !== 1) {
      throw new Error(
        `foreign_keys was not enabled (foreign_keys = ${foreignKeys})`,
      );
    }

    ensureSchemaVersionTable(db);
    validateSchemaVersionDefinition(db);
    const current = readAndValidateSchemaVersionRow(db);
    runMigrations(db, runExclusive, faults, current);

    stmts = prepareStatements(db);
  } catch (initErr) {
    try {
      if (faults.initClose) throw new Error("injected init-close failure");
      db.close();
    } catch (closeErr) {
      if (initErr && typeof initErr === "object") {
        try {
          /** @type {any} */ (initErr).closeError = closeErr;
        } catch {
          // frozen — leave unmodified
        }
      }
    }
    throw initErr;
  }

  return {
    path,

    get journalMode() {
      assertUsable();
      return db.prepare("PRAGMA journal_mode").get().journal_mode;
    },
    get synchronous() {
      assertUsable();
      return Number(db.prepare("PRAGMA synchronous").get().synchronous);
    },
    get busyTimeout() {
      assertUsable();
      return Number(db.prepare("PRAGMA busy_timeout").get().timeout);
    },
    get foreignKeys() {
      assertUsable();
      return Number(db.prepare("PRAGMA foreign_keys").get().foreign_keys);
    },
    get schemaVersion() {
      assertUsable();
      return readSchemaVersionValue(db);
    },
    integrityCheck() {
      assertUsable();
      return db.prepare("PRAGMA integrity_check").get().integrity_check;
    },

    /**
     * Run a synchronous transaction, receiving a fresh transaction-scoped
     * repository `tx`. Group repository writes atomically here. Cannot be nested.
     * The `tx` is invalid outside this callback.
     * @template T
     * @param {(tx: ReturnType<typeof makeTx>) => T} fn
     * @returns {T}
     */
    inTransaction(fn) {
      return runExclusive((tx) => fn(tx));
    },

    /**
     * Convenience: persist one sheet's state in its own transaction. Rejected if
     * called while a transaction is in progress — use `tx.persistState` instead.
     * @param {string} sheetId
     * @param {{ state?: Uint8Array | null, stateVector?: Uint8Array | null }} [payload]
     */
    persistState(sheetId, payload = {}) {
      return runExclusive((tx) => tx.persistState(sheetId, payload));
    },

    /**
     * @param {string} sheetId
     * @returns {{ id: string, serverRevision: number, state: Uint8Array | null, stateVector: Uint8Array | null, updatedAt: number } | null}
     */
    getSheet(sheetId) {
      assertUsable();
      const row = stmts.selectSheet.get(sheetId);
      if (!row) return null;
      return {
        id: row.id,
        serverRevision: Number(row.server_revision),
        state: row.state ?? null,
        stateVector: row.state_vector ?? null,
        updatedAt: Number(row.updated_at),
      };
    },

    /**
     * Idempotent explicit close. Marks closed only after `db.close()` succeeds;
     * a close failure propagates and leaves the adapter retryable. A poisoned
     * adapter can still be closed.
     */
    close() {
      if (state === "closed") return; // second close after success is a no-op
      if (takeFault("close")) throw new Error("injected close failure");
      db.close(); // if this throws, state stays as-is → retry allowed
      state = "closed";
    },

    /**
     * Test-only, per-instance fault seam. Never called by production code. Arms
     * a one-shot failure consumed by the next matching operation.
     */
    __test: {
      failNextBegin() {
        testFaults.begin = true;
      },
      failNextCommit() {
        testFaults.commit = true;
      },
      failNextRollback() {
        testFaults.rollback = true;
      },
      failNextClose() {
        testFaults.close = true;
      },
      state() {
        return state;
      },
    },
  };
}
