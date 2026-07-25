import { describe, expect, it } from "vitest";
import {
  decodeStandardBase64,
  encodeStandardBase64,
  isStandardBase64,
} from "./base64";

// The exact standard-base64 grammar the server accepts (rejects base64url).
const STANDARD_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decode standard base64 back to bytes (via atob), for round-trip checks. */
function decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 0xff;
  return b;
}

describe("encodeStandardBase64", () => {
  it("emits standard base64 (no base64url -/_), canonically padded", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 255, 256, 1000]) {
      const b64 = encodeStandardBase64(bytes(n));
      expect(b64).toMatch(STANDARD_BASE64);
      expect(b64).not.toMatch(/[-_]/);
    }
  });

  it("round-trips for lengths across every mod-3 residue", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 99, 100, 101]) {
      const input = bytes(n);
      expect(decode(encodeStandardBase64(input))).toEqual(input);
    }
  });

  it("pads correctly by residue", () => {
    expect(encodeStandardBase64(bytes(3)).endsWith("=")).toBe(false); // 3 → no pad
    expect(encodeStandardBase64(bytes(1)).endsWith("==")).toBe(true); // 1 → "=="
    expect(encodeStandardBase64(bytes(2)).endsWith("=")).toBe(true); // 2 → "="
    expect(encodeStandardBase64(bytes(2)).endsWith("==")).toBe(false);
  });

  it("round-trips a large payload that spans multiple internal chunks", () => {
    // 0x8000 is the internal chunk; exceed it to exercise the chunk boundary.
    const input = bytes(0x8000 * 2 + 123);
    expect(decode(encodeStandardBase64(input))).toEqual(input);
  });

  it("encodes bytes containing 0x00..0xff without corruption", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(decode(encodeStandardBase64(all))).toEqual(all);
  });
});

describe("isStandardBase64", () => {
  it("accepts well-formed standard base64 across residues", () => {
    expect(isStandardBase64("")).toBe(true);
    expect(isStandardBase64("AAAA")).toBe(true);
    expect(isStandardBase64("AA==")).toBe(true);
    expect(isStandardBase64("AAA=")).toBe(true);
    expect(isStandardBase64("/w==")).toBe(true); // uses the `/` alphabet char
  });

  it("rejects base64url characters, bad length, and misplaced padding", () => {
    expect(isStandardBase64("-_==")).toBe(false); // base64url alphabet
    expect(isStandardBase64("AAA")).toBe(false); // length not a multiple of 4
    expect(isStandardBase64("A===")).toBe(false); // too much padding
    expect(isStandardBase64("A=AA")).toBe(false); // padding not at the end
    expect(isStandardBase64("====")).toBe(false); // all padding
  });
});

describe("decodeStandardBase64", () => {
  it("round-trips with the encoder across every mod-3 residue", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 99, 100, 101]) {
      const input = bytes(n);
      expect(decodeStandardBase64(encodeStandardBase64(input))).toEqual(input);
    }
  });

  it("decodes a large payload spanning multiple internal chunks", () => {
    const input = bytes(0x8000 * 2 + 123);
    expect(decodeStandardBase64(encodeStandardBase64(input))).toEqual(input);
  });

  it("rejects base64url input", () => {
    expect(() => decodeStandardBase64("-_-_")).toThrow(RangeError);
  });

  it("rejects a length that is not a multiple of four", () => {
    expect(() => decodeStandardBase64("AAA")).toThrow(RangeError);
  });

  it("rejects non-canonical padding", () => {
    expect(() => decodeStandardBase64("A===")).toThrow(RangeError);
  });

  it("rejects non-canonical trailing bits (fails the canonical round-trip)", () => {
    // "AB==" decodes to the single byte 0x00, whose canonical encoding is "AA==".
    // The alphabet/padding check alone admits it; the round-trip rejects it.
    expect(isStandardBase64("AB==")).toBe(true);
    expect(() => decodeStandardBase64("AB==")).toThrow(RangeError);
  });
});
