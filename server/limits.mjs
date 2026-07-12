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
