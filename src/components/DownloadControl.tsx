import { PAPER } from "../lib/paperTheme";
import type { LanguageId } from "../lib/languages";
import { downloadFilename, downloadText } from "../lib/exportFile";

/**
 * Download control (M4.5 T5).
 *
 * One click yields a file named from the sheet's title with the language's
 * canonical extension, containing exactly the current live text. It is present
 * on the local draft AND on a shared sheet — a collaborator who joined by link
 * needs the text back out just as much as the person who shared it.
 *
 * The text is read through a callback at click time rather than passed as a
 * prop, so the control never holds a stale copy of the document: on a shared
 * sheet the text changes continuously from the other side, and a prop captured
 * on the last render could export a document that is already several keystrokes
 * out of date.
 *
 * The accessible name carries the resolved filename rather than a bare
 * "Download", so a screen-reader user learns what they are about to receive
 * before committing — the same information a sighted user gets from the browser's
 * download shelf a moment later.
 */
export function DownloadControl({
  getText,
  title,
  language,
}: {
  /** Reads the CURRENT live document text. Called on click, never on render. */
  getText: () => string;
  title: string;
  language: LanguageId;
}) {
  const filename = downloadFilename(title, language);

  return (
    <button
      type="button"
      aria-label={`Download ${filename}`}
      data-testid="download-button"
      onClick={() => downloadText(getText(), title, language)}
      style={{
        background: "transparent",
        border: `1px solid ${PAPER.rule}`,
        borderRadius: 3,
        color: PAPER.inkMuted,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 13,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
      title={filename}
    >
      Download
    </button>
  );
}
