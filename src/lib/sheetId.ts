/**
 * Client-side sheet-id SHAPE authority (M4 S5).
 *
 * A single browser-safe mirror of the server's canonical id shape
 * (`server/sheetId.mjs`): exactly 16 URL-safe base64url characters. The SERVER
 * remains the only authority for whether an id resolves to a live sheet — this
 * gate merely lets the client resolve route kind and refuse obviously-malformed
 * ids WITHOUT a network round-trip. It is never an existence or authorization
 * check.
 *
 * `server/sheetId.mjs` is intentionally NOT imported here: it pulls in
 * `node:crypto` (for id minting) and must not cross into the browser bundle. The
 * two files are kept in sync by shared test vectors, not a shared import.
 */

/** The exact minted id shape: 16 base64url chars (A–Z a–z 0–9 `_` `-`). */
export const SHEET_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/** True iff `value` is a string matching the canonical sheet-id shape. */
export function isValidSheetId(value: unknown): value is string {
  return typeof value === "string" && SHEET_ID_PATTERN.test(value);
}
