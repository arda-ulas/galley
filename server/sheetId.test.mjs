import { describe, expect, it } from "vitest";
import { generateSheetId, isValidSheetId } from "./sheetId.mjs";

describe("generateSheetId", () => {
  it("produces exactly 16 URL-safe characters", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateSheetId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    }
  });

  it("produces distinct ids (no collision across a large sample)", () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i++) seen.add(generateSheetId());
    expect(seen.size).toBe(1000);
  });
});

describe("isValidSheetId", () => {
  it("accepts a freshly generated id", () => {
    expect(isValidSheetId(generateSheetId())).toBe(true);
  });

  it("accepts every base64url character class at the right length", () => {
    expect(isValidSheetId("abcdEFGH1234_-_-")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isValidSheetId("abcdEFGH1234_-_")).toBe(false); // 15
    expect(isValidSheetId("abcdEFGH1234_-_-x")).toBe(false); // 17
  });

  it("rejects non-base64url characters and padding", () => {
    expect(isValidSheetId("abcdEFGH1234_-+/")).toBe(false);
    expect(isValidSheetId("abcdEFGH1234_-=x")).toBe(false);
    expect(isValidSheetId("abcd EFGH1234_-_")).toBe(false);
  });

  it("rejects non-strings and empty input", () => {
    expect(isValidSheetId("")).toBe(false);
    expect(isValidSheetId(null)).toBe(false);
    expect(isValidSheetId(undefined)).toBe(false);
    expect(isValidSheetId(1234567890123456)).toBe(false);
  });
});
