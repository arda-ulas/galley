import { bracketMatching, indentOnInput } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { useEffect, useRef } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { DraftSession } from "../lib/draftSession";
import type { LanguageId } from "../lib/languages";
import { languageExtension } from "../lib/languages";
import { paperEditorTheme, paperHighlight } from "../lib/paperTheme";

type DraftEditorProps = {
  session: DraftSession;
  language: LanguageId;
};

/**
 * The M1 local-draft editor. It binds to the draft session's own `Y.Text`,
 * `Awareness`, and external `Y.UndoManager` — supplied by props, never created
 * here. No provider, no WebSocket, no past-preview. The live document is bound
 * once at mount and never replaced; only the language extension is reconfigured
 * (via a compartment) when the local language changes. Editor cleanup destroys
 * only the `EditorView` — it never touches session-owned resources.
 */
export function DraftEditor({ session, language }: DraftEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    if (!containerRef.current) return;

    const { text, awareness, undoManager } = session;
    const languageCompartment = languageCompartmentRef.current;

    const state = EditorState.create({
      doc: text.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        search(),
        highlightSelectionMatches(),
        // Yjs undo keymap is listed FIRST so Mod-z / Mod-y / Mod-Shift-z bind to
        // the Yjs UndoManager. Native CodeMirror history()/historyKeymap are
        // intentionally NOT included, so they cannot conflict with Yjs undo.
        keymap.of([
          ...yUndoManagerKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        languageCompartment.of(languageExtension(language)),
        paperHighlight,
        paperEditorTheme,
        // Accessible name on the editable content itself (the contenteditable
        // element screen readers land on), not on a wrapper.
        EditorView.contentAttributes.of({ "aria-label": "Code editor" }),
        // Bind to the session's Y.Text with the session's external UndoManager.
        yCollab(text, awareness, { undoManager }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // `language` is handled by the compartment effect below, not by rebuilding
    // the view, so it is intentionally excluded from these deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartmentRef.current.reconfigure(
        languageExtension(language),
      ),
    });
  }, [language]);

  return <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />;
}
