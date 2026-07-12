import { describe, expect, it } from "vitest";
import { RequestError } from "./errors.mjs";
import {
  decodeBase64Field,
  validateBodyShape,
  validateCreationToken,
  validateLanguage,
  validateSchemaVersion,
  validateTitle,
} from "./validate.mjs";

/** Capture a thrown RequestError and assert its status + code. */
function expectRequestError(fn, status, code) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(RequestError);
  expect(err.status).toBe(status);
  expect(err.code).toBe(code);
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

describe("validateBodyShape", () => {
  it("accepts an object with only known fields", () => {
    expect(() =>
      validateBodyShape({ creationToken: "x", submittedUpdate: "y" }),
    ).not.toThrow();
  });
  it("rejects non-objects", () => {
    expectRequestError(() => validateBodyShape(null), 400, "invalid_json");
    expectRequestError(() => validateBodyShape([]), 400, "invalid_json");
    expectRequestError(() => validateBodyShape("s"), 400, "invalid_json");
  });
  it("rejects unknown fields", () => {
    expectRequestError(() => validateBodyShape({ nope: 1 }), 400, "unknown_field");
  });
});

describe("validateCreationToken", () => {
  it("accepts a canonical lowercase UUID v4 unchanged", () => {
    expect(validateCreationToken("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });
  it("normalizes an uppercase canonical-equivalent token to lowercase", () => {
    expect(validateCreationToken("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });
  it("rejects a missing token", () => {
    expectRequestError(() => validateCreationToken(undefined), 400, "missing_field");
  });
  it("rejects an invalid version nibble (not 4)", () => {
    expectRequestError(
      () => validateCreationToken("550e8400-e29b-11d4-a716-446655440000"),
      400,
      "invalid_field",
    );
  });
  it("rejects an invalid variant nibble (not 8/9/a/b)", () => {
    expectRequestError(
      () => validateCreationToken("550e8400-e29b-41d4-c716-446655440000"),
      400,
      "invalid_field",
    );
  });
  it("rejects a malformed near-match and wrong type", () => {
    expectRequestError(() => validateCreationToken("not-a-uuid"), 400, "invalid_field");
    // one character short in the final group
    expectRequestError(
      () => validateCreationToken("550e8400-e29b-41d4-a716-44665544000"),
      400,
      "invalid_field",
    );
    expectRequestError(() => validateCreationToken(12345), 400, "invalid_field");
  });
});

describe("decodeBase64Field", () => {
  it("accepts and decodes standard base64", () => {
    const bytes = decodeBase64Field(b64([1, 2, 3]), "f", 1024);
    expect([...bytes]).toEqual([1, 2, 3]);
  });
  it("rejects a missing / non-string field", () => {
    expectRequestError(() => decodeBase64Field(undefined, "f", 1024), 400, "missing_field");
    expectRequestError(() => decodeBase64Field(123, "f", 1024), 400, "invalid_field");
  });
  it("rejects base64url input", () => {
    // bytes [0xfb, 0xff] → standard "+/8=", base64url "-_8="
    expectRequestError(() => decodeBase64Field("-_8=", "f", 1024), 400, "invalid_field");
  });
  it("rejects bad length/padding", () => {
    expectRequestError(() => decodeBase64Field("AQI", "f", 1024), 400, "invalid_field");
  });
  it("rejects non-canonical base64", () => {
    // "AQJ=" decodes to [1,2] but re-encodes to "AQI="
    expectRequestError(() => decodeBase64Field("AQJ=", "f", 1024), 400, "invalid_field");
  });
  it("enforces the decoded byte limit (413)", () => {
    expectRequestError(() => decodeBase64Field(b64([1, 2, 3, 4]), "f", 3), 413, "payload_too_large");
  });
});

describe("validateTitle", () => {
  it("defaults an absent title to empty string", () => {
    expect(validateTitle(undefined)).toBe("");
  });
  it("accepts up to 200 code points", () => {
    expect(validateTitle("a".repeat(200))).toBe("a".repeat(200));
    // Emoji count as ONE code point each (two UTF-16 units).
    expect(() => validateTitle("😀".repeat(200))).not.toThrow();
  });
  it("rejects over 200 code points", () => {
    expectRequestError(() => validateTitle("a".repeat(201)), 400, "invalid_field");
    expectRequestError(() => validateTitle("😀".repeat(201)), 400, "invalid_field");
  });
  it("rejects a non-string title", () => {
    expectRequestError(() => validateTitle(5), 400, "invalid_field");
  });
});

describe("validateLanguage", () => {
  it("accepts each allowlisted language", () => {
    for (const l of ["javascript", "typescript", "python", "plaintext"]) {
      expect(validateLanguage(l)).toBe(l);
    }
  });
  it("rejects an unsupported language (422)", () => {
    expectRequestError(() => validateLanguage("ruby"), 422, "unsupported_language");
    expectRequestError(() => validateLanguage(""), 422, "unsupported_language");
  });
  it("rejects a missing / non-string language", () => {
    expectRequestError(() => validateLanguage(undefined), 400, "missing_field");
    expectRequestError(() => validateLanguage(5), 400, "invalid_field");
  });
});

describe("validateSchemaVersion", () => {
  it("accepts exactly 0", () => {
    expect(validateSchemaVersion(0)).toBe(0);
  });
  it("rejects a non-zero integer (422)", () => {
    expectRequestError(() => validateSchemaVersion(1), 422, "unsupported_schema_version");
    expectRequestError(() => validateSchemaVersion(-1), 422, "unsupported_schema_version");
  });
  it("rejects a non-integer / wrong type (400)", () => {
    expectRequestError(() => validateSchemaVersion(0.5), 400, "invalid_field");
    expectRequestError(() => validateSchemaVersion("0"), 400, "invalid_field");
  });
  it("rejects a missing schemaVersion", () => {
    expectRequestError(() => validateSchemaVersion(undefined), 400, "missing_field");
  });
});
