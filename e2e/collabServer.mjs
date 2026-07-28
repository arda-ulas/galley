// Playwright collaboration-server launcher.
//
// Deleting an open SQLite database is unsafe (and on Windows silently fails while
// the file is locked). Playwright's globalTeardown is NOT guaranteed to run after
// its webServer teardown, so it cannot own the deletion safely. This launcher
// does: it starts the collaboration server as a CHILD process, forwards
// termination signals, waits for the child to fully EXIT, and only THEN deletes
// the throwaway database (and its WAL/SHM siblings). Process-exit-before-delete is
// therefore guaranteed and portable, with no production runtime dependency.
//
// Playwright's webServer runs this file; the DB path is provided via
// GALLEY_E2E_DB_PATH (and passed through to the child as GALLEY_TEST_DB_PATH by
// the Playwright env config). Exits with the child's status.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dbPath = process.env.GALLEY_E2E_DB_PATH;
const serverEntry = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
  "index.mjs",
);

const child = spawn(process.execPath, [serverEntry], {
  stdio: "inherit",
  env: process.env,
});

// Forward termination signals so the child shuts down gracefully; it owns its own
// SIGINT/SIGTERM handling (server/index.mjs) and drains before exiting.
let forwarding = false;
function forward(signal) {
  if (forwarding) return;
  forwarding = true;
  if (!child.killed) child.kill(signal);
}
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

function deleteDb() {
  if (!dbPath) return;
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      rmSync(p, { force: true });
    } catch {
      // best-effort: the file may already be gone
    }
  }
}

// The child has fully exited here — the database is guaranteed closed, so
// deletion is safe. Delete, then mirror the child's exit status.
child.on("exit", (code, signal) => {
  deleteDb();
  if (signal) {
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 0;
  }
});

child.on("error", (err) => {
  console.error("failed to launch collaboration server:", err);
  deleteDb();
  process.exitCode = 1;
});
