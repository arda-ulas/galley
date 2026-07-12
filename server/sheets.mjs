// POST /api/sheets — the validated, idempotent durable-create endpoint.
//
// Flow: media type → size-capped body → JSON → known fields → creation token →
// rate limit (atomic IP+token) → base64 decode + decoded-size limits → title /
// language / schemaVersion → server-side Yjs canonicalization → canonical-state
// and visible-content limits → atomic create (with id-collision retry) →
// 201 (new) or 200 (idempotent replay). Every failure maps to a typed status
// with a client-safe body; internal details never leak.

import * as Y from "yjs";
import { canonicalizeSubmission, YjsValidationError } from "./yjs.mjs";
import { SheetIdCollisionError } from "./persistence/db.mjs";
import {
  ERROR_CODES,
  RequestError,
  respondInternalError,
  writeJson,
  writeJsonError,
  writeJsonErrorAndClose,
} from "./errors.mjs";
import {
  MAX_BODY_BYTES,
  MAX_CANONICAL_STATE_BYTES,
  MAX_SUBMITTED_UPDATE_BYTES,
  MAX_SUBMITTED_VECTOR_BYTES,
  MAX_VISIBLE_CONTENT_CODE_UNITS,
} from "./limits.mjs";
import {
  decodeBase64Field,
  validateBodyShape,
  validateCreationToken,
  validateLanguage,
  validateSchemaVersion,
  validateTitle,
} from "./validate.mjs";

const CREATE_ID_ATTEMPTS = 5;

// RFC 7231 token characters (parameter name / unquoted value).
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// Quoted-string content (no control chars, backslashes, or quotes).
const QUOTED = /^[^"\\\x00-\x1f\x7f]*$/;

/**
 * Strictly accept `application/json` with optional well-formed parameters
 * (e.g. `charset=utf-8`, quoted values). Rejects malformed parameters (missing
 * `=`, empty name/value/segment), suffix media types (application/json-patch+
 * json), and any non-json media type. Parameter names are case-insensitive.
 *
 * Parsing splits on `;`, so a semicolon INSIDE a quoted parameter value (e.g.
 * `charset="a;b"`) is deliberately unsupported and therefore rejected — the
 * accepted clients never send such values.
 */
function isJsonContentType(header) {
  if (typeof header !== "string") return false;
  const segments = header.split(";");
  if (segments[0].trim().toLowerCase() !== "application/json") return false;
  for (let i = 1; i < segments.length; i++) {
    const param = segments[i].trim();
    if (param === "") return false; // empty segment (`;;`, trailing `;`)
    const eq = param.indexOf("=");
    if (eq <= 0) return false; // missing `=` or empty name
    const name = param.slice(0, eq).trim();
    const value = param.slice(eq + 1).trim();
    if (!TOKEN.test(name)) return false;
    if (value.startsWith('"')) {
      if (value.length < 2 || !value.endsWith('"')) return false;
      if (!QUOTED.test(value.slice(1, -1))) return false;
    } else if (!TOKEN.test(value)) {
      return false;
    }
  }
  return true;
}

/**
 * Read the request body into a Buffer, rejecting once the running size exceeds
 * `maxBytes`. A declared Content-Length over the limit is rejected up front.
 * Settles exactly once, removes its listeners, and releases buffers on failure;
 * an oversize rejection is tagged `terminate` so the caller closes the
 * connection (rather than leaving unread bytes on a keep-alive socket).
 * @returns {Promise<Buffer>}
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {Buffer[] | null} */
    let chunks = [];
    let size = 0;

    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("close", onClose);
    };
    const settleResolve = (buf) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(buf);
    };
    const settleReject = (err) => {
      if (settled) return;
      settled = true;
      chunks = null; // release accumulated buffers promptly
      cleanup();
      reject(err);
    };
    const tooLarge = () =>
      new RequestError(
        413,
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        "Request body exceeds the size limit.",
        { terminate: true },
      );

    function onData(chunk) {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settleReject(tooLarge());
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() {
      settleResolve(Buffer.concat(chunks));
    }
    function onError(err) {
      settleReject(err);
    }
    // A close before `end` means the request was aborted; settle so the handler
    // promise never hangs.
    function onClose() {
      settleReject(new Error("request closed before completion"));
    }

    // Fast path: reject an oversized declared Content-Length before buffering.
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      settleReject(tooLarge());
      return;
    }

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
  });
}

/** Measure the visible content (UTF-16 code units) of a canonical update. */
function measureVisibleContent(canonicalUpdate) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, canonicalUpdate);
    return doc.getText("content").toString().length;
  } finally {
    doc.destroy();
  }
}

/** Mint an id and create; retry the whole atomic attempt on id collision. */
function createWithRetry(db, generateSheetId, params) {
  for (let attempt = 0; attempt < CREATE_ID_ATTEMPTS; attempt++) {
    const sheetId = generateSheetId();
    try {
      return db.createSheet({ sheetId, ...params });
    } catch (err) {
      if (err instanceof SheetIdCollisionError) continue;
      throw err;
    }
  }
  // Astronomically unlikely with 96-bit ids; surfaced as a 500 by the caller.
  throw new Error("sheet id collision retries exhausted");
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ db: any, rateLimiter: { checkCreate: (ip: string, token: string) => { ok: boolean } }, generateSheetId: () => string }} deps
 */
export async function handleCreateSheet(req, res, deps) {
  try {
    if (!isJsonContentType(req.headers["content-type"])) {
      throw new RequestError(
        415,
        ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
        "Content-Type must be application/json.",
      );
    }

    const raw = await readBody(req, MAX_BODY_BYTES);

    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new RequestError(
        400,
        ERROR_CODES.INVALID_JSON,
        "Request body is not valid JSON.",
      );
    }

    validateBodyShape(body);
    const creationToken = validateCreationToken(body.creationToken);

    // Rate limit AFTER the size-bounded body read and token validation, so the
    // atomic IP+token check runs before the expensive canonicalization/DB work.
    const ip = req.socket.remoteAddress ?? "unknown";
    if (!deps.rateLimiter.checkCreate(ip, creationToken).ok) {
      throw new RequestError(
        429,
        ERROR_CODES.RATE_LIMITED,
        "Too many create attempts. Try again later.",
      );
    }

    const submittedUpdate = decodeBase64Field(
      body.submittedUpdate,
      "submittedUpdate",
      MAX_SUBMITTED_UPDATE_BYTES,
    );
    const submittedStateVector = decodeBase64Field(
      body.submittedStateVector,
      "submittedStateVector",
      MAX_SUBMITTED_VECTOR_BYTES,
    );
    const title = validateTitle(body.title);
    const language = validateLanguage(body.language);
    const schemaVersion = validateSchemaVersion(body.schemaVersion);

    // Server-side canonicalization. Internal size limits are disabled here
    // (Infinity) so a structural failure/vector mismatch is a clean 400; the
    // canonical-state and visible-content 413 limits are enforced below.
    let canonicalUpdate;
    let canonicalStateVector;
    try {
      ({ canonicalUpdate, canonicalStateVector } = canonicalizeSubmission(
        submittedUpdate,
        submittedStateVector,
        {
          maxVisibleContentCodeUnits: Infinity,
          maxCanonicalStateBytes: Infinity,
        },
      ));
    } catch (err) {
      if (err instanceof YjsValidationError) {
        throw new RequestError(
          400,
          ERROR_CODES.INVALID_YJS_STATE,
          "Submitted state is invalid.",
        );
      }
      throw err;
    }

    if (canonicalUpdate.byteLength > MAX_CANONICAL_STATE_BYTES) {
      throw new RequestError(
        413,
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        "Canonical state exceeds the size limit.",
      );
    }
    if (measureVisibleContent(canonicalUpdate) > MAX_VISIBLE_CONTENT_CODE_UNITS) {
      throw new RequestError(
        413,
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        "Visible content exceeds the size limit.",
      );
    }

    const result = createWithRetry(deps.db, deps.generateSheetId, {
      creationToken,
      canonicalUpdate,
      canonicalStateVector,
      title,
      language,
      schemaVersion,
      committedAt: Date.now(),
    });

    writeJson(res, result.alreadyExisted ? 200 : 201, {
      sheetId: result.sheetId,
      serverRevision: result.serverRevision,
      committedStateVector: Buffer.from(result.committedStateVector).toString(
        "base64",
      ),
      committedMetadataRevision: result.committedMetadataRevision,
      committedAt: result.committedAt,
    });
  } catch (err) {
    if (err instanceof RequestError) {
      if (err.terminate) {
        // Oversized body: respond then deterministically close the connection.
        writeJsonErrorAndClose(res, err.status, err.code, err.message);
      } else {
        writeJsonError(res, err.status, err.code, err.message);
      }
      return;
    }
    // Unexpected (persistence/internal) — never leak stacks, paths, SQLite or
    // Yjs internals. A client abort leaves the response unwritable; that is not
    // a server fault, so only log when we could still have responded.
    if (!res.destroyed && !res.writableEnded) {
      console.error("create-sheet internal error:", err);
    }
    respondInternalError(res);
  }
}
