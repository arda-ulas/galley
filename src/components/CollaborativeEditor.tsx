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
import type { Snapshot } from "../lib/snapshots";
import { doc, provider, connectRoom } from "../lib/room";
import {
  amberExtensions,
  amberPastTheme,
  amberTheme,
} from "../lib/codeMirrorTheme";

type CollaborativeEditorProps = {
  pastSnapshot?: Snapshot | null;
};

export function CollaborativeEditor({
  pastSnapshot = null,
}: CollaborativeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // primitive dep — rebuilds exactly once per snapshot switch, not on every render
  const snapshotId = pastSnapshot?.id ?? null;

  useEffect(() => {
    if (!containerRef.current) return;

    const ytext = doc.getText("content");

    if (!pastSnapshot) {
      connectRoom();
    }

    const state = EditorState.create({
      doc: pastSnapshot ? pastSnapshot.text : ytext.toString(),
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
        pastSnapshot
          ? [
              amberPastTheme,
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
            ]
          : [amberTheme, yCollab(ytext, provider.awareness, { undoManager: false })],
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => {
      view.destroy();
      // entering past mode: null out cursor so other tabs don't show a stale widget
      if (!pastSnapshot) {
        provider.awareness.setLocalStateField("cursor", null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotId]);

  return <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />;
}
