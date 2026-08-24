// Unit coverage for the bounded trusted-proxy client-address policy (M4.5 T4).
// The security-relevant property under test is that an UNTRUSTED peer can never
// influence the resolved address, no matter what it puts in X-Forwarded-For.

import { describe, expect, it } from "vitest";
import {
  createClientAddressResolver,
  isTrustedPeer,
  normalizeAddress,
  parseTrustedProxies,
  resolveClientAddress,
  resolveTrustProxyPolicy,
  UNKNOWN_ADDRESS,
} from "./clientAddress.mjs";

/** Minimal request double: only the fields the resolver reads. */
function req(remoteAddress, headers = {}) {
  return { socket: { remoteAddress }, headers };
}

describe("normalizeAddress", () => {
  it("unwraps IPv4-mapped IPv6 to the dotted quad", () => {
    expect(normalizeAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeAddress("::FFFF:10.0.0.1")).toBe("10.0.0.1");
  });

  it("strips an IPv6 zone id", () => {
    expect(normalizeAddress("fe80::1%eth0")).toBe("fe80::1");
  });

  it("returns null for blank and non-string input", () => {
    expect(normalizeAddress("")).toBeNull();
    expect(normalizeAddress("   ")).toBeNull();
    expect(normalizeAddress(undefined)).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
  });

  it("passes plain addresses through unchanged", () => {
    expect(normalizeAddress("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeAddress("::1")).toBe("::1");
  });
});

describe("parseTrustedProxies", () => {
  it("returns an empty rule set for unset/blank input (trust nothing)", () => {
    expect(parseTrustedProxies(undefined)).toEqual([]);
    expect(parseTrustedProxies(null)).toEqual([]);
    expect(parseTrustedProxies("")).toEqual([]);
    expect(parseTrustedProxies("   ")).toEqual([]);
  });

  it("parses exact addresses and comma/space separated lists", () => {
    const rules = parseTrustedProxies("10.0.0.5, 192.168.1.9  ::1");
    expect(rules).toHaveLength(3);
    expect(rules.every((r) => r.kind === "exact")).toBe(true);
  });

  it("expands the loopback sentinel to the v4 range and ::1", () => {
    const rules = parseTrustedProxies("loopback");
    expect(isTrustedPeer("127.0.0.1", rules)).toBe(true);
    expect(isTrustedPeer("127.9.9.9", rules)).toBe(true);
    expect(isTrustedPeer("::1", rules)).toBe(true);
    expect(isTrustedPeer("10.0.0.1", rules)).toBe(false);
  });

  it("parses IPv4 CIDR and matches only inside the range", () => {
    const rules = parseTrustedProxies("172.18.0.0/16");
    expect(isTrustedPeer("172.18.0.1", rules)).toBe(true);
    expect(isTrustedPeer("172.18.255.254", rules)).toBe(true);
    expect(isTrustedPeer("172.19.0.1", rules)).toBe(false);
    expect(isTrustedPeer("10.0.0.1", rules)).toBe(false);
  });

  it("handles the /32 and /0 prefix edges", () => {
    const exact = parseTrustedProxies("203.0.113.4/32");
    expect(isTrustedPeer("203.0.113.4", exact)).toBe(true);
    expect(isTrustedPeer("203.0.113.5", exact)).toBe(false);
    const all = parseTrustedProxies("0.0.0.0/0");
    expect(isTrustedPeer("8.8.8.8", all)).toBe(true);
  });

  it("matches an IPv4-mapped peer against an IPv4 CIDR", () => {
    const rules = parseTrustedProxies("172.18.0.0/16");
    expect(isTrustedPeer("::ffff:172.18.0.9", rules)).toBe(true);
  });

  it("throws on malformed entries rather than silently trusting the wrong set", () => {
    expect(() => parseTrustedProxies("not an ip")).toThrow(/invalid trusted proxy/i);
    expect(() => parseTrustedProxies("10.0.0.0/33")).toThrow(/prefix/i);
    expect(() => parseTrustedProxies("::1/64")).toThrow(/IPv4 only/i);
  });
});

describe("isTrustedPeer", () => {
  it("trusts nothing when the rule set is empty", () => {
    expect(isTrustedPeer("127.0.0.1", [])).toBe(false);
    expect(isTrustedPeer("127.0.0.1", undefined)).toBe(false);
  });

  it("rejects an unknown/blank peer address", () => {
    const rules = parseTrustedProxies("loopback");
    expect(isTrustedPeer(undefined, rules)).toBe(false);
    expect(isTrustedPeer("", rules)).toBe(false);
  });
});

describe("resolveClientAddress — untrusted peer (the anti-spoofing guarantee)", () => {
  const policy = { trusted: parseTrustedProxies(""), hops: 1 };

  it("ignores X-Forwarded-For entirely when nothing is trusted", () => {
    const addr = resolveClientAddress(
      req("198.51.100.20", { "x-forwarded-for": "1.2.3.4" }),
      policy,
    );
    expect(addr).toBe("198.51.100.20");
  });

  it("ignores a multi-entry forged chain", () => {
    const addr = resolveClientAddress(
      req("198.51.100.20", { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" }),
      policy,
    );
    expect(addr).toBe("198.51.100.20");
  });

  it("ignores the header from a peer outside the trusted range", () => {
    const scoped = { trusted: parseTrustedProxies("172.18.0.0/16"), hops: 1 };
    const addr = resolveClientAddress(
      req("203.0.113.99", { "x-forwarded-for": "1.2.3.4" }),
      scoped,
    );
    expect(addr).toBe("203.0.113.99");
  });

  it("falls back to the unknown sentinel when there is no peer at all", () => {
    expect(resolveClientAddress(req(undefined), policy)).toBe(UNKNOWN_ADDRESS);
  });
});

describe("resolveClientAddress — trusted peer", () => {
  const policy = { trusted: parseTrustedProxies("loopback"), hops: 1 };

  it("takes the client address a single trusted proxy forwarded", () => {
    const addr = resolveClientAddress(
      req("127.0.0.1", { "x-forwarded-for": "203.0.113.7" }),
      policy,
    );
    expect(addr).toBe("203.0.113.7");
  });

  it("walks back exactly `hops` entries, ignoring extra client-supplied ones", () => {
    // The client forged "1.2.3.4"; the trusted proxy appended the real peer it
    // saw. With one trusted hop the forged entry must NOT be selected.
    const addr = resolveClientAddress(
      req("127.0.0.1", { "x-forwarded-for": "1.2.3.4, 203.0.113.7" }),
      policy,
    );
    expect(addr).toBe("203.0.113.7");
  });

  it("selects the correct entry with two trusted hops", () => {
    const twoHops = { trusted: parseTrustedProxies("loopback"), hops: 2 };
    const addr = resolveClientAddress(
      req("127.0.0.1", { "x-forwarded-for": "203.0.113.7, 172.16.0.2" }),
      twoHops,
    );
    expect(addr).toBe("203.0.113.7");
  });

  it("clamps to the furthest known entry when the chain is shorter than hops", () => {
    const fiveHops = { trusted: parseTrustedProxies("loopback"), hops: 5 };
    const addr = resolveClientAddress(
      req("127.0.0.1", { "x-forwarded-for": "203.0.113.7" }),
      fiveHops,
    );
    expect(addr).toBe("203.0.113.7");
  });

  it("returns the peer when a trusted proxy sends no header", () => {
    expect(resolveClientAddress(req("127.0.0.1"), policy)).toBe("127.0.0.1");
  });

  it("normalizes forwarded entries and skips blank ones", () => {
    const addr = resolveClientAddress(
      req("127.0.0.1", { "x-forwarded-for": " ::ffff:203.0.113.7 ,, " }),
      policy,
    );
    expect(addr).toBe("203.0.113.7");
  });

  it("joins a repeated header array before walking the chain", () => {
    const addr = resolveClientAddress(
      req("127.0.0.1", { "x-forwarded-for": ["1.2.3.4", "203.0.113.7"] }),
      policy,
    );
    expect(addr).toBe("203.0.113.7");
  });
});

describe("resolveTrustProxyPolicy", () => {
  it("is disabled by default", () => {
    const policy = resolveTrustProxyPolicy({});
    expect(policy.enabled).toBe(false);
    expect(policy.trusted).toEqual([]);
    expect(policy.hops).toBe(1);
  });

  it("enables only when trusted proxies are configured", () => {
    const policy = resolveTrustProxyPolicy({ GALLEY_TRUSTED_PROXIES: "loopback" });
    expect(policy.enabled).toBe(true);
  });

  it("does NOT enable from a hop count alone", () => {
    const policy = resolveTrustProxyPolicy({ GALLEY_TRUST_PROXY_HOPS: "3" });
    expect(policy.enabled).toBe(false);
    expect(policy.hops).toBe(3);
  });

  it("rejects a non-positive or non-integer hop count", () => {
    expect(() => resolveTrustProxyPolicy({ GALLEY_TRUST_PROXY_HOPS: "0" })).toThrow(/positive integer/i);
    expect(() => resolveTrustProxyPolicy({ GALLEY_TRUST_PROXY_HOPS: "-1" })).toThrow(/positive integer/i);
    expect(() => resolveTrustProxyPolicy({ GALLEY_TRUST_PROXY_HOPS: "1.5" })).toThrow(/positive integer/i);
    expect(() => resolveTrustProxyPolicy({ GALLEY_TRUST_PROXY_HOPS: "abc" })).toThrow(/positive integer/i);
  });
});

describe("createClientAddressResolver", () => {
  it("binds the policy into a (req) => address function", () => {
    const resolve = createClientAddressResolver(
      resolveTrustProxyPolicy({ GALLEY_TRUSTED_PROXIES: "loopback" }),
    );
    expect(resolve(req("127.0.0.1", { "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(resolve(req("203.0.113.99", { "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.99");
  });
});
