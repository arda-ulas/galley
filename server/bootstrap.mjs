// GET /api/sheets/:sheetId — the read-only bootstrap endpoint.
//
// Returns the safe metadata a direct-open client needs to render the shell
// before connecting (title, language, revisions). It calls the SAME
// loadValidatedSheet service the WebSocket hydration (M4 commit 2) will use, so
// a sheet whose durable Yjs state is corrupt cannot bootstrap successfully.
// It never returns raw update/state-vector bytes and never mutates state.

import { ERROR_CODES, writeJson, writeJsonError } from "./errors.mjs";
import { loadValidatedSheet } from "./loadValidatedSheet.mjs";

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ db: any }} deps
 * @param {string} sheetId already-extracted single path segment
 */
export function handleBootstrapSheet(req, res, deps, sheetId) {
  const loaded = loadValidatedSheet({ db: deps.db, sheetId });

  if (!loaded.ok) {
    switch (loaded.reason) {
      case "invalid_id":
        writeJsonError(
          res,
          400,
          ERROR_CODES.INVALID_FIELD,
          "Field 'sheetId': invalid.",
        );
        return;
      case "missing":
        writeJsonError(res, 404, ERROR_CODES.NOT_FOUND, "Sheet not found.");
        return;
      case "corrupt":
      case "db_error":
      default:
        // Generic, no Yjs/SQLite detail leaks. Log server-side for observability.
        console.error(`bootstrap ${sheetId}: ${loaded.reason}`, loaded.detail);
        writeJsonError(
          res,
          500,
          ERROR_CODES.INTERNAL_ERROR,
          "An internal error occurred.",
        );
        return;
    }
  }

  // Safe metadata only — never the canonical update / state-vector bytes.
  writeJson(res, 200, {
    sheetId: loaded.sheetId,
    title: loaded.title,
    language: loaded.language,
    schemaVersion: loaded.schemaVersion,
    serverRevision: loaded.serverRevision,
    metadataRevision: loaded.metadataRevision,
  });
}
