import { bracketMatching, indentOnInput } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
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
import { javascript } from "@codemirror/lang-javascript";
import { useEffect, useRef } from "react";
import { yCollab } from "y-codemirror.next";
import { doc, connectRoom } from "../lib/room";
import { amberExtensions, amberTheme } from "../lib/codeMirrorTheme";

export function CollaborativeEditor() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    connectRoom();

    const ytext = doc.getText("content");

    const state = EditorState.create({
      // Initialize from Y.Text so CM and Yjs share the same starting content.
      // If Y.Text is empty (first tab before sync), CM starts empty too.
      // When sync completes and Y.Text receives content, the yCollab observer
      // fires and CM updates automatically.
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        javascript({ typescript: true }),
        amberExtensions,
        amberTheme,
        // Sync CM ↔ Y.Text. null awareness = no remote cursor rendering yet (Step 11).
        // undoManager: false = native CM history is intentionally omitted; a Yjs-aware
        // undo path (Y.UndoManager) will be wired when needed so undo never broadcasts
        // deletions of remote edits.
        yCollab(ytext, null, { undoManager: false }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => {
      view.destroy();
    };
  }, []);

  return <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />;
}
