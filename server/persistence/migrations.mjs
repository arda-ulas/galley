// Forward-only schema migrations for the Galley persistence store.
//
// Pure migration definitions — this module does NOT import `node:sqlite`; the
// adapter (db.mjs) owns execution. Each step has an integer `version` and an
// `up` SQL string applied inside its own transaction. Never edit a shipped
// migration in place; add a new higher-versioned step.
//
// M2 scope: only the CurrentState foundation (one full encoded Yjs state blob
// per sheet + a monotonic server revision, per RECONSTRUCTION_ARCHITECTURE.md
// §7/§18). Metadata, versions, idempotency, and retention are NOT created here
// — they arrive with their own milestones (M3/M6/M8/M10).

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
];

export const LATEST_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);
