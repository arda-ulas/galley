// Forward-only schema migrations for the Galley persistence store.
//
// Pure migration definitions — this module does NOT import `node:sqlite`; the
// adapter (db.mjs) owns execution. Each step has an integer `version` and an
// `up` SQL string applied inside its own transaction. Never edit a shipped
// migration in place; add a new higher-versioned step.
//
// M2 scope: only the CurrentState foundation (one full encoded Yjs state blob
// per sheet + a monotonic server revision, per RECONSTRUCTION_ARCHITECTURE.md
// §7/§18).
//
// M3 (version 2) adds the durable-create foundation: creation timestamp and
// document schema version on sheets, a per-sheet metadata row, and an
// idempotency table keyed by creation token. Versions and retention still arrive
// with their own milestones (M8/M10). Foreign keys are enforced (PRAGMA
// foreign_keys = ON in db.mjs), so the ON DELETE CASCADE clauses are live.

/** @typedef {{ version: number, up: string }} Migration */

/** @type {ReadonlyArray<Migration>} */
export const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE sheets (
        id              TEXT    PRIMARY KEY,
        server_revision INTEGER NOT NULL,
        state           BLOB,
        state_vector    BLOB,
        updated_at      INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    up: `
      ALTER TABLE sheets ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sheets ADD COLUMN document_schema_version INTEGER NOT NULL DEFAULT 0;

      -- Backfill created_at for any pre-existing (M2) rows from their updated_at.
      UPDATE sheets SET created_at = updated_at WHERE created_at = 0;

      CREATE TABLE metadata (
        sheet_id          TEXT    PRIMARY KEY,
        title             TEXT    NOT NULL DEFAULT '',
        language          TEXT    NOT NULL DEFAULT '',
        metadata_revision INTEGER NOT NULL DEFAULT 1,
        updated_at        INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE
      );

      -- Backfill a baseline metadata row for every pre-existing sheet.
      INSERT INTO metadata (sheet_id, title, language, metadata_revision, updated_at)
        SELECT id, '', 'plaintext', 1, updated_at FROM sheets;

      -- Idempotency holds the IMMUTABLE creation receipt for each token. Replay
      -- returns these stored values verbatim, so later state/metadata mutation
      -- never changes what a repeated create observes. The committed state
      -- vector is captured at creation and must never be null.
      CREATE TABLE idempotency (
        creation_token                        TEXT    PRIMARY KEY,
        sheet_id                              TEXT    NOT NULL UNIQUE,
        server_revision_at_create             INTEGER NOT NULL,
        committed_state_vector_at_create      BLOB    NOT NULL,
        committed_metadata_revision_at_create INTEGER NOT NULL,
        committed_at                          INTEGER NOT NULL,
        FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE
      );
      -- No idempotency receipts are fabricated for pre-existing sheets: they
      -- were never created through the token-bearing create path.
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);
