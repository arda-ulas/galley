import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimiter.mjs";

/** A controllable clock. */
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("createRateLimiter — per-dimension limits", () => {
  it("admits up to the IP limit, then rejects with reason 'ip'", () => {
    const rl = createRateLimiter({ windowMs: 1000, ipLimit: 3, tokenLimit: 100, clock: fakeClock() });
    for (let i = 0; i < 3; i++) expect(rl.checkCreate("1.1.1.1", `t${i}`).ok).toBe(true);
    expect(rl.checkCreate("1.1.1.1", "t9")).toEqual({ ok: false, reason: "ip" });
  });

  it("admits up to the token limit, then rejects with reason 'token'", () => {
    const rl = createRateLimiter({ windowMs: 1000, ipLimit: 100, tokenLimit: 2, clock: fakeClock() });
    expect(rl.checkCreate("a", "tok").ok).toBe(true);
    expect(rl.checkCreate("b", "tok").ok).toBe(true);
    expect(rl.checkCreate("c", "tok")).toEqual({ ok: false, reason: "token" });
  });

  it("resets a dimension after the window elapses", () => {
    const clock = fakeClock();
    const rl = createRateLimiter({ windowMs: 1000, ipLimit: 1, tokenLimit: 100, clock });
    expect(rl.checkCreate("ip", "t1").ok).toBe(true);
    expect(rl.checkCreate("ip", "t2").ok).toBe(false);
    clock.advance(1000);
    expect(rl.checkCreate("ip", "t3").ok).toBe(true);
  });
});

describe("createRateLimiter — non-mutating until admission", () => {
  it("a token rejection does not insert/increment/reset IP state", () => {
    const rl = createRateLimiter({ windowMs: 1000, ipLimit: 5, tokenLimit: 1, clock: fakeClock() });
    expect(rl.checkCreate("ipX", "tokY").ok).toBe(true); // ip=1
    // Rejected on token — existing IP entry must be untouched.
    expect(rl.checkCreate("ipX", "tokY")).toEqual({ ok: false, reason: "token" });
    expect(rl.__test.ipEntry("ipX").count).toBe(1);
    // Rejected on token with a NEW ip — that ip must NOT be inserted.
    expect(rl.checkCreate("ipNew", "tokY")).toEqual({ ok: false, reason: "token" });
    expect(rl.__test.ipEntry("ipNew")).toBeUndefined();
  });

  it("an IP rejection does not insert/increment/reset token state", () => {
    const rl = createRateLimiter({ windowMs: 1000, ipLimit: 1, tokenLimit: 5, clock: fakeClock() });
    expect(rl.checkCreate("ipX", "tokA").ok).toBe(true); // tokA=1
    expect(rl.checkCreate("ipX", "tokA")).toEqual({ ok: false, reason: "ip" });
    expect(rl.__test.tokenEntry("tokA").count).toBe(1);
    expect(rl.checkCreate("ipX", "tokNew")).toEqual({ ok: false, reason: "ip" });
    expect(rl.__test.tokenEntry("tokNew")).toBeUndefined();
  });
});

describe("createRateLimiter — bounded eviction", () => {
  it("rejected requests at capacity cannot evict an active oldest entry", () => {
    const rl = createRateLimiter({
      windowMs: 10_000,
      ipLimit: 100,
      tokenLimit: 1,
      maxEntries: 2,
      clock: fakeClock(),
    });
    expect(rl.checkCreate("ip1", "tA").ok).toBe(true);
    expect(rl.checkCreate("ip2", "tB").ok).toBe(true);
    expect(rl.size().ip).toBe(2); // at capacity

    // Many rejected attempts (token over its limit) with fresh ips.
    for (let i = 0; i < 20; i++) {
      expect(rl.checkCreate(`ipR${i}`, "tA")).toEqual({ ok: false, reason: "token" });
    }
    expect(rl.size().ip).toBe(2); // unchanged
    expect(rl.__test.ipEntry("ip1")).toBeDefined(); // oldest still present
    expect(rl.__test.ipEntry("ipR0")).toBeUndefined(); // never inserted
  });

  it("an admitted request can still trigger bounded eviction of the oldest", () => {
    const rl = createRateLimiter({
      windowMs: 10_000,
      ipLimit: 100,
      tokenLimit: 100,
      maxEntries: 2,
      clock: fakeClock(),
    });
    rl.checkCreate("ip1", "tA");
    rl.checkCreate("ip2", "tB");
    expect(rl.size().ip).toBe(2);
    expect(rl.checkCreate("ip3", "tC").ok).toBe(true); // admitted → evicts oldest
    expect(rl.size().ip).toBe(2);
    expect(rl.__test.ipEntry("ip1")).toBeUndefined(); // evicted
    expect(rl.__test.ipEntry("ip3")).toBeDefined();
  });
});

describe("createRateLimiter — expiry reset only on admission", () => {
  it("does not reset an expired entry when the request is rejected", () => {
    const clock = fakeClock();
    const rl = createRateLimiter({ windowMs: 1000, ipLimit: 1, tokenLimit: 1, clock });
    rl.checkCreate("ip", "tokOld"); // ip windowStart=0, count=1
    clock.advance(1200); // 'tokMax' set fresh below is not yet expired
    rl.checkCreate("ipOther", "tokMax"); // tokMax windowStart=1200, count=1

    // 'ip' is expired (would admit on its own) but tokMax is over its limit.
    expect(rl.checkCreate("ip", "tokMax")).toEqual({ ok: false, reason: "token" });
    // The expired IP entry must NOT have been reset by the rejected attempt.
    expect(rl.__test.ipEntry("ip").windowStart).toBe(0);
    expect(rl.__test.ipEntry("ip").count).toBe(1);

    // A successful admission DOES reset the expired entry.
    expect(rl.checkCreate("ip", "tokFresh").ok).toBe(true);
    expect(rl.__test.ipEntry("ip").windowStart).toBe(1200);
    expect(rl.__test.ipEntry("ip").count).toBe(1);
  });
});

describe("createRateLimiter — atomic dual limit", () => {
  it("a token rejection consumes no IP quota", () => {
    const rl = createRateLimiter({ windowMs: 1000, ipLimit: 2, tokenLimit: 1, clock: fakeClock() });
    expect(rl.checkCreate("ipA", "tok1").ok).toBe(true); // ip=1
    expect(rl.checkCreate("ipA", "tok1")).toEqual({ ok: false, reason: "token" });
    // IP still at 1 → a different token still admits.
    expect(rl.checkCreate("ipA", "tok2").ok).toBe(true);
  });
});

describe("createRateLimiter — maxEntries validation", () => {
  it("maxEntries: 1 works and stays bounded", () => {
    const rl = createRateLimiter({
      windowMs: 10_000,
      ipLimit: 100,
      tokenLimit: 100,
      maxEntries: 1,
      clock: fakeClock(),
    });
    rl.checkCreate("ip1", "t1");
    rl.checkCreate("ip2", "t2");
    rl.checkCreate("ip3", "t3");
    expect(rl.size().ip).toBe(1);
    expect(rl.size().token).toBe(1);
    expect(rl.__test.ipEntry("ip3")).toBeDefined(); // newest retained
    expect(rl.__test.ipEntry("ip1")).toBeUndefined(); // evicted
  });

  it("rejects an invalid maxEntries with a TypeError", () => {
    for (const bad of [0, -1, 2.5, "10", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createRateLimiter({ maxEntries: bad })).toThrow(TypeError);
    }
  });
});

describe("createRateLimiter — clear", () => {
  it("drops all tracked state", () => {
    const rl = createRateLimiter({ windowMs: 1000, ipLimit: 5, tokenLimit: 5, clock: fakeClock() });
    rl.checkCreate("ip", "tok");
    expect(rl.size()).toEqual({ ip: 1, token: 1 });
    rl.clear();
    expect(rl.size()).toEqual({ ip: 0, token: 0 });
  });
});
