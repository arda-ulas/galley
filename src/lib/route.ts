/**
 * Client route substrate (M4 S5).
 *
 * A pure, pathname-only mapping from `window.location.pathname` to a typed
 * `AppRoute`, plus the two navigation primitives Share needs: `sheetPath` and a
 * receipt-driven `history.replaceState` helper. It is deliberately inert — it
 * constructs no session, provider, socket, fetch, or editor, and holds no
 * runtime/connection state.
 *
 * The `sheet` route is RECOGNIZED here but stays dormant: in the S5 build a valid
 * `/{sheetId}` path renders the same neutral unavailable surface as any other
 * non-draft path. S6 activates shared routes (join, provider attach, live view);
 * runtime states (loading / connected / terminal / nonexistent / expired) and
 * invalid-vs-expired copy belong to S6 / M5a, never to this parser.
 */

import { isValidSheetId } from "./sheetId";
import type { ShareReceipt } from "./shareCoordinator";

/**
 * The three route kinds this build distinguishes purely from the pathname:
 * - `draft` — the root local draft (`/`).
 * - `sheet` — an exact `/{sheetId}` whose id passes the client shape gate
 *   (dormant until S6; existence is never asserted here).
 * - `unavailable` — everything else (neutral surface; no cause claim).
 */
export type AppRoute =
  | { kind: "draft" }
  | { kind: "sheet"; sheetId: string }
  | { kind: "unavailable" };

/**
 * Resolve a route from a pathname ALONE. Callers pass
 * `window.location.pathname`, so query and hash never reach here and cannot
 * change route identity. Only `/` and an exact single-segment `/{validSheetId}`
 * are meaningful; a trailing slash, extra segments, `/r/demo`, `/ws/{id}`,
 * malformed ids, and percent-encoded variants that are not themselves a valid
 * literal segment all resolve to `unavailable`.
 */
export function parseRoute(pathname: string): AppRoute {
  if (pathname === "/") return { kind: "draft" };

  // Exactly one leading slash and no further slashes ⇒ a single path segment.
  // `slice(1)` is the raw segment; it is matched VERBATIM against the shape gate,
  // so `/{id}/`, `/a/{id}`, and `/ws/{id}` never match (they carry another '/').
  if (pathname.startsWith("/") && !pathname.includes("/", 1)) {
    const segment = pathname.slice(1);
    if (isValidSheetId(segment)) return { kind: "sheet", sheetId: segment };
  }

  return { kind: "unavailable" };
}

/**
 * Build the canonical same-origin path for a sheet: exactly `/{sheetId}`. Throws
 * (before returning any string) if `sheetId` fails the client shape gate, so a
 * malformed id can never be turned into a navigable path.
 */
export function sheetPath(sheetId: string): string {
  if (!isValidSheetId(sheetId)) {
    throw new Error(`sheetPath: invalid sheetId ${JSON.stringify(sheetId)}`);
  }
  return `/${sheetId}`;
}

/**
 * Replace the current URL with the shared sheet's path AFTER durable creation —
 * the one-way, no-reload transition from a draft URL to `/{sheetId}` (arch
 * §4.4.1). It is a pure primitive: S6 calls it at the correct moment; it never
 * observes share results itself and is never invoked by the coordinator.
 *
 * Uses `replaceState` (not `pushState`) so no history entry pointing at the now
 * ownership-transferred draft is created, and passes the clean path so any prior
 * query/hash is dropped. It does not reload and does not dispatch `popstate`.
 * Refuses (throws, via `sheetPath`) before touching history if the id is invalid.
 */
export function replaceUrlWithSharedSheet(
  receipt: Readonly<ShareReceipt>,
  historyLike: Pick<History, "replaceState"> = window.history,
): void {
  const path = sheetPath(receipt.sheetId);
  historyLike.replaceState(null, "", path);
}
