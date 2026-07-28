import { useEffect, useState } from "react";
import { DraftEditor } from "../components/DraftEditor";
import { DraftShell } from "../components/DraftShell";
import { ShareButton, ShareInfo } from "../components/ShareControl";
import type { LanguageId } from "../lib/languages";
import {
  displayedMetadata,
  metadataEditable,
  shareStatusPhrase,
  useShareFlow,
} from "../lib/useShareFlow";

/**
 * The local draft at `/` (M4 S6). Opens an empty, unconnected local sheet and
 * exposes the visible Share gesture. Sharing attaches a provider to the session's
 * EXISTING primitives (no editor remount) and replaces the URL with `/{sheetId}`;
 * the sharer stays mounted on this page (App is stateless, so `replaceState`
 * triggers no route re-render). Title/language are local state while editable;
 * once a durable success locks them, the AUTHORITATIVE bootstrap metadata (which
 * may differ from the fresh local draft after a stale-token recovery) is shown.
 */
export function DraftPage() {
  const { session, state, share, copyLink } = useShareFlow();
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<LanguageId>("typescript");

  const editable = metadataEditable(state);
  // While editable, show the local values; once locked, show authoritative
  // metadata (never re-present fresh local values as the durable sheet's).
  const shown = displayedMetadata(state, title, language);

  // Dev-only test hook: a deterministic undo-capture boundary for e2e proofs of
  // pre-Share undo survival across the handoff (no wall-clock separation). Only
  // wired under the Vite dev server; never present in a production build.
  useEffect(() => {
    if (!import.meta.env.DEV || !session) return;
    const w = window as unknown as {
      __galleyTest?: { stopUndoCapturing: () => void };
    };
    w.__galleyTest = { stopUndoCapturing: () => session.undoManager.stopCapturing() };
    return () => {
      delete w.__galleyTest;
    };
  }, [session]);

  return (
    <DraftShell
      language={shown.language}
      onLanguageChange={(v) => editable && setLanguage(v)}
      onTitleChange={(v) => editable && setTitle(v)}
      readOnly={!editable}
      statusPhrase={shareStatusPhrase(state)}
      title={shown.title}
      trailing={<ShareButton onShare={() => share(title, language)} state={state} />}
      subBar={<ShareInfo onCopyLink={copyLink} state={state} />}
    >
      {session ? <DraftEditor language={shown.language} session={session} /> : null}
    </DraftShell>
  );
}
