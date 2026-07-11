import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Minimum Paper foundation for the M1 local-draft editor.
 *
 * This is the "warm-white, ink-first" foundation from docs/DESIGN_BRIEF.md — NOT
 * the final M11 convergence. Values are deliberately restrained and tunable
 * later. Ink-first means: most text stays near-ink, with a few muted hues; the
 * surface reads as a document, never a terminal.
 */
export const PAPER = {
  sheet: "#FAF8F4", // warm white
  canvas: "#ECE7DD", // slightly deeper, cooler canvas
  ink: "#1D1B17",
  inkMuted: "#6B6559",
  rule: "#DDD7CC",
  accentYou: "#3B5BA5", // local caret/selection (single restrained accent)
} as const;

export const paperEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "13px",
      lineHeight: "1.5",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      backgroundColor: PAPER.sheet,
      color: PAPER.ink,
    },
    ".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
    ".cm-content": { caretColor: PAPER.accentYou, padding: "16px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: PAPER.accentYou },
    "&.cm-focused .cm-cursor": { borderLeftColor: PAPER.accentYou },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "rgba(59, 91, 165, 0.14)",
    },
    ".cm-gutters": {
      backgroundColor: PAPER.sheet,
      color: "#B4AD9E",
      border: "none",
      borderRight: `1px solid ${PAPER.rule}`,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      paddingLeft: "8px",
      paddingRight: "12px",
      minWidth: "3ch",
    },
    ".cm-activeLine": { backgroundColor: "rgba(29, 27, 23, 0.03)" },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(29, 27, 23, 0.03)",
      color: "#6B6559",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(59, 91, 165, 0.16)",
      outline: "none",
    },
    // Find/search match highlight
    ".cm-searchMatch": { backgroundColor: "rgba(59, 91, 165, 0.16)" },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(59, 91, 165, 0.30)",
    },
    ".cm-panels": {
      backgroundColor: PAPER.canvas,
      color: PAPER.ink,
      borderTop: `1px solid ${PAPER.rule}`,
    },
    ".cm-tooltip": {
      backgroundColor: PAPER.sheet,
      border: `1px solid ${PAPER.rule}`,
      color: PAPER.ink,
    },
  },
  { dark: false },
);

// Ink-first syntax: identifiers stay near-ink; a small set of muted hues carry
// keywords/strings/comments/numbers/types. Squint test: a black-text document
// with inflections, not a rainbow.
const paperHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#7A3E9D" },
  { tag: tags.controlKeyword, color: "#7A3E9D" },
  { tag: tags.definitionKeyword, color: "#7A3E9D" },
  { tag: tags.moduleKeyword, color: "#7A3E9D" },
  { tag: tags.comment, color: "#8C8577", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#8C8577", fontStyle: "italic" },
  { tag: tags.string, color: "#3F7A46" },
  { tag: tags.special(tags.string), color: "#3F7A46" },
  { tag: tags.number, color: "#1F6F86" },
  { tag: tags.bool, color: "#7A3E9D" },
  { tag: tags.null, color: "#6B6559" },
  { tag: tags.typeName, color: "#9A5B2E" },
  { tag: tags.className, color: "#9A5B2E" },
  { tag: tags.definition(tags.variableName), color: PAPER.ink },
  { tag: tags.function(tags.variableName), color: "#2A4C8A" },
  { tag: tags.propertyName, color: "#3A362E" },
  { tag: tags.variableName, color: PAPER.ink },
  { tag: tags.operator, color: "#6B6559" },
  { tag: tags.punctuation, color: "#8C8577" },
  { tag: tags.bracket, color: "#8C8577" },
]);

export const paperHighlight = syntaxHighlighting(paperHighlightStyle);
