# Reconstruction Status — Shared-draft adoption milestone

**Status:** As-built record for commit `3214cef` ("feat: complete shared draft
adoption") on `reconstruction/collab-first`.
**Milestone:** Share handoff — the local draft → authoritative shared sheet
transition (M4 in `docs/IMPLEMENTATION_PLAN.md`).
**Scope of this document:** what is *actually implemented and validated* at this
commit — not the full product, and not a promise of the sequenced-but-unbuilt
milestones.

> This is a milestone as-built record, not a release. `docs/PRODUCT_BRIEF.md` is the
> canonical product contract; `docs/RECONSTRUCTION_ARCHITECTURE.md` is the design
> contract this milestone implements a slice of. Where the two describe behaviour
> not yet built (presence, durable `saved`, Recent versions), this document defers
> to them and does not claim it.

---

## 1. What this milestone completes

- A **local draft** at `/` backed by an unconnected Yjs document.
- A one-gesture **Share** that creates a durable server-backed sheet, copies the
  edit link, and adopts the draft into that sheet **without remounting the editor**.
- **Authoritative title/language** reconciled from the server after adoption.
- **Direct-load / join** of `/{sheetId}` in a fresh tab or browser, converging two
  peers over WebSocket.
- A **truthful, bounded state grammar** for exactly the states that exist today.
- Deterministic **automated coverage** of the above, including a test-only Share
  barrier and reset/shutdown ordering guarantees.

It does **not** complete: live presence/cursors, jump-to-collaborator, the durable
`Shared · saved` claim, metadata conflict handling, Download/export, Recent
versions, or retention. Those remain sequenced in the implementation plan.

---

## 2. Current product promise (honest wording)

The UI only makes claims backed by mechanisms that exist at this commit:

| State | Meaning today |
|---|---|
| `Local draft — not uploaded` | No remote object exists; nothing has been uploaded. |
| `Sharing…` | A durable create request is in flight. |
| `Shared` | The sheet was created durably and the session adopted it. **Not** a durability-of-every-keystroke claim (`Shared · saved` is a later milestone). |
| `Connecting…` | A sheet connection is pending, first sync not yet complete — either during a direct-load/bootstrap of `/{sheetId}`, or immediately after Share while the newly adopted sheet's connection is still coming up. |
| `Connection stopped.` | A terminal close. It can occur **before** first successful sync (no editor is mounted yet) or after the editor is already live (in which case the editor stays locally editable); the editor is not always present. |
| `This link is unavailable` | An intentionally **neutral** surface. It covers malformed/unsupported shared-sheet routes, unavailable or nonexistent sheet ids, and any case where the app deliberately does not expose a more specific cause. |
| `This sheet couldn’t be opened.` | The sheet failed to bootstrap. |
| `Couldn’t share — your draft is safe here` | Share failed pre-transfer; the local draft is intact and editable. |

The words `Shared · saved`, `Saving…`, `Reconnecting…`, and any presence claim are
**deliberately absent** — the guarantees they assert are not built yet.

---

## 3. Architecture as built

### 3.1 Boundaries

- **Browser client** — Vite/React SPA. Hosts the CodeMirror editor bound to a Yjs
  document, the local draft (unconnected `Y.Doc`), the shared session after Share,
  and the client-owned `Y.UndoManager`. Talks only to its own origin; in dev, Vite
  proxies `/api` and `/ws` to the collaboration server.
- **Collaboration server** — a hand-rolled Node HTTP + WebSocket server
  (`server/app.mjs`) over `ws` and `y-protocols`, with a SQLite persistence layer
  (`node:sqlite`, WAL, `synchronous = FULL`, per-sheet serialized write queue).
- **Persistence boundary** — durable sheet rows (encoded Yjs state, title/language
  metadata, monotonic revision, committed state vector, idempotency token). Live
  WebSocket edits are relayed between peers and are **not yet persisted** (no
  durable-live claim).

### 3.2 Same-origin surface

| Route | Purpose |
|---|---|
| `POST /api/sheets` | Idempotent durable create (Share). |
| `GET /api/sheets/{sheetId}` | Read-only bootstrap: safe metadata for direct-load. |
| `WS /ws/{sheetId}` | Collaboration transport (Yjs sync + awareness relay). |

Client route model (`src/lib/route.ts`): `/` → local draft; a well-formed
`/{sheetId}` → shared-sheet join page; everything else → neutral unavailable
surface. `App` is intentionally stateless, so `replaceState` after Share does not
re-render it — the sharer stays mounted on the draft page (no remount).

### 3.3 Local draft → shared sheet (Share handoff)

```
Local draft (unconnected Y.Doc + Awareness + UndoManager)
  │  press Share
  ▼
POST /api/sheets  { creationToken, submittedUpdate, submittedStateVector,
                    title, language, schemaVersion }
  │  durable commit (idempotent by creationToken)
  ▼
attach the collaboration provider to the EXISTING doc + awareness  ← no remount
  │  history.replaceState → /{sheetId}
  ▼
reconcile authoritative title/language from GET /api/sheets/{sheetId}
```

Invariants:

- **No editor remount** — the provider attaches to the exact existing `Y.Doc`,
  `Awareness`, and `Y.UndoManager`; selection, scroll, and undo history survive, so
  a pre-Share edit is still undoable after Share.
- **Idempotent create** — the per-draft creation token collapses a retried/lost
  response onto the same sheet; a stale token can recover an already-created sheet.
- **Authoritative metadata** — because a recovered sheet may carry different
  title/language than the fresh local draft, the adopted view fetches the server's
  bootstrap and shows those values read-only. Local values are never shown as
  authoritative, not even transiently while that fetch is pending.
- **Clipboard is independent** — a clipboard failure never rolls back the share; the
  URL is shown with a manual Copy-link fallback.

### 3.4 Shared-sheet session ownership and generation safety

Opening `/{sheetId}` (`src/lib/sheetSession.ts`, `src/pages/SheetPage.tsx`):

- Each open attempt gets a **generation id** and an **AbortController**. A result or
  callback that is not the current generation is ignored, and any READY controller
  it carried is disposed rather than published.
- The open lifecycle is **totalized**: bootstrap fetch, session/controller/provider
  construction, connect, and terminal/abort all resolve to an explicit outcome; the
  operation never rejects unexpectedly.
- **Terminal-wins / ready-gate ordering** — a terminal close before first sync wins
  over a not-yet-published ready; a post-ready terminal keeps the editor mounted and
  only reports the stopped state.
- **Cleanup is latched and single-shot** — the outcome is latched before disposal,
  so a terminal emitted synchronously during `dispose()` cannot recurse or change
  the outcome, and the controller is disposed exactly once (StrictMode-safe).

### 3.5 Test-only create barrier (absent in production)

To prove "an edit made while Share is in flight survives" without timing hacks, the
server exposes a **test-mode-only** create barrier. It is constructed only under
the server's test flag and has **no production surface**.

- `POST /__test/hold-create` → mints a fresh generation `holdId` and holds the next
  create.
- `GET /__test/hold-create/reached?holdId=…` → resolves only once a create for that
  exact generation has entered and parked (the server-reached acknowledgement), so
  the test never races ahead of the server.
- `POST /__test/release-create?holdId=…` → releases that generation.
- Re-arming while a create is entered and active returns **HTTP 409** and leaves the
  held generation untouched; a stale/unknown `holdId` is inert.

### 3.6 Reset / shutdown ordering invariant

`POST /__test/reset` and server shutdown **settle any in-flight held create**
(release it and await its completion) **before** clearing durable rows or closing
the database — so a resumed create can never race a storage clear/close. The e2e
launcher owns the throwaway database and deletes it only after the server process
has exited (process-exit-before-delete), which is portable and leaks no files.

---

## 4. Validation at `3214cef`

| Check | Result |
|---|---|
| `npm run test` (client unit, Vitest/jsdom) | 273 passed |
| `npm run test:integration` (server + client lifecycle, Vitest/node) | 345 passed |
| `npm run test:e2e` (Playwright) | 12 passed |
| `npx tsc --noEmit` | clean |
| `npm run build` (`tsc -b && vite build`) | clean |
| `git diff --check` | clean |

Implementation acceptance completed with no remaining required fixes before commit.

---

## 5. Demo walkthrough (currently working behaviour only)

Prerequisite: `npm install`, then `npm run dev` and `npm run server` in parallel.

### Public demo flow

1. **Open the local draft.** Visit `http://127.0.0.1:5173/`. The status reads
   `Local draft — not uploaded`; no upload and no WebSocket occur.
2. **Edit before Share.** Type a short snippet; set a title and language.
3. **Undo, then redo, before Share.** Press `Mod-Z` to revert the last edit, then
   `Mod-Shift-Z` to restore it. This shows the local Yjs undo stack exists and is
   intact before sharing (the entry is consumed and then restored, so nothing is
   left removed going into Share).
4. **Share.** Press **Share**. The status moves through `Sharing…` to `Shared` and the
   URL changes to `/{sheetId}` with **no editor reload** (the same editor node stays
   mounted).
5. **Confirm preservation.** Title, language, and content are intact after the
   handoff, and undo still operates on the same document through the same manager.
6. **Direct-load / join.** Copy the URL and open it in a second browser (or
   incognito). It shows `Connecting…` briefly, then the same content; edits made in
   one browser appear in the other.
7. **Refresh.** Reload the shared URL; it rejoins the live sheet and shows current
   content.
8. **Clipboard fallback (optional).** With clipboard access denied, sharing still
   succeeds; a selectable URL and a **Copy link** control remain available and a
   repeated failed copy does not roll anything back.

### Deterministic pre-Share undo proof (acceptance test, not a product step)

Proving that a *specific* pre-Share undo group survives the ownership handoff needs
explicit undo-capture boundaries, created by a **dev/test-only hook**
(`window.__galleyTest.stopUndoCapturing()`) — test instrumentation, **not**
user-facing product UI. `e2e/share.spec.ts` runs this sequence:

1. Type `ALPHA`; close the capture group (boundary).
2. Type `BETA`; close the capture group (boundary).
3. Undo once → `BETA` is removed; redo once → `BETA` is restored (the local stack exists).
4. Begin Share (held via the test barrier); type `GAMMA` while the create is pending; complete Share.
5. Undo once → the during-Share `GAMMA` group is removed.
6. Undo again → the preserved pre-Share `BETA` group is removed.
7. `ALPHA` remains.

The undo/redo in step 3 demonstrates the local stack exists; the post-Share undos in
steps 5–6 demonstrate that a genuine **pre-Share** entry (`BETA`) survived the
draft→shared ownership handoff. The capture-boundary and create-hold steps are
acceptance-test instrumentation, not manual portfolio steps.

**What this demo does not yet prove:** live remote cursors/selections, jump-to-
collaborator, a durable `Shared · saved` guarantee, metadata conflict resolution,
Recent versions, or retention. Those are not implemented at this commit.

---

## 6. Manual QA checklist

Run against `npm run dev` + `npm run server` unless noted.

**Setup**
- [ ] Clean `npm install` on Node `>=22.22.2 <23` succeeds.
- [ ] `npm run dev` serves `/`; `npm run server` starts the collaboration server.

**Local draft**
- [ ] `/` shows `Local draft — not uploaded`, an editable title, and a language select.
- [ ] Typing works; Find (`Mod-F`) highlights matches and Escape returns focus.
- [ ] Undo/redo via the editor keymap works.
- [ ] No WebSocket/network request is made while merely editing (DevTools Network).
- [ ] Reloading `/` yields a fresh empty draft.

**Share / adoption**
- [ ] Share moves `Local draft` → `Sharing…` → `Shared` and swaps the URL to `/{sheetId}`.
- [ ] The editor is not remounted (same caret/scroll; an edit made during Share survives).
- [ ] A pre-Share edit is still undoable after Share.
- [ ] With clipboard denied, Share still succeeds and shows a selectable URL + Copy link.
- [ ] A failed Share (server down) shows `Couldn’t share — your draft is safe here` and stays editable.

**Authoritative metadata**
- [ ] After adoption, title/language are read-only and match the server’s values.

**Direct-load / join / refresh**
- [ ] Opening `/{sheetId}` in a second browser joins and converges both ways.
- [ ] A valid-shaped but nonexistent id shows `This link is unavailable` with no editor.
- [ ] Reloading a joined sheet rejoins the live state.

**Lifecycle / isolation**
- [ ] StrictMode/dev double-mount does not duplicate sessions or leak controllers.
- [ ] The Playwright run leaves no orphaned server process or SQLite files.

**Accessibility**
- [ ] The editor exposes an accessible name; the shared URL field has an accessible label (`Shared URL`).
- [ ] Title and language controls are keyboard reachable; read-only state is conveyed, not only visual.

**Required automated checks** (`npm run test` is client-only; the server + client-lifecycle suite is the separate `npm run test:integration`)
```
npm run test
npm run test:integration
npx tsc --noEmit
npm run build
npm run test:e2e
git diff --check
```

---

## 7. Immediate next (review / decision gate — not started)

This milestone is packaged for review; the next step is a **gate**, not an
implementation commitment:

- [ ] Documentation consistency pass (this doc, README, decisions).
- [ ] Manual demo QA on the current build (§5–§6) and capture of screenshots/recordings.
- [ ] Design and product-framing review (collaborative-sheet-first direction).
- [ ] Decide the next milestone (the sequenced candidate is durable acknowledgement
      + state machines, M5a) **only after** the packaging review — do not begin it
      as part of this pass.

No next feature milestone is selected or started by this document.
