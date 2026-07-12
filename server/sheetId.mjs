// Server-minted sheet identifiers. IDs are non-sequential and unguessable:
// 12 random bytes (96 bits of entropy) rendered URL-safe as exactly 16
// base64url characters. Never client-provided; never derived from any input.

import { randomBytes } from "node:crypto";

// 16 URL-safe characters: base64url alphabet, no padding (12 bytes → 16 chars).
const SHEET_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/** @returns {string} a fresh 16-char URL-safe sheet id */
export function generateSheetId() {
  return randomBytes(12).toString("base64url");
}

/**
 * Strict shape check for a sheet id (used by create-collision handling now and
 * WebSocket routing later). Accepts only the exact minted shape.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSheetId(value) {
  return typeof value === "string" && SHEET_ID_PATTERN.test(value);
}
