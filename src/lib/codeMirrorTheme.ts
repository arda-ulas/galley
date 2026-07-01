import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const amberTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "13px",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      backgroundColor: "#0F0D0B",
      color: "#D4C9B4",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "inherit",
    },
    ".cm-content": {
      caretColor: "#F5A623",
      padding: "16px 0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#F5A623",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "rgba(245, 166, 35, 0.15)",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#F5A623",
    },
    ".cm-gutters": {
      backgroundColor: "#0F0D0B",
      color: "#3A3020",
      border: "none",
      borderRight: "1px solid #2A2318",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      paddingLeft: "8px",
      paddingRight: "12px",
      color: "#3A3020",
      minWidth: "3ch",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(245, 166, 35, 0.06)",
      color: "#7A6850",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(245, 166, 35, 0.04)",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(245, 166, 35, 0.2)",
      outline: "none",
    },
    ".cm-tooltip": {
      backgroundColor: "#161310",
      border: "1px solid #2A2318",
      color: "#D4C9B4",
    },
  },
  { dark: true },
);

const amberHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#F5A623", fontWeight: "500" },
  { tag: tags.controlKeyword, color: "#F5A623", fontWeight: "500" },
  { tag: tags.definitionKeyword, color: "#F5A623", fontWeight: "500" },
  { tag: tags.moduleKeyword, color: "#F5A623", fontWeight: "500" },
  { tag: tags.comment, color: "#5A4D38", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#5A4D38", fontStyle: "italic" },
  { tag: tags.string, color: "#C4A882" },
  { tag: tags.special(tags.string), color: "#C4A882" },
  { tag: tags.number, color: "#5BB8A0" },
  { tag: tags.bool, color: "#F5A623" },
  { tag: tags.null, color: "#7A6850" },
  { tag: tags.typeName, color: "#D4A76A" },
  { tag: tags.className, color: "#D4A76A", fontWeight: "500" },
  { tag: tags.definition(tags.variableName), color: "#E8E0D0" },
  { tag: tags.definition(tags.propertyName), color: "#C8B896" },
  { tag: tags.function(tags.variableName), color: "#E0C080" },
  { tag: tags.function(tags.propertyName), color: "#E0C080" },
  { tag: tags.propertyName, color: "#C4B8A0" },
  { tag: tags.variableName, color: "#D4C9B4" },
  { tag: tags.operator, color: "#9A7F5A" },
  { tag: tags.punctuation, color: "#7A6850" },
  { tag: tags.bracket, color: "#8A7460" },
  { tag: tags.angleBracket, color: "#9A7F5A" },
  { tag: tags.tagName, color: "#D4A76A" },
  { tag: tags.attributeName, color: "#C4B8A0" },
  { tag: tags.self, color: "#F5A623" },
  { tag: tags.namespace, color: "#D4C9B4" },
]);

export const amberExtensions = syntaxHighlighting(amberHighlightStyle);
