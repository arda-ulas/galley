// Child-process fixture for the abrupt-exit / hot-WAL recovery test.
//
// Opens the adapter (NOT node:sqlite directly — honoring the single-importer
// rule), commits a sheet write under WAL + FULL, signals "committed" on stdout
// only AFTER the commit returns, then waits to be killed abruptly by the parent.
// It never calls close(), so no checkpoint runs and a hot `-wal` is left for the
// parent to recover.
//
// Modes:
//   node abruptWriter.mjs <dbPath> <sheetId>              → commit + signal + hang
//   node abruptWriter.mjs <dbPath> <sheetId> --no-signal  → open + hang, never
//                                                            signal (drives the
//                                                            parent readiness
//                                                            timeout / early-exit
//                                                            cleanup coverage)
//
// Any error is written to stderr with a non-zero exit so the parent can reject
// deterministically rather than hang.

import { openDatabase } from "../db.mjs";

const dbPath = process.argv[2];
const sheetId = process.argv[3];
const noSignal = process.argv.includes("--no-signal");

try {
  const db = openDatabase(dbPath);

  if (!noSignal) {
    db.persistState(sheetId, {
      state: new Uint8Array([1, 2, 3, 4]),
      stateVector: new Uint8Array([9]),
    });
    // Signal readiness only after the commit has returned.
    process.stdout.write("committed\n");
  }

  // Do NOT close. Stay alive until the parent sends SIGKILL.
  setInterval(() => {}, 1000);
} catch (err) {
  process.stderr.write(`abruptWriter failed: ${err?.stack ?? err}\n`);
  process.exit(1);
}
