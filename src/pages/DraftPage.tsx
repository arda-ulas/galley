import { useState } from "react";
import { DraftEditor } from "../components/DraftEditor";
import { DraftShell } from "../components/DraftShell";
import { useDraftSession } from "../lib/draftSession";
import type { LanguageId } from "../lib/languages";

/**
 * The M1 local draft at `/`. Opens an empty, unconnected local sheet. No
 * provider, no WebSocket, no remote object, no Share. Title and language are
 * local component state; the collaboration primitives come from a single owned
 * `DraftSession` that is disposed on unmount.
 */
export function DraftPage() {
  const session = useDraftSession();
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<LanguageId>("typescript");

  return (
    <DraftShell
      language={language}
      onLanguageChange={setLanguage}
      onTitleChange={setTitle}
      title={title}
    >
      {session ? <DraftEditor language={language} session={session} /> : null}
    </DraftShell>
  );
}
