import { describe, expect, it } from "vitest";
import type { TokenStorage } from "./creationToken";
import {
  clearCreationToken,
  getOrCreateCreationToken,
  isUuidV4,
  peekCreationToken,
  ROOT_DRAFT_SCOPE,
} from "./creationToken";

/** An in-memory Storage stand-in — no DOM, fully observable. */
function fakeStorage(): TokenStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("creationToken store", () => {
  it("lazily creates a UUID v4 on first read", () => {
    const s = fakeStorage();
    expect(peekCreationToken(ROOT_DRAFT_SCOPE, s)).toBeNull();
    const token = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    expect(token).toMatch(UUID_V4);
    expect(peekCreationToken(ROOT_DRAFT_SCOPE, s)).toBe(token);
  });

  it("returns the SAME token on repeated reads (stable across retries)", () => {
    const s = fakeStorage();
    const a = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    const b = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    const c = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("survives a simulated refresh (same backing storage → same token)", () => {
    const s = fakeStorage();
    const before = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    // A refresh re-runs the module against the SAME sessionStorage contents.
    const afterRefresh = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    expect(afterRefresh).toBe(before);
  });

  it("explicit clear removes the token; a later read mints a fresh one", () => {
    const s = fakeStorage();
    const first = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    clearCreationToken(ROOT_DRAFT_SCOPE, s);
    expect(peekCreationToken(ROOT_DRAFT_SCOPE, s)).toBeNull();
    const second = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    expect(second).not.toBe(first);
  });

  it("isolates tokens per draft scope", () => {
    const s = fakeStorage();
    const rootTok = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    const otherTok = getOrCreateCreationToken("other", s);
    expect(otherTok).not.toBe(rootTok);
    // Clearing one scope does not touch the other.
    clearCreationToken(ROOT_DRAFT_SCOPE, s);
    expect(peekCreationToken(ROOT_DRAFT_SCOPE, s)).toBeNull();
    expect(peekCreationToken("other", s)).toBe(otherTok);
  });

  it("uses a draft-scoped key under the galley prefix", () => {
    const s = fakeStorage();
    getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    expect([...s.map.keys()]).toEqual(["galley:creationToken:root"]);
  });

  it("reuses a VALID persisted UUID v4 verbatim", () => {
    const s = fakeStorage();
    const valid = "3f8b1c2d-4e5a-4b6c-8d7e-9f0a1b2c3d4e";
    s.map.set("galley:creationToken:root", valid);
    expect(getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s)).toBe(valid);
  });

  it("rotates an arbitrary non-UUID persisted value to a fresh UUID v4", () => {
    const s = fakeStorage();
    s.map.set("galley:creationToken:root", "not-a-uuid");
    const rotated = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    expect(rotated).not.toBe("not-a-uuid");
    expect(isUuidV4(rotated)).toBe(true);
    // The rotated value was persisted, so a later read is stable.
    expect(peekCreationToken(ROOT_DRAFT_SCOPE, s)).toBe(rotated);
  });

  it.each([
    ["wrong version nibble", "3f8b1c2d-4e5a-1b6c-8d7e-9f0a1b2c3d4e"],
    ["wrong variant nibble", "3f8b1c2d-4e5a-4b6c-7d7e-9f0a1b2c3d4e"],
    ["too short", "3f8b1c2d-4e5a-4b6c-8d7e-9f0a1b2c3d4"],
    ["empty string", ""],
  ])("rotates a malformed UUID variant/version (%s)", (_label, bad) => {
    const s = fakeStorage();
    if (bad) s.map.set("galley:creationToken:root", bad);
    const rotated = getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s);
    expect(rotated).not.toBe(bad);
    expect(isUuidV4(rotated)).toBe(true);
  });

  it("propagates a throwing getItem (no swallow — caller owns the policy)", () => {
    const s: TokenStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(() => getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s)).toThrow();
  });

  it("propagates a throwing setItem during mint", () => {
    const s: TokenStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() => getOrCreateCreationToken(ROOT_DRAFT_SCOPE, s)).toThrow();
  });

  it("propagates a throwing removeItem from clear", () => {
    const s: TokenStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    expect(() => clearCreationToken(ROOT_DRAFT_SCOPE, s)).toThrow();
  });
});
