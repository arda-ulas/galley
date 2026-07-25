/**
 * Standard (RFC 4648 §4) base64 encoding for binary payloads (M4 S4).
 *
 * The create endpoint decodes `submittedUpdate` / `submittedStateVector` with a
 * STRICT standard-base64 validator (it rejects base64url's `-`/`_`), so we must
 * emit `+`/`/` with canonical `=` padding. The bytes are assembled into a binary
 * string in bounded chunks and encoded with a SINGLE `btoa` call — never by
 * base64-encoding arbitrary chunks and concatenating (which would inject padding
 * mid-stream and corrupt the result).
 */

// 0x8000 keeps each String.fromCharCode spread well under the argument-count
// limit while minimizing iterations.
const CHUNK = 0x8000;

// The exact standard-base64 grammar the server accepts (see server/validate.mjs):
// the RFC 4648 §4 alphabet ONLY (rejects base64url `-`/`_`), with canonical `=`
// padding. Anchored, so any stray character or misplaced padding fails.
const STANDARD_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Encode bytes as standard base64 (`+`/`/`, `=`-padded). */
export function encodeStandardBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * True iff `value` is well-formed standard base64: the length is a multiple of
 * four AND every character/padding position matches the RFC 4648 §4 grammar.
 * base64url (`-`/`_`), missing/misplaced padding, and stray characters all fail.
 */
export function isStandardBase64(value: string): boolean {
  return value.length % 4 === 0 && STANDARD_BASE64.test(value);
}

/**
 * Decode a CANONICAL standard-base64 string to bytes. Throws `RangeError` unless
 * the input is standard base64 (no base64url characters, valid padding) AND
 * canonical — re-encoding the decoded bytes reproduces the input exactly. The
 * round-trip is what rejects non-canonical trailing bits (e.g. `"AB=="`) that the
 * alphabet/padding check alone would admit. Mirrors the server's strict decode
 * (server/validate.mjs `decodeBase64Field`) so a receipt this accepts is a
 * byte-string the server itself would have accepted.
 */
export function decodeStandardBase64(value: string): Uint8Array {
  if (!isStandardBase64(value)) {
    throw new RangeError("value is not standard RFC 4648 base64");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (encodeStandardBase64(bytes) !== value) {
    throw new RangeError("value is not canonical base64");
  }
  return bytes;
}
