import { describe, expect, it } from "vitest";
import { isValidSheetId, SHEET_ID_PATTERN } from "./sheetId";

// These vectors intentionally mirror server/sheetId.test.mjs so the client
// shape gate can never drift from the server's canonical id shape.
describe("isValidSheetId", () => {
  it("accepts representative valid ids (every base64url class, right length)", () => {
    expect(isValidSheetId("abcdEFGH1234_-_-")).toBe(true);
    expect(isValidSheetId("abcdefghij123456")).toBe(true);
    expect(isValidSheetId("ABCDEFGHIJKLMNOP")).toBe(true);
    expect(isValidSheetId("________________")).toBe(true);
    expect(isValidSheetId("----------------")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isValidSheetId("abcdEFGH1234_-_")).toBe(false); // 15
    expect(isValidSheetId("abcdEFGH1234_-_-x")).toBe(false); // 17
  });

  it("rejects non-base64url characters and padding", () => {
    expect(isValidSheetId("abcdEFGH1234_-+x")).toBe(false); // '+'
    expect(isValidSheetId("abcdEFGH1234_-/x")).toBe(false); // '/'
    expect(isValidSheetId("abcdEFGH1234_-=x")).toBe(false); // '='
    expect(isValidSheetId("abcd EFGH1234_-_")).toBe(false); // space
  });

  it("rejects empty and non-string input", () => {
    expect(isValidSheetId("")).toBe(false);
    expect(isValidSheetId(null)).toBe(false);
    expect(isValidSheetId(undefined)).toBe(false);
    expect(isValidSheetId(1234567890123456)).toBe(false);
    expect(isValidSheetId({})).toBe(false);
    expect(isValidSheetId(["abcdefghij123456"])).toBe(false);
  });

  it("exposes the exact canonical pattern", () => {
    expect(SHEET_ID_PATTERN.source).toBe("^[A-Za-z0-9_-]{16}$");
  });
});
