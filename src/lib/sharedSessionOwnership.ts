import type { DraftSession } from "./draftSession";
import type { SheetProviderHandle } from "./providerFactory";

/**
 * Shared-session ownership controller (M4 S3 foundation for S6).
 *
 * Makes the draft→shared cleanup-ownership transition ATOMIC with successful
 * provider attachment, and synchronously testable, so correctness never depends
 * on React effect ordering. It composes the existing `DraftSession` ownership
 * contract (`transferOwnership()` / `disposeUnlessTransferred()` / `destroy()`).
 *
 * Ownership invariant:
 * - before provider construction succeeds, the session stays LOCALLY owned;
 * - if construction fails, local ownership is intact (nothing transferred);
 * - the instant attachment succeeds, THIS controller owns cleanup for BOTH the
 *   provider and the session — from that point the local owner's
 *   `disposeUnlessTransferred()` is a harmless no-op;
 * - teardown always attempts provider.destroy() THEN session.destroy(), even if
 *   the first throws (errors are aggregated and surfaced, never swallowed).
 */
export type OwnershipPhase = "local" | "shared" | "disposed";

export type SharedSessionController = {
  readonly phase: OwnershipPhase;
  /**
   * Construct the provider and, IN THE SAME SYNCHRONOUS OPERATION, take cleanup
   * ownership of both provider and session:
   *   1. construct the provider (`construct`);
   *   2. retain the handle;
   *   3. `session.transferOwnership()`;
   *   4. mark controller-owned (`phase = "shared"`);
   *   5. return the handle.
   * If `construct` throws, phase stays `local` and nothing is transferred. If
   * `transferOwnership()` throws, the just-built provider is destroyed and the
   * controller settles in `disposed` — never a false `shared` state.
   */
  attachAndTakeOwnership(construct: () => SheetProviderHandle): SheetProviderHandle;
  /** Idempotent, failure-safe teardown appropriate to the current phase. */
  dispose(): void;
};

export function createSharedSessionController(
  session: DraftSession,
): SharedSessionController {
  let phase: OwnershipPhase = "local";
  let handle: SheetProviderHandle | null = null;

  return {
    get phase() {
      return phase;
    },

    attachAndTakeOwnership(construct) {
      if (phase !== "local") {
        throw new Error(`attachAndTakeOwnership: cannot attach from "${phase}"`);
      }
      // (1) construction may throw → phase stays "local", nothing retained or
      // transferred, session remains locally owned.
      const h = construct();
      handle = h; // (2) retain
      try {
        session.transferOwnership(); // (3) atomic with attachment
      } catch (err) {
        // Transfer failed: destroy the just-built provider and settle in a
        // consistent disposed state — never report a valid shared ownership.
        handle = null;
        phase = "disposed";
        try {
          h.destroy();
        } catch (destroyErr) {
          throw new AggregateError(
            [err, destroyErr],
            "attach transfer failed and provider cleanup failed",
          );
        }
        throw err;
      }
      phase = "shared"; // (4) controller now owns cleanup for both
      return h; // (5)
    },

    dispose() {
      if (phase === "disposed") return;
      const prev = phase;
      phase = "disposed";
      if (prev !== "shared") {
        // "local": no provider was constructed; the local owner still owns and
        // disposes the session. Nothing to tear down here.
        handle = null;
        return;
      }
      // Shared: attempt provider.destroy() FIRST, then session.destroy() — both
      // are attempted even if one throws; errors are aggregated and surfaced.
      const errors: unknown[] = [];
      try {
        handle?.destroy();
      } catch (err) {
        errors.push(err);
      }
      try {
        session.destroy();
      } catch (err) {
        errors.push(err);
      }
      handle = null;
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "shared session dispose failed");
      }
    },
  };
}
