// The shared persisted-sheet loading + validation boundary.
//
// Given a sheet id and the durable adapter, it validates the id, reads the
// joined sheet+metadata record, enforces strict durable BLOB typing and raw byte
// limits, reconstructs and structurally validates the persisted Yjs state, and
// requires the stored bytes to be exactly the server-canonical encoding (durable
// storage is never silently normalized). It reuses the M3 canonicalization
// helper so there is exactly ONE definition of a valid plain-text sheet — it
// validates persisted INVARIANTS, not the original HTTP request shape.
//
// Numeric limits come from limits.mjs (the declared source of truth); only
// canonicalization helpers/types are imported from yjs.mjs. It never mutates or
// repairs the database and never exposes raw Yjs/SQLite internals to callers.

import { isValidSheetId } from "./sheetId.mjs";
import { canonicalizeSubmission, YjsValidationError } from "./yjs.mjs";
import {
  LANGUAGE_ALLOWLIST,
  MAX_CANONICAL_STATE_BYTES,
  MAX_SUBMITTED_VECTOR_BYTES,
  MAX_TITLE_CODE_POINTS,
  MAX_VISIBLE_CONTENT_CODE_UNITS,
  SCHEMA_VERSION,
} from "./limits.mjs";

/**
 * @typedef {(
 *   | { ok: true, sheetId: string, title: string, language: string, schemaVersion: number,
 *       serverRevision: number, metadataRevision: number, createdAt: number,
 *       canonicalUpdate: Uint8Array, canonicalStateVector: Uint8Array }
 *   | { ok: false, reason: "invalid_id" | "missing" | "corrupt" | "db_error", detail?: unknown }
 * )} LoadResult
 */

/** Exact byte-for-byte equality of two Uint8Arrays. */
function bytesEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** A safe integer that meets `>= min`. */
function isSafeIntAtLeast(value, min) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

/**
 * Load and fully validate a persisted sheet.
 * @param {{ db: any, sheetId: string }} args
 * @returns {LoadResult}
 */
export function loadValidatedSheet({ db, sheetId }) {
  if (!isValidSheetId(sheetId)) {
    return { ok: false, reason: "invalid_id" };
  }

  // A read can fail operationally (e.g. an unreadable tampered integer surfaces
  // as a RangeError while materializing the row) — that is a db error, distinct
  // from a well-formed-but-invalid record.
  let record;
  try {
    record = db.getSheetRecord(sheetId);
  } catch (err) {
    return { ok: false, reason: "db_error", detail: err };
  }
  if (record === null) return { ok: false, reason: "missing" };

  const corrupt = (what, detail) => ({
    ok: false,
    reason: "corrupt",
    detail: detail ?? new Error(`invalid persisted ${what}`),
  });

  // The atomic-create invariant guarantees a metadata row per sheet; its absence
  // is durable corruption, not a missing sheet.
  if (!record.hasMetadata) return corrupt("metadata row");

  // Strict durable BLOB typing — reject null / integer / text / any non-binary
  // stored type without coercion.
  if (!(record.state instanceof Uint8Array)) return corrupt("state type");
  if (!(record.stateVector instanceof Uint8Array)) {
    return corrupt("state vector type");
  }

  // Raw durable byte limits, enforced against the STORED bytes before any Yjs
  // reconstruction (limits.mjs is the source of truth).
  if (record.state.byteLength > MAX_CANONICAL_STATE_BYTES) {
    return corrupt("state size");
  }
  if (record.stateVector.byteLength > MAX_SUBMITTED_VECTOR_BYTES) {
    return corrupt("state vector size");
  }

  // Structural reconstruction + canonicalization (reuse the M3 helper): decode,
  // structural allowlist, apply, visible/canonical size, and that the stored
  // vector corresponds to the reconstructed document.
  let canonical;
  try {
    canonical = canonicalizeSubmission(record.state, record.stateVector, {
      maxVisibleContentCodeUnits: MAX_VISIBLE_CONTENT_CODE_UNITS,
      maxCanonicalStateBytes: MAX_CANONICAL_STATE_BYTES,
    });
  } catch (err) {
    if (err instanceof YjsValidationError) return corrupt("yjs state", err);
    return { ok: false, reason: "db_error", detail: err };
  }

  // Durable storage must not be silently normalized: the stored bytes must be
  // EXACTLY the server-canonical re-encoding of the reconstructed document.
  if (!bytesEqual(record.state, canonical.canonicalUpdate)) {
    return corrupt("non-canonical update");
  }
  if (!bytesEqual(record.stateVector, canonical.canonicalStateVector)) {
    return corrupt("non-canonical state vector");
  }

  // Metadata / revision invariants (no coercion of wrong-typed stored values).
  const { title, language, metadataRevision, serverRevision } = record;
  const schemaVersion = record.documentSchemaVersion;
  const createdAt = record.createdAt;

  if (typeof title !== "string" || [...title].length > MAX_TITLE_CODE_POINTS) {
    return corrupt("title");
  }
  if (typeof language !== "string" || !LANGUAGE_ALLOWLIST.includes(language)) {
    return corrupt("language");
  }
  if (
    typeof schemaVersion !== "number" ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion !== SCHEMA_VERSION
  ) {
    return corrupt("schema version");
  }
  if (!isSafeIntAtLeast(metadataRevision, 1)) return corrupt("metadata revision");
  if (!isSafeIntAtLeast(serverRevision, 1)) return corrupt("server revision");
  if (!isSafeIntAtLeast(createdAt, 0)) return corrupt("created timestamp");

  return {
    ok: true,
    sheetId,
    title,
    language,
    schemaVersion,
    serverRevision,
    metadataRevision,
    createdAt,
    // Validated server-canonical bytes (byte-equal to storage) — for internal
    // hydration use (M4 commit 2), never exposed by the bootstrap endpoint.
    canonicalUpdate: canonical.canonicalUpdate,
    canonicalStateVector: canonical.canonicalStateVector,
  };
}
