// Per-sheet serialized write queue (the M2 concurrency foundation, architecture
// §7/§11). A generic ordering primitive — it does NOT import `node:sqlite` and
// knows nothing about SQL.
//
// Ordering guarantees:
// - Tasks for the SAME sheet id run in enqueue order (one at a time).
// - Tasks for DIFFERENT sheet ids may interleave their async/await phases
//   independently in JavaScript.
// - The underlying SQLite calls still execute serially on the single Node thread
//   and single connection regardless; the queue's job is to order same-sheet
//   logical writes so their revisions are monotonic and never interleave.
// - A failed write does not poison the sheet's queue: later writes still run.
//
// M2 scope only: no client acknowledgement protocol, no saved-state UI, no
// create API. Monotonic per-sheet revisions come from the repository op the
// queued task calls (db.persistState), which reads current+1 while serialized.

export function createWriteQueue() {
  /** @type {Map<string, Promise<void>>} */
  const tails = new Map();

  /**
   * Enqueue a task for a sheet. Tasks for the same sheet are serialized; the
   * returned promise settles with the task's real result or rejection.
   * @template T
   * @param {string} sheetId
   * @param {() => T | Promise<T>} task
   * @returns {Promise<T>}
   */
  function enqueue(sheetId, task) {
    // `prev` is either a fresh resolved promise or a stored tail. Stored tails
    // never reject (see below), so the task always runs after its predecessor.
    const prev = tails.get(sheetId) ?? Promise.resolve();
    const result = prev.then(() => task());

    // The stored tail resolves after this task settles, swallowing rejection so
    // a failure cannot break the chain for subsequent writes to the same sheet.
    const tail = result.then(
      () => {},
      () => {},
    );
    tails.set(sheetId, tail);
    // Best-effort cleanup: drop the map entry once this is the settled tail.
    void tail.then(() => {
      if (tails.get(sheetId) === tail) tails.delete(sheetId);
    });

    return result;
  }

  /** Number of sheet ids with in-flight/pending work (for tests/observability). */
  function activeSheets() {
    return tails.size;
  }

  return { enqueue, activeSheets };
}
