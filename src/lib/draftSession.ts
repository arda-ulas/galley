import { useEffect, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

/**
 * A local draft session — the single set of collaboration primitives that back
 * the `/` draft page BEFORE Share.
 *
 * Ownership model (M1; see docs/RECONSTRUCTION_ARCHITECTURE.md §3/§4.6/§9):
 * - `createDraftSession()` is a pure factory. It has side effects (the Awareness
 *   announce/cleanup interval, doc/observer allocation), so every created
 *   session MUST eventually be destroyed.
 * - `destroy()` is idempotent and releases the Awareness (its interval), the
 *   UndoManager, and the Y.Doc.
 * - The React owner (`useDraftSession`) creates the session in an effect and
 *   disposes it in the effect cleanup, so React Strict Mode's mount→cleanup→
 *   mount cycle disposes the speculative session and keeps exactly one live one,
 *   and a normal unmount disposes the committed session.
 * - `transferOwnership()` + `disposeUnlessTransferred()` are the seam for M4:
 *   when Share takes over, it will mark the session transferred so the local
 *   draft's unmount cleanup does NOT destroy the doc/awareness/undo that Share
 *   now owns. No provider is created here; this is lifecycle bookkeeping only.
 */
export type DraftSession = {
  doc: Y.Doc;
  text: Y.Text;
  awareness: Awareness;
  undoManager: Y.UndoManager;
  /** True once destroyed. */
  readonly destroyed: boolean;
  /** Mark the session as owned elsewhere (M4 Share). Then dispose is a no-op. */
  transferOwnership(): void;
  /** Idempotent teardown of all session-owned resources. */
  destroy(): void;
  /** Destroy unless ownership was transferred (the local-draft unmount path). */
  disposeUnlessTransferred(): void;
};

export function createDraftSession(): DraftSession {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  // Local-only awareness — no provider is attached in M1, so nothing is
  // broadcast. Owning one instance means the same instance can survive the
  // Share handoff (M4) unchanged.
  const awareness = new Awareness(doc);
  // Empty tracked-origins: the y-codemirror binding adds its own YSyncConfig
  // origin on mount, so only genuine local editor edits are undoable. Native
  // CodeMirror history is intentionally excluded so it cannot conflict.
  const undoManager = new Y.UndoManager(text, { trackedOrigins: new Set() });

  let destroyed = false;
  let transferred = false;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    undoManager.destroy();
    awareness.destroy(); // clears the announce/cleanup interval
    doc.destroy();
  }

  return {
    doc,
    text,
    awareness,
    undoManager,
    get destroyed() {
      return destroyed;
    },
    transferOwnership() {
      transferred = true;
    },
    destroy,
    disposeUnlessTransferred() {
      if (!transferred) destroy();
    },
  };
}

/**
 * Owns exactly one live draft session for the committed lifetime of the
 * component. Returns `null` for the first render, then the session once the
 * creation effect has run.
 *
 * The session is created in an effect (not during render) so React can dispose
 * a speculative Strict-Mode session via the effect cleanup and dispose the
 * committed session on unmount. `create` is injectable for deterministic
 * lifecycle tests; production callers use the default factory.
 */
export function useDraftSession(
  create: () => DraftSession = createDraftSession,
): DraftSession | null {
  const [session, setSession] = useState<DraftSession | null>(null);

  useEffect(() => {
    const s = create();
    setSession(s);
    return () => s.disposeUnlessTransferred();
    // `create` is intentionally not a dependency: the session is created once
    // per committed mount. Strict Mode's remount re-runs this effect and the
    // cleanup disposes the discarded session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return session;
}
