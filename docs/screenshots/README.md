# Screenshots — M4 milestone evidence

Captured 2026-07-29 against the shared-draft adoption milestone (commit `3214cef`
on `reconstruction/collab-first`), and moved here from the repository root by
M4.5 T6.

**These are a dated record, not a picture of current `HEAD`.** They will be
superseded at M12. Two things already differ:

- The header gained a **Download** control (M4.5 T5), so the header row in 01,
  02, 03, 07, and 08 is one control short of the current build.
- The browser tab title and favicon changed (M4.5 T2 / DEF-2). Not visible in
  these crops, which are viewport captures.

| File | Shows |
|---|---|
| `01-fresh-local-draft.png` | The local draft at `/` — empty sheet, `Local draft — not uploaded`, Share available. |
| `02-local-draft-edited.png` | The same draft after typing, with syntax highlighting. Still local; nothing uploaded. |
| `03-shared-after-adoption.png` | Immediately after Share: URL is `/{sheetId}`, title/language locked to authoritative metadata, access-truth sub-bar visible. |
| `04-joined-shared-sheet.png` | A second browser that joined by link and converged on the same document. Carries a remote caret — see below. |
| `05-refresh-durability.png` | The shared sheet after a full page refresh — content rehydrated from the server. Carries a remote caret — see below. |
| `06-unavailable-link.png` | The neutral unavailable surface for a path that is not a valid sheet route. |
| `07-narrow-viewport-header.png` | Header layout at a narrow viewport (1024×720). |
| `08-share-focus.png` | The Share control with a visible keyboard focus ring on a long title. |

## The cyan caret in 04 and 05

Files **04 and 05 each contain a cyan caret** — a bare vertical bar at the end of
line 2, measured at `rgb(48, 188, 237)` = **`#30BCED`**. No other screenshot in
this set contains any pixel of that colour.

That is the **y-codemirror.next default remote-caret colour**. What these two
frames show is the library's built-in anonymous remote-caret rendering, driven by
the awareness relay that the M4 milestone already ships. It is a real remote
caret, and this index does not claim otherwise.

**What it is not.** It carries no name, no assigned colour, no label, and no
presence surface — because nothing in the reconstruction writes an awareness
`user` field, so y-codemirror.next falls back to its own defaults (cyan
`#30BCED`, "Anonymous", hover-only label). Compare `docs/IMPLEMENTATION_PLAN.md`
§2.6, which predicts exactly this fallback.

**These historical M4 screenshots therefore do not demonstrate the planned,
productized Galley presence and remote-cursor experience.** That experience —
per-collaborator identity and colour, a presence surface, remote selections, and
jump-to-collaborator with a keyboard-accessible Back — is specified but **not
built**, and none of it appears here. Read the caret as evidence that awareness
frames reach the other client, not as evidence of a shipped presence feature.

> `04-joined-shared-sheet.png` was captured as `04-collaboration-remote-cursor.png`
> and renamed on being tracked. The neutral name is kept deliberately: the
> original asserted a *productized* remote-cursor feature that does not exist,
> while the frame in fact shows the library's unstyled anonymous default.
