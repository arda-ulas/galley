// Typed request errors and safe JSON response writers for the create endpoint.
// Response bodies are always { error: <code>, message: <safe text> } and carry
// Cache-Control: no-store. Internal details (stacks, paths, SQLite/Yjs
// internals) are never written to the client.
//
// All writers are single-shot and guard against writing to an already-ended or
// destroyed response, so late/last-resort paths can never double-respond.

export const ERROR_CODES = Object.freeze({
  UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
  PAYLOAD_TOO_LARGE: "payload_too_large",
  INVALID_JSON: "invalid_json",
  UNKNOWN_FIELD: "unknown_field",
  MISSING_FIELD: "missing_field",
  INVALID_FIELD: "invalid_field",
  INVALID_YJS_STATE: "invalid_yjs_state",
  UNSUPPORTED_LANGUAGE: "unsupported_language",
  UNSUPPORTED_SCHEMA_VERSION: "unsupported_schema_version",
  RATE_LIMITED: "rate_limited",
  INTERNAL_ERROR: "internal_error",
});

/**
 * A validation/precondition failure carrying the exact HTTP status, machine
 * code, and a client-safe message. `terminate` marks failures (oversized body)
 * where the connection must be closed after the response.
 */
export class RequestError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message client-safe text (no internals)
   * @param {{ terminate?: boolean }} [opts]
   */
  constructor(status, code, message, opts = {}) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
    this.terminate = opts.terminate === true;
  }
}

const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});

/** True when the response can no longer be written to. */
function isUnwritable(res) {
  return res.destroyed || res.writableEnded || res.headersSent;
}

/** Write a JSON body with the standard headers. No-op if already committed. */
export function writeJson(res, status, body, extraHeaders) {
  if (isUnwritable(res)) return;
  res.writeHead(
    status,
    extraHeaders ? { ...JSON_HEADERS, ...extraHeaders } : { ...JSON_HEADERS },
  );
  res.end(JSON.stringify(body));
}

/** Write a typed error body ({ error, message }). No-op if already committed. */
export function writeJsonError(res, status, code, message, extraHeaders) {
  writeJson(res, status, { error: code, message }, extraHeaders);
}

/**
 * Write a typed error and then deterministically close the connection once the
 * response has flushed — so an unread oversized request body can never stall a
 * keep-alive connection.
 */
export function writeJsonErrorAndClose(res, status, code, message) {
  if (isUnwritable(res)) return;
  res.writeHead(status, { ...JSON_HEADERS, Connection: "close" });
  res.end(JSON.stringify({ error: code, message }), () => {
    res.socket?.destroy();
  });
}

/**
 * Centralized last-resort responder. If nothing has been sent, emit one generic
 * 500. If headers were already sent but the stream is still writable, end it
 * once. If the response is already ended/destroyed, do nothing.
 */
export function respondInternalError(res) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(500, { ...JSON_HEADERS });
  res.end(
    JSON.stringify({
      error: ERROR_CODES.INTERNAL_ERROR,
      message: "An internal error occurred.",
    }),
  );
}
