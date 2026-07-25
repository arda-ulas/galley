import { describe, expect, it, vi } from "vitest";
import { parseRoute, replaceUrlWithSharedSheet, sheetPath } from "./route";
import type { ShareReceipt } from "./shareCoordinator";

const VALID_ID = "abcdefghij123456"; // 16 base64url chars
const VALID_ID_ALT = "ABCD_EFGH-123456";

describe("parseRoute", () => {
  it("maps the root path to the local draft", () => {
    expect(parseRoute("/")).toEqual({ kind: "draft" });
  });

  it("maps an exact valid single-segment id to a sheet route (verbatim id)", () => {
    expect(parseRoute(`/${VALID_ID}`)).toEqual({ kind: "sheet", sheetId: VALID_ID });
    expect(parseRoute(`/${VALID_ID_ALT}`)).toEqual({
      kind: "sheet",
      sheetId: VALID_ID_ALT,
    });
  });

  it.each([
    ["a 15-char id", "/abcdefghij12345"],
    ["a 17-char id", "/abcdefghij1234567"],
    ["an id with '+'", "/abcdefghij12345+"],
    ["an id with '/' (extra segment)", "/abcdefghij12345/6"],
    ["a trailing slash", `/${VALID_ID}/`],
    ["a leading extra segment", `/x/${VALID_ID}`],
    ["the legacy demo route", "/r/demo"],
    ["a ws route", `/ws/${VALID_ID}`],
    ["a bootstrap-style api route", `/api/sheets/${VALID_ID}`],
    ["a percent-encoded slash", `/${VALID_ID.slice(0, 15)}%2F`],
    ["the empty-after-root case", "//"],
  ])("maps %s to unavailable", (_label, pathname) => {
    expect(parseRoute(pathname)).toEqual({ kind: "unavailable" });
  });
});

describe("sheetPath", () => {
  it("returns exactly /{sheetId} for a valid id", () => {
    expect(sheetPath(VALID_ID)).toBe(`/${VALID_ID}`);
  });

  it.each([["", ""], ["15 chars", "abcdefghij12345"], ["with '/'", "abcdefghij12345/"]])(
    "throws before producing a path for an invalid id (%s)",
    (_label, id) => {
      expect(() => sheetPath(id)).toThrow();
    },
  );
});

describe("replaceUrlWithSharedSheet", () => {
  const receiptFor = (sheetId: string): ShareReceipt =>
    Object.freeze({
      sheetId,
      serverRevision: 1,
      committedStateVector: "AA==",
      committedMetadataRevision: 1,
      committedAt: 123,
    });

  it("calls replaceState exactly once with (null, \"\", /{id}) and no pushState", () => {
    const replaceState = vi.fn();
    const pushState = vi.fn();
    const historyLike = { replaceState, pushState } as unknown as History;

    replaceUrlWithSharedSheet(receiptFor(VALID_ID), historyLike);

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", `/${VALID_ID}`);
    expect(pushState).not.toHaveBeenCalled();
  });

  it("replaces with the clean path, dropping any prior query/hash", () => {
    const replaceState = vi.fn();
    replaceUrlWithSharedSheet(receiptFor(VALID_ID), { replaceState });
    const [, , path] = replaceState.mock.calls[0];
    expect(path).toBe(`/${VALID_ID}`);
    expect(path).not.toContain("?");
    expect(path).not.toContain("#");
  });

  it("throws before touching history when the receipt id is invalid", () => {
    const replaceState = vi.fn();
    expect(() =>
      replaceUrlWithSharedSheet(receiptFor("not-a-valid-id"), { replaceState }),
    ).toThrow();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
