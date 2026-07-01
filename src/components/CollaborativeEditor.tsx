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

  // Re-create the CodeMirror view whenever the viewed snapshot changes.
  // Using the id (or null) as the dep signal means we rebuild exactly once
  // per mode switch, not on every RoomPage re-render.
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
      // Clear only the cursor field so other tabs stop rendering this tab's
      // stale cursor while it views the past. The `user` field (presence
      // identity) is left intact and continues broadcasting.
      if (!pastSnapshot) {
        provider.awareness.setLocalStateField("cursor", null);
      }
    };
    // pastSnapshot object is stable in state between re-renders; snapshotId
    // is the primitive dep that captures enter/exit/switch events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotId]);

  return <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />;
}
