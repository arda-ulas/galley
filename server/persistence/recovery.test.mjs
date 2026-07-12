import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDatabase } from "./db.mjs";
import { createTempDb } from "./tmpDb.mjs";

// POSIX assumption: this suite uses SIGKILL to simulate an abrupt crash. Those
// signal semantics are POSIX; on win32 the kill/recovery behavior differs, so
// the suite is skipped there.
const POSIX = process.platform !== "win32";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "__fixtures__", "abruptWriter.mjs");

/** Real child-process objects still being tracked. Emptied after every test. */
const children = new Set();
/** @type {Array<{ cleanup: () => Promise<void> }>} */
const temps = [];

/** Resolve once the child has exited (immediately if it already has). */
function awaitExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
  });
}

/** Kill (if alive), await exit, and stop tracking. */
async function reap(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  await awaitExit(child);
  children.delete(child);
}

afterEach(async () => {
  // Reap any survivors and await their exit; the registry must end empty.
  for (const child of [...children]) await reap(child);
  expect(children.size).toBe(0);
  while (temps.length) await temps.pop().cleanup();
});

/**
 * Spawn the writer. `ready` resolves once the child prints "committed"; on
 * timeout / early-exit / spawn error it reaps the child (kill if alive + await
 * exit) BEFORE rejecting. Exactly one settle. stderr is preserved in errors.
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [opts]
 */
function spawnWriter(args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const child = spawn(process.execPath, [FIXTURE, ...args]);
  children.add(child);

  let out = "";
  let err = "";
  let settled = false;

  const ready = new Promise((resolve, reject) => {
    const rejectAfterReap = async (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await reap(child); // await exit before rejecting → no orphan
      reject(error);
    };
    const timer = setTimeout(
      () => rejectAfterReap(new Error(`writer did not become ready within ${timeoutMs}ms`)),
      timeoutMs,
    );
    child.stdout.on("data", (c) => {
      out += c.toString();
      if (!settled && out.includes("committed")) {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (c) => (err += c.toString()));
    child.on("exit", (code, signal) => {
      if (settled) return; // early exit before ready
      settled = true;
      clearTimeout(timer);
      children.delete(child); // already exited
      reject(
        new Error(
          `writer exited before ready (code=${code} signal=${signal}) stderr=${err}`,
        ),
      );
    });
    child.on("error", (e) => rejectAfterReap(e));
  });

  return { child, ready };
}

describe.skipIf(!POSIX)("abrupt-exit hot-WAL recovery", () => {
  it("recovers a committed WAL+FULL transaction after SIGKILL (asserting the kill signal) and passes integrity_check", async () => {
    const t = await createTempDb();
    temps.push(t);

    const { child, ready } = spawnWriter([t.dbPath, "sheet-crash"]);
    await ready;
    child.kill("SIGKILL");
    await awaitExit(child);
    children.delete(child);
    expect(child.signalCode).toBe("SIGKILL");

    // A hot WAL must be present before recovery (the commit was not checkpointed).
    expect(t.exists(t.dbPath)).toBe(true);
    expect(t.exists(t.walPath)).toBe(true);
    expect(t.size(t.walPath)).toBeGreaterThan(0);

    const db = openDatabase(t.dbPath);
    try {
      const sheet = db.getSheet("sheet-crash");
      expect(sheet).not.toBeNull();
      expect(sheet.serverRevision).toBe(1);
      expect([...sheet.state]).toEqual([1, 2, 3, 4]);
      expect(db.integrityCheck()).toBe("ok");
    } finally {
      db.close(); // close before temp cleanup
    }
  });

  it("awaits reaping when the child never signals readiness (timeout)", async () => {
    const t = await createTempDb();
    temps.push(t);
    const { ready } = spawnWriter([t.dbPath, "sheet-hang", "--no-signal"], {
      timeoutMs: 400,
    });
    await expect(ready).rejects.toThrow(/did not become ready/i);
    // rejectAfterReap already killed + awaited + untracked the child.
    expect(children.size).toBe(0);
  });

  it("awaits reaping when the child exits early with an error (bad path)", async () => {
    const t = await createTempDb();
    temps.push(t);
    const { ready } = spawnWriter([":memory:", "sheet-x"]);
    await expect(ready).rejects.toThrow(/exited before ready/i);
    expect(children.size).toBe(0);
  });
});
