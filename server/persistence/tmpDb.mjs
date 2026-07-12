// Integration-test harness for file-backed databases. Each call creates a
// unique temp directory (via fs.mkdtemp) so tests never share DB state. Callers
// must close all DB handles (and any child processes) before cleanup(). The
// directory — including `.db`, `-wal`, and `-shm` — is retained until cleanup,
// so recovery checks can run.
//
// This module does not import `node:sqlite`; it only manages filesystem paths.

import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Guard: durability/restart tests must never run against an in-memory database.
 * @param {string} path
 */
export function assertFileBacked(path) {
  if (path == null || path === "" || path === ":memory:") {
    throw new Error(
      `durability tests require a file-backed database, got: ${JSON.stringify(path)}`,
    );
  }
}

/**
 * @returns {Promise<{
 *   dir: string,
 *   dbPath: string,
 *   walPath: string,
 *   shmPath: string,
 *   exists: (p: string) => boolean,
 *   size: (p: string) => number,
 *   cleanup: () => Promise<void>,
 * }>}
 */
export async function createTempDb() {
  const dir = await mkdtemp(join(tmpdir(), "galley-itest-"));
  const dbPath = join(dir, "galley.db");
  assertFileBacked(dbPath);
  let cleaned = false;
  return {
    dir,
    dbPath,
    walPath: `${dbPath}-wal`,
    shmPath: `${dbPath}-shm`,
    exists: (p) => existsSync(p),
    size: (p) => (existsSync(p) ? statSync(p).size : 0),
    async cleanup() {
      // Idempotent: safe to call multiple times (e.g. in a `finally`).
      if (cleaned) return;
      cleaned = true;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
