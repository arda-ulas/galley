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
  /** Welded state phrase (default: the local-draft phrase). */
  statusPhrase?: string;
  /**
   * Optional replacement for the default status element. `DraftPage` supplies
   * `ShareStatus`, which owns the post-Share focus target (DEF-4); pages with no
   * focus handoff (the joiner) leave this unset and get the plain phrase.
   * Whichever renders carries `data-testid="draft-state"`.
   */
  statusSlot?: ReactNode;
  /** When true, title/language are shown read-only (sharing / shared / joiner). */
  readOnly?: boolean;
  /** Header-right slot — the Share control while local. */
  trailing?: ReactNode;
  /** Optional thin bar under the header (post-share access truth / edit link). */
  subBar?: ReactNode;
};

/**
 * Minimum truthful Paper shell (M4 S6). Row 1 carries the editable (or read-only)
 * title, the language control, the welded state phrase, and a trailing Share
 * slot; an optional sub-bar under it carries the post-share access truth and the
 * edit link. It renders NO presence, versions, timeline, or `echo://` chrome —
 * those belong to later milestones. This is the design foundation, not the M11
 * convergence.
 */
export function DraftShell({
  title,
  onTitleChange,
  language,
  onLanguageChange,
  children,
  statusPhrase = "Local draft — not uploaded",
  statusSlot,
  readOnly = false,
  trailing,
  subBar,
}: DraftShellProps) {
  return (
    <div
      className="flex h-dvh flex-col"
      style={{ background: PAPER.canvas, color: PAPER.ink }}
    >
      <header
        className="flex items-center gap-3 px-4"
        style={{
          minHeight: 44,
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
          readOnly={readOnly}
          spellCheck={false}
          style={{ color: PAPER.ink, fontFamily: "inherit", fontSize: 14 }}
          value={title}
        />
        <select
          aria-label="Sheet language"
          className="bg-transparent outline-none"
          disabled={readOnly}
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
        {statusSlot ?? (
          <span
            data-testid="draft-state"
            style={{ color: PAPER.inkMuted, whiteSpace: "nowrap" }}
          >
            {statusPhrase}
          </span>
        )}
        {trailing ? <div className="flex items-center gap-2">{trailing}</div> : null}
      </header>

      {subBar}

      <main className="min-h-0 flex-1" style={{ background: PAPER.sheet }}>
        {children}
      </main>
    </div>
  );
}
