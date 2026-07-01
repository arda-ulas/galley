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
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { useEffect, useRef } from "react";
import { amberExtensions, amberTheme } from "../lib/codeMirrorTheme";
import { editorSeed } from "../lib/editorSeed";

export function CollaborativeEditor() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let view: EditorView | undefined;
    try {
      const state = EditorState.create({
        doc: editorSeed,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          javascript({ typescript: true }),
          amberExtensions,
          amberTheme,
        ],
      });

      view = new EditorView({
        state,
        parent: containerRef.current,
      });
    } catch {
      // EditorView can fail in non-browser environments (e.g. jsdom in unit tests).
    }

    return () => {
      view?.destroy();
    };
  }, []);

  return <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />;
}
