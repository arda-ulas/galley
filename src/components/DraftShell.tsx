import type { ReactNode } from "react";
import type { LanguageId } from "../lib/languages";
import { LANGUAGES } from "../lib/languages";
import { PAPER } from "../lib/paperTheme";

type DraftShellProps = {
  title: string;
  onTitleChange: (value: string) => void;
  language: LanguageId;
  onLanguageChange: (value: LanguageId) => void;
  children: ReactNode;
};

/**
 * Minimum truthful Paper shell for the M1 local draft.
 *
 * Shows only: the editable sheet title, a local language control, and the honest
 * state phrase `Local draft — not uploaded`. It deliberately renders NO Share,
 * Copy link, Live/Connecting/Shared/Saving/Saved wording, presence, timeline,
 * versions, or `echo://` chrome — none of those guarantees exist yet. This is
 * the design foundation, not the final M11 convergence.
 */
export function DraftShell({
  title,
  onTitleChange,
  language,
  onLanguageChange,
  children,
}: DraftShellProps) {
  return (
    <div
      className="flex h-dvh flex-col"
      style={{ background: PAPER.canvas, color: PAPER.ink }}
    >
      <header
        className="flex items-center gap-3 px-4"
        style={{
          height: 44,
          background: PAPER.sheet,
          borderBottom: `1px solid ${PAPER.rule}`,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 13,
        }}
      >
        <input
          aria-label="Sheet title"
          className="min-w-0 flex-1 bg-transparent outline-none"
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled sheet"
          spellCheck={false}
          style={{ color: PAPER.ink, fontFamily: "inherit", fontSize: 14 }}
          value={title}
        />
        <select
          aria-label="Sheet language"
          className="bg-transparent outline-none"
          onChange={(e) => onLanguageChange(e.target.value as LanguageId)}
          style={{
            color: PAPER.inkMuted,
            fontFamily: "inherit",
            fontSize: 13,
            border: `1px solid ${PAPER.rule}`,
            borderRadius: 3,
            padding: "2px 4px",
          }}
          value={language}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <span aria-hidden style={{ color: PAPER.rule }}>
          ·
        </span>
        {/* Truthful state phrase for the local, unshared draft. */}
        <span
          data-testid="draft-state"
          style={{ color: PAPER.inkMuted, whiteSpace: "nowrap" }}
        >
          Local draft — not uploaded
        </span>
      </header>

      <main className="min-h-0 flex-1" style={{ background: PAPER.sheet }}>
        {children}
      </main>
    </div>
  );
}
