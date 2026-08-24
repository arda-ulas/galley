// Client-address resolution with a BOUNDED trusted-proxy policy (M4.5 T4).
//
// The create rate limiter keys on a client address. Behind a reverse proxy the
// socket peer is the proxy, so the real client would collapse into one bucket —
// but blindly trusting `X-Forwarded-For` lets ANY direct client forge its
// identity and evade the limit entirely. This module implements the approved
// middle ground (IMPLEMENTATION_PLAN.md §5.4):
//
//   * `X-Forwarded-For` is consulted ONLY when the immediate socket peer is in
//     the explicitly configured trusted set. An untrusted peer's header is
//     ignored completely — never parsed, never partially honoured.
//   * When the peer IS trusted, exactly `hops` entries are walked back, so a
//     client cannot lengthen the chain to push its forged value into the
//     selected position.
//
// Default posture is TRUST NOTHING: with no configuration the resolver always
// returns the socket peer, preserving the pre-T4 behaviour exactly.
//
// Deliberately NOT a general networking library: IPv4 CIDR, exact IPv6, and
// IPv4-mapped-IPv6 normalisation are implemented because a containerised proxy
// gets a dynamic address on a known subnet. Nothing else is supported.

import { isIP } from "node:net";

/** Sentinel expanding to the IPv4 + IPv6 loopback ranges. */
const LOOPBACK_TOKEN = "loopback";
const LOOPBACK_RULES = ["127.0.0.0/8", "::1"];

/** Node reports dual-stack IPv4 peers as `::ffff:a.b.c.d`; normalise to `a.b.c.d`. */
export function normalizeAddress(addr) {
  if (typeof addr !== "string") return null;
  const trimmed = addr.trim();
  if (trimmed === "") return null;
  const mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i.exec(trimmed);
  if (mapped) return mapped[1];
  // Strip an RFC 6874 zone id (`fe80::1%eth0`) — it is peer-local, not identity.
  const zone = trimmed.indexOf("%");
  return zone === -1 ? trimmed : trimmed.slice(0, zone);
}

/** Parse dotted-quad IPv4 to a uint32, or null if not a valid IPv4 literal. */
function ipv4ToInt(addr) {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/**
 * Parse a trusted-proxy spec into matcher rules. Accepts a comma/space separated
 * list of exact addresses, IPv4 CIDRs, and the `loopback` sentinel. Unparseable
 * entries throw, so a typo fails fast at boot rather than silently trusting less
 * (or more) than intended.
 * @param {string | undefined | null} spec
 * @returns {Array<{ kind: "exact", value: string } | { kind: "cidr4", base: number, mask: number }>}
 */
export function parseTrustedProxies(spec) {
  if (spec == null) return [];
  const tokens = String(spec)
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t !== "");

  /** @type {Array<any>} */
  const rules = [];
  for (const raw of tokens) {
    const token = raw.toLowerCase() === LOOPBACK_TOKEN ? null : raw;
    if (token === null) {
      for (const expanded of LOOPBACK_RULES) rules.push(...parseTrustedProxies(expanded));
      continue;
    }
    const slash = token.indexOf("/");
    if (slash === -1) {
      // Must be a real IP literal — `node:net` is the authority, so a typo like
      // "localhost" or "not-an-ip" fails at boot instead of becoming a rule that
      // silently matches nothing.
      const normalized = normalizeAddress(token);
      if (!normalized || isIP(normalized) === 0) {
        throw new TypeError(`invalid trusted proxy entry: ${raw}`);
      }
      rules.push({ kind: "exact", value: normalized });
      continue;
    }
    const base = token.slice(0, slash);
    const prefixText = token.slice(slash + 1);
    const baseInt = ipv4ToInt(base);
    if (baseInt === null || !/^\d{1,2}$/.test(prefixText)) {
      throw new TypeError(`invalid trusted proxy CIDR (IPv4 only): ${raw}`);
    }
    const prefix = Number(prefixText);
    if (prefix > 32) throw new TypeError(`invalid trusted proxy CIDR prefix: ${raw}`);
    // `<<32` is undefined in JS bit ops; a /0 mask is all-zero by construction.
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    rules.push({ kind: "cidr4", base: (baseInt & mask) >>> 0, mask });
  }
  return rules;
}

/**
 * Is this socket peer allowed to set `X-Forwarded-For`?
 * @param {string | null | undefined} addr raw socket address
 * @param {ReturnType<typeof parseTrustedProxies>} rules
 */
export function isTrustedPeer(addr, rules) {
  if (!rules || rules.length === 0) return false;
  const normalized = normalizeAddress(addr);
  if (!normalized) return false;
  const asInt = ipv4ToInt(normalized);
  for (const rule of rules) {
    if (rule.kind === "exact") {
      if (rule.value === normalized) return true;
    } else if (asInt !== null && ((asInt & rule.mask) >>> 0) === rule.base) {
      return true;
    }
  }
  return false;
}

/** Split an `X-Forwarded-For` header value (possibly repeated) into entries. */
function forwardedEntries(header) {
  if (header == null) return [];
  const raw = Array.isArray(header) ? header.join(",") : String(header);
  return raw
    .split(",")
    .map((entry) => normalizeAddress(entry))
    .filter((entry) => entry !== null);
}

/** Fallback identity when no address can be determined at all. */
export const UNKNOWN_ADDRESS = "unknown";

/**
 * Resolve the effective client address for one request.
 *
 * Chain model (matching the conventional reverse-proxy layout): the candidate
 * list is `[socketPeer, ...forwardedReversed]`, where index 0 is the immediate
 * peer and each further index steps one hop further from the server. With
 * `hops` trusted proxies the client sits at index `hops`; the index is clamped
 * to the end of the list so a SHORT chain degrades to the furthest known
 * address rather than reading past it.
 *
 * @param {{ socket?: { remoteAddress?: string }, headers?: Record<string, unknown> }} req
 * @param {{ trusted: ReturnType<typeof parseTrustedProxies>, hops: number }} policy
 */
export function resolveClientAddress(req, policy) {
  const peer = normalizeAddress(req?.socket?.remoteAddress);
  const { trusted, hops } = policy;

  // Untrusted (or unconfigured) peer: the header is ignored ENTIRELY. This is
  // the anti-spoofing guarantee — a direct client's own X-Forwarded-For can
  // never influence the result.
  if (!isTrustedPeer(peer, trusted)) return peer ?? UNKNOWN_ADDRESS;

  const forwarded = forwardedEntries(req?.headers?.["x-forwarded-for"]);
  if (forwarded.length === 0) return peer ?? UNKNOWN_ADDRESS;

  const candidates = [peer ?? UNKNOWN_ADDRESS, ...forwarded.slice().reverse()];
  const index = Math.min(hops, candidates.length - 1);
  return candidates[index] ?? peer ?? UNKNOWN_ADDRESS;
}

/**
 * Resolve the trusted-proxy policy from the environment.
 * `GALLEY_TRUSTED_PROXIES` — comma list of exact addresses / IPv4 CIDRs / `loopback`.
 * `GALLEY_TRUST_PROXY_HOPS` — how many proxies sit in front (default 1).
 * With no `GALLEY_TRUSTED_PROXIES` the policy trusts nothing.
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveTrustProxyPolicy(env) {
  const trusted = parseTrustedProxies(env.GALLEY_TRUSTED_PROXIES);
  const rawHops = env.GALLEY_TRUST_PROXY_HOPS;
  let hops = 1;
  if (rawHops != null && String(rawHops).trim() !== "") {
    const parsed = Number(String(rawHops).trim());
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new TypeError(
        "GALLEY_TRUST_PROXY_HOPS must be a positive integer (proxies in front of the app)",
      );
    }
    hops = parsed;
  }
  return { trusted, hops, enabled: trusted.length > 0 };
}

/** Bind a policy into a `(req) => address` resolver. */
export function createClientAddressResolver(policy) {
  return (req) => resolveClientAddress(req, policy);
}
