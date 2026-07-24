/**
 * Same-origin client topology (M4 S2).
 *
 * The browser communicates ONLY with its own origin; in development Vite proxies
 * `/api` and `/ws` to the collaboration server (see vite.config.ts). These
 * helpers therefore return relative, same-origin API paths and derive the
 * WebSocket base from the current browser location. No query parameters are
 * appended, so the later y-websocket provider — which composes
 * `${wsBase()}/${sheetId}` — resolves to exactly `/ws/{sheetId}`, matching the
 * server's strict canonical route.
 *
 * Pure module: importing it and calling these helpers constructs no Y.Doc,
 * Awareness, session, provider, fetch, or socket. `wsBase()` reads
 * `window.location` only when called (never at import time).
 */

/** Relative same-origin path for the create-sheet endpoint: `POST /api/sheets`. */
export function createSheetPath(): string {
  return "/api/sheets";
}

/**
 * Relative same-origin path for the read-only bootstrap of one sheet:
 * `GET /api/sheets/{sheetId}`. The `sheetId` is used verbatim — shape/id
 * validation is not this module's responsibility (it belongs to S5).
 */
export function sheetBootstrapPath(sheetId: string): string {
  return `/api/sheets/${sheetId}`;
}

/**
 * Canonical same-origin WebSocket base: `ws://<host>/ws` under HTTP,
 * `wss://<host>/ws` under HTTPS. Host (including port) and protocol are derived
 * from the current browser location. There is no trailing sheet id and no query
 * string — the provider appends `/{sheetId}`.
 *
 * `loc` defaults to `window.location`; it is injectable purely so unit tests can
 * exercise protocol/host derivation without navigating the environment.
 */
export function wsBase(
  loc: Pick<Location, "protocol" | "host"> = window.location,
): string {
  const wsProtocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${loc.host}/ws`;
}
