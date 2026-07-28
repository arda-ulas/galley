/**
 * Draft creation-token store (M4 S6).
 *
 * A stable idempotency token (UUID v4) for a pending Share attempt, held in
 * `sessionStorage` under a draft-scoped key. `sessionStorage` (tab-scoped) is the
 * approved home (arch §3/§4.1): a draft is a single-tab, pre-shared artifact, and
 * the token must SURVIVE a refresh within the tab so a refreshed tab can reuse it
 * and recover an already-created sheet (stale-token recovery is approved).
 *
 * This module is a pure mechanism — get-or-create, peek, clear. The POLICY of
 * WHEN to clear (only after a still-mounted caller adopts a successful Share AND
 * replaces the URL; never merely because the POST committed; never on rejection;
 * never on an abandoned success) lives in the Share flow that calls it.
 *
 * No `localStorage`, no database: the token is ephemeral tab state only.
 */

const KEY_PREFIX = "galley:creationToken:";

/** The single root-draft scope. A tab has one root draft, so a constant scope
 *  makes the token stable across refresh (enabling recovery). */
export const ROOT_DRAFT_SCOPE = "root";

/** The minimal storage surface used — lets tests inject a fake without a DOM. */
export type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Canonical RFC 4122 UUID v4 shape: version nibble `4`, variant nibble `8|9|a|b`.
 * A persisted value MUST match this exactly — the server treats the token as an
 * idempotency key, so an arbitrary non-empty string (a corrupted/foreign value)
 * must never be reused as though it were a valid token.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True iff `value` is a syntactically valid UUID v4 string. */
export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function keyFor(scope: string): string {
  return `${KEY_PREFIX}${scope}`;
}

function defaultStorage(): TokenStorage {
  return sessionStorage;
}

/**
 * Return the existing token for `scope` IF it is a valid UUID v4, otherwise
 * lazily create, persist, and return a fresh UUID v4. A persisted value that is
 * absent OR malformed (not a UUID v4) is ROTATED to a freshly minted token — an
 * arbitrary non-empty string is never accepted. Repeated calls return the SAME
 * token (stable across retries and across a tab refresh, since a valid value is
 * persisted under a constant key).
 *
 * Storage failures are NOT swallowed here: a throwing `getItem`/`setItem`
 * propagates to the caller (the Share flow), which owns the policy of keeping the
 * draft local and surfacing the failed state without issuing a POST.
 */
export function getOrCreateCreationToken(
  scope: string = ROOT_DRAFT_SCOPE,
  storage: TokenStorage = defaultStorage(),
): string {
  const key = keyFor(scope);
  const existing = storage.getItem(key);
  if (isUuidV4(existing)) return existing;
  // Absent or malformed → rotate to a fresh, guaranteed-valid UUID v4.
  const token = crypto.randomUUID();
  storage.setItem(key, token);
  return token;
}

/** Read the current token without creating one (null if none exists yet). */
export function peekCreationToken(
  scope: string = ROOT_DRAFT_SCOPE,
  storage: TokenStorage = defaultStorage(),
): string | null {
  return storage.getItem(keyFor(scope));
}

/**
 * Explicitly clear the token for `scope`. The Share flow calls this ONLY after a
 * still-mounted caller has adopted a successful Share result and successfully
 * replaced the URL — never on rejection, never merely because the sheet was
 * created, and never for an abandoned (post-unmount) success.
 */
export function clearCreationToken(
  scope: string = ROOT_DRAFT_SCOPE,
  storage: TokenStorage = defaultStorage(),
): void {
  storage.removeItem(keyFor(scope));
}
