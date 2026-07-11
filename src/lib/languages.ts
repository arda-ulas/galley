import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";

/**
 * The small, local-only M1 language set. Selecting a language updates local
 * component state only — there is no server behavior and no metadata sync (that
 * is M6).
 */
export type LanguageId = "javascript" | "typescript" | "python" | "plaintext";

export const LANGUAGES: ReadonlyArray<{ id: LanguageId; label: string }> = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "plaintext", label: "Plain text" },
];

/**
 * Returns the CodeMirror language extension for a language id.
 *
 * Syntax highlighting is only available where the language's CodeMirror package
 * is installed. M1 adds no dependency beyond `@codemirror/search`, so only
 * JavaScript/TypeScript highlight; Python and Plain text edit without
 * highlighting while still being tracked in local state. Highlight packs for
 * additional languages arrive with a later slice.
 */
export function languageExtension(id: LanguageId): Extension {
  switch (id) {
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "python":
    case "plaintext":
      return [];
  }
}
