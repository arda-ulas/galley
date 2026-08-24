import type { LanguageId } from "./languages";

/**
 * Download / export (M4.5 T5).
 *
 * Closes the demo loop: draft → share → collaborate → **get the text back out**.
 * Pure client. No server involvement, no persistence, no history — the bytes are
 * whatever the live document says right now, taken from the caller at the moment
 * of the click.
 *
 * Filename derives from the sheet title, extension from the language. Both are
 * derived rather than asked for, because the one-click gesture is the point: a
 * dialog would make this a second decision the user did not come here to make.
 */

/**
 * Canonical extension per allowlisted language. Keyed by `LanguageId`, so adding
 * a language to the union is a type error here until an extension is chosen —
 * the mapping cannot silently fall behind the allowlist.
 *
 * `plaintext` → `.txt`: the sheet holds unstructured text and `.txt` is what
 * every OS will open without ceremony.
 */
const EXTENSIONS: Readonly<Record<LanguageId, string>> = Object.freeze({
  javascript: "js",
  typescript: "ts",
  python: "py",
  plaintext: "txt",
});

/** The name used when a title is empty, whitespace, or sanitized away entirely. */
export const FALLBACK_BASENAME = "untitled";

/**
 * Longest permitted basename, in UTF-16 code units, before the extension is
 * appended. Titles are capped at 200 code points server-side
 * (`MAX_TITLE_CODE_POINTS`), which can still exceed the ~255-**byte** per-name
 * limit common to ext4/APFS/NTFS once multi-byte characters are involved. 120 is
 * comfortably inside that on any encoding while leaving a title recognisable.
 */
const MAX_BASENAME_LENGTH = 120;

/**
 * The canonical extension for a language.
 */
export function extensionForLanguage(language: LanguageId): string {
  return EXTENSIONS[language];
}

/**
 * Reduce a sheet title to a safe filename basename (no extension).
 *
 * The threat is not a malicious user attacking themselves — it is a title that
 * makes the browser write somewhere unintended or produce a file the OS refuses.
 * So, in order:
 *
 * 1. **Path separators** (`/`, `\`) → `-`. A title of `../../etc/passwd` must
 *    become a flat name, never a traversal.
 * 2. **Whitespace control characters** (tab, newline, CR, VT, FF, and U+0085
 *    NEL) → a space, BEFORE the general control-character sweep. They are word
 *    separators in a pasted title; dropping them outright would glue
 *    `line\nbreak` into `linebreak`, silently changing the words in the filename.
 *    NEL belongs here because it is a line terminator like LF — and because
 *    JavaScript's `\s` does **not** match it, so nothing downstream would.
 * 3. **Remaining control characters** are dropped: C0 (U+0000–U+001F), DEL
 *    (U+007F), **and the full C1 range (U+0080–U+009F)**. A NUL truncates the
 *    name in some filesystem APIs; the rest are invisible or, in the C1 case,
 *    terminal-control bytes such as U+009B CSI that have no business in a
 *    filename. C1 previously survived the sweep entirely: it is matched by
 *    neither the C0 range nor `\s`, so a title carrying it produced a filename
 *    with raw control bytes in it.
 * 4. **Characters Windows reserves** (`<>:"|?*`) → `-`, so a file saved on macOS
 *    or Linux stays copyable to Windows.
 * 5. **Whitespace runs** collapse to a single space, then trim.
 * 6. **Leading dots and dashes** are stripped together. Dots so `.bashrc` cannot
 *    produce a hidden file the user then cannot find; dashes because step 1 turns
 *    a leading separator into one, and a filename beginning with `-` is read as
 *    an option by most command-line tools.
 * 7. **Trailing dots and spaces** are stripped — Windows silently drops them,
 *    which would make the saved name differ from the shown one.
 * 8. **Length** is capped, then re-trimmed in case the cut landed on a space.
 *
 * Anything that survives none of this falls back to `untitled`.
 */
export function sanitizeBasename(title: string): string {
  const cleaned = title
    .replace(/[/\\]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0009\u000A\u000B\u000C\u000D\u0085]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\-\s]+/, "")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, MAX_BASENAME_LENGTH)
    .replace(/[. ]+$/, "")
    .trim();

  // A title of only separators/reserved characters reduces to dashes, which is a
  // legal but meaningless filename — treat it as no title at all.
  if (cleaned.length === 0 || /^-+$/.test(cleaned)) return FALLBACK_BASENAME;
  return cleaned;
}

/**
 * The full download filename for a sheet: sanitized title + canonical extension.
 */
export function downloadFilename(title: string, language: LanguageId): string {
  return `${sanitizeBasename(title)}.${extensionForLanguage(language)}`;
}

/**
 * How long to wait before revoking the object URL. Long enough that every
 * browser has committed the download, short enough that the blob is not held
 * meaningfully longer than the gesture.
 */
const REVOKE_DELAY_MS = 10_000;

/** Injectable browser seams, so the download path is testable without jsdom hacks. */
export type DownloadSeams = {
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  /** Where the temporary anchor is attached. Defaults to the live document. */
  document?: Document;
};

/**
 * Trigger a download of `text` as a file named from `title` + `language`.
 *
 * Uses a `Blob` + object URL + synthetic anchor click — the one approach that
 * works without a server round-trip and lets us set the filename.
 *
 * The object URL is revoked on a later macrotask, NOT synchronously after
 * `click()`. `click()` only *schedules* the download; revoking the URL in the
 * same tick can pull the blob out from under a browser that has not yet started
 * reading it, producing a silent zero-byte or cancelled download. Deferring
 * still guarantees the revoke (so the blob is not retained for the lifetime of
 * the document) while letting the download begin.
 *
 * The MIME type is deliberately `text/plain;charset=utf-8` for every language
 * rather than `text/javascript` and friends: the extension already tells the OS
 * what the file is, and a script MIME type on a user-supplied download is a
 * needless invitation for a browser or scanner to treat the bytes as executable.
 *
 * Returns the filename used, so a caller (or a test) can assert on it.
 */
export function downloadText(
  text: string,
  title: string,
  language: LanguageId,
  seams: DownloadSeams = {},
): string {
  const {
    createObjectURL = URL.createObjectURL.bind(URL),
    revokeObjectURL = URL.revokeObjectURL.bind(URL),
    document: doc = document,
  } = seams;

  const filename = downloadFilename(title, language);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = createObjectURL(blob);
  try {
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    doc.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  } finally {
    // Deferred, and outside any throw path above — the URL is always revoked.
    setTimeout(() => revokeObjectURL(url), REVOKE_DELAY_MS);
  }
  return filename;
}
