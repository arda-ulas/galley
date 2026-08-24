# Screenshots — current HEAD

Captured 2026-08-24 against the M4.5 closeout checkpoint on
`reconstruction/collab-first`, from the running app (`npm run server` +
`npm run dev`) with no post-processing. Viewport captures at 1440×780; the
browser tab chrome is not in frame, so the `Galley` document title and favicon
(`index.html`) are not visible here.

The dated M4 set in [`../`](..) is kept as-is. It is **not** superseded content
to be overwritten — it is the evidence that was current at commit `3214cef`.

| File | Shows | What it proves |
|---|---|---|
| `01-local-draft.png` | The local draft at `/` after typing: Paper UI, syntax-highlighted TypeScript, editable title and language, `Local draft — not uploaded`, **Download**, **Share**. | The draft is a real, working editor. The frame shows the local/not-uploaded UI state; that no sheet, fetch, or WebSocket exists before Share is verified by the implementation and by `e2e/draft.spec.ts`'s "opens no collaboration/application WebSocket while editing (no upload before Share)" test, not by the picture. |
| `02-shared-sheet.png` | The **same document** one Share gesture later: identical text, identical active line, title and language now read-only, status `Shared`, and the access-truth sub-bar. | Authoritative metadata locking and the standing post-share state, with visible editor continuity across the handoff. (That the editor is not *remounted* is proved by `DraftPage.noRemount.test.tsx` and the e2e suite, not by the frame.) |
| `03-joined-sheet.png` | A second browser opened on the same `/{sheetId}` link. It converged on the document, added line 3, and renders the first browser's selection over `Math.min(…)` on line 15. | Direct-load/join, two-way convergence, and that awareness frames reach the other client. **Not** a presence feature — see below. |

The run behind these three frames used sheet id `UlW9Am34v77G_6gy` on a local
dev server; the id is per-run and carries no meaning.

## The cyan selection and caret in 03

The cyan band and caret on line 15 of `03-joined-sheet.png` are
y-codemirror.next's **built-in anonymous defaults** (`#30BCED`), not a Galley
design. Nothing in the reconstruction writes an awareness `user` field, so the
library falls back to its own colour and its hover-only "Anonymous" label.

Read it as: the awareness relay works and remote selections are transported and
anchored correctly. Do **not** read it as the planned Galley presence system —
per-collaborator identity and colour, a presence surface, and
jump-to-collaborator with a keyboard-accessible Back are specified and **not
built**. Same caveat, same reason, as the M4 set's note on `04` and `05`.

## What these frames do not show

- **Durable live editing.** The sheet in `02`/`03` is durable *as created*. The
  edits made after Share live in the server's in-memory `Y.Doc` and are not
  written back; that is M5.
- **A hosted service.** These are local. Nothing is running at a public URL.
