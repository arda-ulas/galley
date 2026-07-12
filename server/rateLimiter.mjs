// In-memory fixed-window create rate limiter (portfolio-grade). Enforces a
// per-IP and a per-creation-token quota with an injectable clock. Maps are
// bounded and expire lazily.
//
// Non-mutating until admission: a request first PREVIEWS the effective count of
// each dimension WITHOUT inserting, resetting, reordering, or evicting. Only if
// BOTH dimensions would admit are the entries committed (created/reset and
// incremented) and map bounds enforced. A rejection therefore mutates neither
// map — a token overage never inserts/evicts/resets IP state, and vice versa.

import {
  RATE_LIMIT_IP_MAX,
  RATE_LIMIT_TOKEN_MAX,
  RATE_LIMIT_WINDOW_MS,
} from "./limits.mjs";

// Hard cap on tracked keys per dimension, to bound memory under key churn.
const DEFAULT_MAX_ENTRIES = 100_000;

/**
 * @param {{ windowMs?: number, ipLimit?: number, tokenLimit?: number, maxEntries?: number, clock?: { now: () => number } }} [options]
 */
export function createRateLimiter({
  windowMs = RATE_LIMIT_WINDOW_MS,
  ipLimit = RATE_LIMIT_IP_MAX,
  tokenLimit = RATE_LIMIT_TOKEN_MAX,
  maxEntries = DEFAULT_MAX_ENTRIES,
  clock = Date,
} = {}) {
  // A bounded map needs at least one slot; a zero-capacity map is not supported.
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError(
      "createRateLimiter: maxEntries must be a positive safe integer",
    );
  }

  /** @type {Map<string, { windowStart: number, count: number }>} */
  const ipMap = new Map();
  /** @type {Map<string, { windowStart: number, count: number }>} */
  const tokenMap = new Map();

  /** Read the effective current count WITHOUT mutating the map. */
  function preview(map, key, now) {
    const entry = map.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      return { fresh: true, count: 0 };
    }
    return { fresh: false, entry, count: entry.count };
  }

  /** Commit an admitted attempt: create/reset if needed, increment, bound. */
  function commit(map, key, now, previewed) {
    let entry = previewed.entry;
    if (previewed.fresh) {
      entry = { windowStart: now, count: 0 };
      map.set(key, entry);
      if (map.size > maxEntries) {
        // Evict the oldest OTHER key (Map preserves insertion order).
        for (const k of map.keys()) {
          if (k !== key) {
            map.delete(k);
            break;
          }
        }
      }
    }
    entry.count += 1;
  }

  return {
    /**
     * Admit or reject one create attempt. On rejection neither map is mutated.
     * @param {string} ip
     * @param {string} token
     * @returns {{ ok: true } | { ok: false, reason: "ip" | "token" }}
     */
    checkCreate(ip, token) {
      const now = clock.now();
      const ipPreview = preview(ipMap, ip, now);
      const tokenPreview = preview(tokenMap, token, now);
      if (ipPreview.count >= ipLimit) return { ok: false, reason: "ip" };
      if (tokenPreview.count >= tokenLimit) return { ok: false, reason: "token" };
      commit(ipMap, ip, now, ipPreview);
      commit(tokenMap, token, now, tokenPreview);
      return { ok: true };
    },

    /** Drop all tracked state (called on shutdown). */
    clear() {
      ipMap.clear();
      tokenMap.clear();
    },

    /** Observability/test seam: current tracked key counts. */
    size() {
      return { ip: ipMap.size, token: tokenMap.size };
    },

    /** Test-only introspection into raw stored entries (never a product API). */
    __test: {
      ipEntry: (key) => ipMap.get(key),
      tokenEntry: (key) => tokenMap.get(key),
    },
  };
}
