// Server-side Yjs canonicalization for the durable-create path.
//
// The client submits an encoded Yjs update plus the state vector it believes
// matches that update. The server trusts neither. It:
//   1. strictly parses the submitted state vector (full consumption, no dup ids);
//   2. structurally validates the update against an allowlist that accepts ONLY
//      the plain-text content model (see accepts/rejects below) — using public
//      Yjs exports (decodeUpdate + Content*/Item/GC), never private fields;
//   3. predeclares the "content" root as Y.Text, then applies the update;
//   4. computes its OWN canonical update and state vector and persists/returns
//      only those bytes;
//   5. compares the submitted vector to the computed one by clientId→clock map
//      (order-independent), NOT by raw bytes.
//
// The enforceable boundary is the plain-text WIRE model, not a nominal Yjs
// type. The server accepts the plain-text wire model rooted at "content" and
// canonicalizes accepted, wire-compatible sequence text into a server-owned
// Y.Text. It accepts:
//   - a single shared root named "content" carrying only sequence text
//   - plain-text inserts (ContentString) and deletions (ContentDeleted / GC)
//   - the empty document (no structs)
//   - a top-level plain Y.XmlText whose content is only string text — it is
//     wire-equivalent to plain Y.Text (identical ContentString structs) and has
//     no enforceable discriminator, so it is accepted and canonicalized through
//     the server-owned Y.Text just like plain text
// It rejects structurally distinct forms:
//   - any shared root other than "content"
//   - Y.Map roots (map key entries) and Y.Xml* attributes (parentSub keys)
//   - Y.Array roots and XmlElement / nested types (ContentType, ContentAny)
//   - text embeds (ContentEmbed) and text formatting attributes (ContentFormat)
//   A state vector is a per-client clock summary, not a content hash.

import * as Y from "yjs";
import * as decoding from "lib0/decoding";

// The one permitted shared root and its required type.
const CONTENT_ROOT = "content";

// Visible text is measured in UTF-16 code units (JS string length). Canonical
// state is the server-encoded update byte length.
export const MAX_VISIBLE_CONTENT_CODE_UNITS = 250_000;
export const MAX_CANONICAL_STATE_BYTES = 512 * 1024; // 512 KiB

/**
 * A safe, typed validation failure. The message is intentionally generic and
 * carries no Yjs/library internals, so callers may surface it without leaking.
 */
export class YjsValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "YjsValidationError";
  }
}

/**
 * Strictly decode a Yjs state vector with lib0. Rejects malformed/truncated
 * varints, duplicate client ids, and trailing bytes; requires full consumption
 * of the buffer. Returns a clientId→clock Map (order-independent).
 * @param {Uint8Array} bytes
 * @returns {Map<number, number>}
 */
export function decodeStateVectorStrict(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new YjsValidationError("state vector must be binary");
  }
  const decoder = decoding.createDecoder(bytes);
  let numClients;
  try {
    numClients = decoding.readVarUint(decoder);
  } catch {
    throw new YjsValidationError("state vector is malformed");
  }
  if (!Number.isSafeInteger(numClients)) {
    throw new YjsValidationError("state vector is malformed");
  }
  const map = new Map();
  for (let i = 0; i < numClients; i++) {
    let client;
    let clock;
    try {
      client = decoding.readVarUint(decoder);
      clock = decoding.readVarUint(decoder);
    } catch {
      throw new YjsValidationError("state vector is truncated");
    }
    if (!Number.isSafeInteger(client) || !Number.isSafeInteger(clock)) {
      throw new YjsValidationError("state vector has an invalid entry");
    }
    if (map.has(client)) {
      throw new YjsValidationError("state vector has a duplicate client id");
    }
    map.set(client, clock);
  }
  if (decoding.hasContent(decoder)) {
    throw new YjsValidationError("state vector has trailing bytes");
  }
  return map;
}

/** clientId→clock equality, independent of entry order. */
function stateVectorsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [client, clock] of a) {
    if (b.get(client) !== clock) return false;
  }
  return true;
}

/**
 * Structurally validate the submitted update against the plain-text allowlist
 * using public Yjs exports only. Throws YjsValidationError on anything outside
 * the accepted content model.
 * @param {Uint8Array} update
 */
function assertPlainTextUpdate(update) {
  let structs;
  try {
    ({ structs } = Y.decodeUpdate(update));
  } catch {
    throw new YjsValidationError("submitted update could not be decoded");
  }
  for (const struct of structs) {
    // GC structs are id+length placeholders for collected/deleted content.
    if (struct instanceof Y.GC) continue;
    if (!(struct instanceof Y.Item)) {
      throw new YjsValidationError("submitted update contains an unsupported struct");
    }
    // A non-null parent sub-key means a Y.Map-style entry.
    if (struct.parentSub != null) {
      throw new YjsValidationError("submitted update uses map content");
    }
    // A string parent is a root name and must be exactly "content"; a null or
    // id parent chains onto an already-validated sequence item.
    const parent = struct.parent;
    if (typeof parent === "string" && parent !== CONTENT_ROOT) {
      throw new YjsValidationError("submitted update contains an unexpected root");
    }
    // Only plain-text inserts and deletions are permitted. This rejects
    // formatting (ContentFormat), embeds (ContentEmbed), nested types
    // (ContentType → Array/Xml), and JSON/any array values (ContentAny/JSON).
    const content = struct.content;
    if (
      !(content instanceof Y.ContentString) &&
      !(content instanceof Y.ContentDeleted)
    ) {
      throw new YjsValidationError("submitted update contains unsupported content");
    }
  }
}

/**
 * Validate and canonicalize a submitted Yjs draft.
 *
 * @param {Uint8Array} submittedUpdate encoded Yjs update (client draft state)
 * @param {Uint8Array} submittedStateVector encoded state vector the client claims
 * @param {{ maxVisibleContentCodeUnits?: number, maxCanonicalStateBytes?: number }} [options]
 * @returns {{ canonicalUpdate: Uint8Array, canonicalStateVector: Uint8Array }}
 * @throws {YjsValidationError} on any structural, type, size, or vector mismatch
 */
export function canonicalizeSubmission(
  submittedUpdate,
  submittedStateVector,
  options = {},
) {
  const maxVisible =
    options.maxVisibleContentCodeUnits ?? MAX_VISIBLE_CONTENT_CODE_UNITS;
  const maxCanonicalBytes =
    options.maxCanonicalStateBytes ?? MAX_CANONICAL_STATE_BYTES;

  if (!(submittedUpdate instanceof Uint8Array)) {
    throw new YjsValidationError("submitted update must be binary");
  }
  // Strict vector parse first (also enforces the binary type).
  const submittedVector = decodeStateVectorStrict(submittedStateVector);

  // Structural allowlist on the raw update (rejects non-text content models).
  assertPlainTextUpdate(submittedUpdate);

  const doc = new Y.Doc();
  try {
    // Predeclare the root as Y.Text before applying, so the document type is
    // fixed by the server, not inferred from the (already-validated) update.
    const content = doc.getText(CONTENT_ROOT);
    try {
      Y.applyUpdate(doc, submittedUpdate);
    } catch {
      throw new YjsValidationError("submitted update could not be applied");
    }

    const text = content.toString();
    if (text.length > maxVisible) {
      throw new YjsValidationError("submitted content exceeds the size limit");
    }

    const canonicalUpdate = Y.encodeStateAsUpdate(doc);
    const canonicalStateVector = Y.encodeStateVector(doc);
    if (canonicalUpdate.byteLength > maxCanonicalBytes) {
      throw new YjsValidationError("submitted state exceeds the size limit");
    }

    const computedVector = decodeStateVectorStrict(canonicalStateVector);
    if (!stateVectorsEqual(submittedVector, computedVector)) {
      throw new YjsValidationError(
        "submitted state vector does not match the submitted update",
      );
    }

    return { canonicalUpdate, canonicalStateVector };
  } finally {
    doc.destroy();
  }
}
