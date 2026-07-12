// Approved create-endpoint limits and the language allowlist. Single source of
// truth for the values enforced by the request validator, the Yjs
// canonicalizer, and the rate limiter.

export const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB raw JSON request body
export const MAX_SUBMITTED_UPDATE_BYTES = 512 * 1024; // 512 KiB decoded update
export const MAX_SUBMITTED_VECTOR_BYTES = 64 * 1024; // 64 KiB decoded vector
export const MAX_CANONICAL_STATE_BYTES = 512 * 1024; // 512 KiB server-canonical state
export const MAX_VISIBLE_CONTENT_CODE_UNITS = 250_000; // UTF-16 code units
export const MAX_TITLE_CODE_POINTS = 200; // Unicode code points

// schemaVersion must be exactly this value in v1.
export const SCHEMA_VERSION = 0;

// The only accepted languages.
export const LANGUAGE_ALLOWLIST = Object.freeze([
  "javascript",
  "typescript",
  "python",
  "plaintext",
]);

// Fixed-window per-IP and per-creation-token create rate limits.
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_IP_MAX = 30;
export const RATE_LIMIT_TOKEN_MAX = 10;

// --- Collaboration WebSocket message-boundary limits (M4) ------------------
// Conservative caps that let malformed/oversized client frames be contained to
// the offending socket without ever rejecting valid collaboration. Each is
// grounded in the HTTP/Yjs create limits above.

// Max raw inbound WebSocket frame, checked BEFORE any decoder work. Equal to the
// create-request body cap (1 MiB): comfortably larger than a full canonical
// sheet (512 KiB) plus sync/awareness framing, so a maximum-size initial sync
// always fits within a single frame.
export const MAX_WS_FRAME_BYTES = MAX_BODY_BYTES; // 1 MiB

// Max decoded Yjs sync update / step-2 payload, checked BEFORE Y.applyUpdate so
// an oversized update can never mutate the room doc. Equal to the canonical
// state cap, so the full initial sync of a maximum-size sheet is always
// accepted while unbounded live updates are not.
export const MAX_WS_SYNC_UPDATE_BYTES = MAX_CANONICAL_STATE_BYTES; // 512 KiB

// Max decoded awareness update payload, checked BEFORE applyAwarenessUpdate. The
// intended presence payload (name + color + cursor anchor/head) is well under
// 1 KiB; 16 KiB gives generous headroom while staying strictly bounded.
export const MAX_WS_AWARENESS_BYTES = 16 * 1024; // 16 KiB
