// Strict request-field validation for POST /api/sheets. Each validator throws a
// typed RequestError (status + code + safe message) on failure and returns the
// accepted value on success. No coercion of wrong-typed inputs.

import { ERROR_CODES, RequestError } from "./errors.mjs";
import {
  LANGUAGE_ALLOWLIST,
  MAX_TITLE_CODE_POINTS,
  SCHEMA_VERSION,
} from "./limits.mjs";

const KNOWN_FIELDS = Object.freeze([
  "creationToken",
  "submittedUpdate",
  "submittedStateVector",
  "title",
  "language",
  "schemaVersion",
]);

// Canonical UUID v4 (version nibble 4, variant nibble 8/9/a/b).
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Standard base64 alphabet only (rejects base64url `-`/`_`), correct padding.
const STANDARD_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The request body must be a plain JSON object with only known fields. */
export function validateBodyShape(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(
      400,
      ERROR_CODES.INVALID_JSON,
      "Request body must be a JSON object.",
    );
  }
  for (const key of Object.keys(body)) {
    if (!KNOWN_FIELDS.includes(key)) {
      throw new RequestError(
        400,
        ERROR_CODES.UNKNOWN_FIELD,
        `Unknown field: ${key}`,
      );
    }
  }
}

/**
 * Validate a UUID v4 creation token and return its canonical lowercase form.
 * Normalizing means case-equivalent tokens map to the SAME rate-limit and
 * persistence key (uppercase and lowercase are one identity).
 * @returns {string} the normalized (lowercase) token
 */
export function validateCreationToken(value) {
  if (value === undefined) {
    throw new RequestError(
      400,
      ERROR_CODES.MISSING_FIELD,
      "Missing field: creationToken",
    );
  }
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new RequestError(
      400,
      ERROR_CODES.INVALID_FIELD,
      "Field 'creationToken' must be a canonical UUID v4.",
    );
  }
  return value.toLowerCase();
}

/**
 * Strictly decode a standard-base64 field and enforce a decoded byte limit.
 * Rejects base64url, bad padding/length, and non-canonical encodings.
 * @returns {Uint8Array}
 */
export function decodeBase64Field(value, field, maxBytes) {
  if (value === undefined) {
    throw new RequestError(
      400,
      ERROR_CODES.MISSING_FIELD,
      `Missing field: ${field}`,
    );
  }
  if (typeof value !== "string") {
    throw new RequestError(
      400,
      ERROR_CODES.INVALID_FIELD,
      `Field '${field}' must be a base64 string.`,
    );
  }
  if (value.length % 4 !== 0 || !STANDARD_BASE64.test(value)) {
    throw new RequestError(
      400,
      ERROR_CODES.INVALID_FIELD,
      `Field '${field}' must be standard base64.`,
    );
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  // Canonical round-trip: standard base64 re-encoding must reproduce the input
  // exactly (rejects non-canonical trailing bits).
  if (Buffer.from(bytes).toString("base64") !== value) {
    throw new RequestError(
      400,
      ERROR_CODES.INVALID_FIELD,
      `Field '${field}' is not canonical base64.`,
    );
  }
  if (bytes.byteLength > maxBytes) {
    throw new RequestError(
      413,
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      `Field '${field}' exceeds the size limit.`,
    );
  }
  return bytes;
}

/** Optional title; absent → "". @returns {string} */
export function validateTitle(value) {
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new RequestError(
      400,
      ERROR_CODES.INVALID_FIELD,
      "Field 'title' must be a string.",
    );
  }
  // Count Unicode code points (not UTF-16 units).
  if ([...value].length > MAX_TITLE_CODE_POINTS) {
    throw new RequestError(
      400,
      ERROR_CODES.INVALID_FIELD,
      "Field 'title' exceeds the length limit.",
    );
  }
  return value;
}

/** @returns {string} the validated language */
export function validateLanguage(value) {
  if (value === undefined) {
    throw new RequestError(
      400,
      ERROR_CODES.MISSING_FIELD,
      "Missing field: language",
    );
  }
  if (typeof value !== "string") {
    throw new RequestError(
      400,
      ERROR_CODES.INVALID_FIELD,
      "Field 'language' must be a string.",
    );
  }
  if (!LANGUAGE_ALLOWLIST.includes(value)) {
    throw new RequestError(
      422,
      ERROR_CODES.UNSUPPORTED_LANGUAGE,
      "Unsupported language.",
    );
  }
  return value;
}

/** @returns {number} the validated schema version (exactly SCHEMA_VERSION) */
export function validateSchemaVersion(value) {
  if (value === undefined) {
    throw new RequestError(
      400,
      ERROR_CODES.MISSING_FIELD,
      "Missing field: schemaVersion",
    );
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RequestError(
      400,
      ERROR_CODES.INVALID_FIELD,
      "Field 'schemaVersion' must be an integer.",
    );
  }
  if (value !== SCHEMA_VERSION) {
    throw new RequestError(
      422,
      ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      "Unsupported schema version.",
    );
  }
  return value;
}
