# Echo/Rewind

**Real-time collaborative code sharing.** Open a local code draft, press **Share**,
and it becomes an authoritative server-backed *sheet* with a link you can send to
a collaborator — who opens the same URL and edits the same document. The
reconstruction is building a focused shared coding surface (closer to a
collaborative code sheet than a full IDE), with version history planned as a
quiet recovery surface rather than the centrepiece.

> **Status: in-progress reconstruction.** The **shared-draft adoption milestone**
> (Share handoff) is complete at commit `3214cef` on `reconstruction/collab-first`.
> Live presence/cursors, durable "saved" state, and Recent versions are **planned,
> not yet built** — see "Not yet built" below. `docs/PRODUCT_BRIEF.md` is the
> canonical product definition; `docs/RECONSTRUCTION_STATUS.md` records what this
> milestone actually ships.

## What it can do today

- **Local draft at `/`** — a syntax-aware CodeMirror 6 editor with a document
  title and language selector, real Yjs undo/redo, and Find/search. Nothing is
  uploaded and no socket is opened while editing.
- **Share → adopt** — one gesture creates a durable server sheet, copies the edit
  link, and swaps the URL to `/{sheetId}` **without remounting the editor**, so the
  exact same document, selection, and undo history carry over. Pre-Share edits
  remain undoable after Share.
- **Authoritative metadata** — after adoption the title and language are reconciled
  from the server's bootstrap response and shown read-only; transient local values
  never flash as if they were authoritative.
- **Direct-load / join** — opening `/{sheetId}` in another browser bootstraps the
  sheet's metadata, joins the shared session over WebSocket, and converges both
  peers; a refresh rejoins the live sheet.
- **Download / export** — one click yields a file whose name derives from the
  sheet title and whose extension derives from its language, containing exactly the
  current live text. Available on the local draft and on a joined shared sheet.
  Pure client: no upload, no server round-trip.
- **Honest state and failure handling** — the UI distinguishes *Local draft*,
  *Sharing…*, *Shared*, *Connecting…*, *Connection stopped.*, and a *couldn't share*
  fallback that keeps the draft safe. A clipboard failure still surfaces a
  selectable URL with a manual **Copy link** control.

## What's technically interesting

- **No-remount Share handoff** — the local draft's `Y.Doc`, `Awareness`, and
  `Y.UndoManager` are handed to the collaboration provider intact, so sharing never
  tears down the editor and never loses in-flight edits or undo history.
- **Generation-safe session lifecycle** — the shared-sheet page tags each async
  open with a generation id and abort controller, so StrictMode double-invocation,
  route changes, and stale terminal callbacks can never publish into a newer
  session or double-dispose a controller.
- **Idempotent durable create** — creation is keyed by a per-draft token so a lost
  response is recoverable without minting a second sheet; the server persists to
  SQLite (WAL, per-sheet serialized writes).
- **Deterministic end-to-end tests** — a test-only, generation-scoped create
  *barrier* lets Playwright prove "an edit made while Share is in flight survives"
  without sleeps, and reset/shutdown settle any barrier-held create before clearing or
  closing storage.

## Tech stack

Vite · React 19 · TypeScript · CodeMirror 6 · Yjs · y-websocket ·
y-codemirror.next · y-protocols · `ws` · `node:sqlite` · Tailwind v4 · Vitest ·
Playwright. Requires Node `>=22.22.2 <23` (see `.nvmrc`).

## Running locally

```
npm install
npm run dev      # app at http://127.0.0.1:5173
npm run server   # collaboration server at ws://127.0.0.1:1234 (for Share/join)
```

Open `http://127.0.0.1:5173/`, type in the draft, then press **Share**. The URL
becomes `/{sheetId}`; open that URL in a second browser to join. See the demo
walkthrough (§5) in `docs/RECONSTRUCTION_STATUS.md` for the full flow.

## Testing

```
npm run test              # client unit tests — Vitest / jsdom (273)
npm run test:integration  # server + client-lifecycle tests — Vitest / node (345)
npx tsc --noEmit          # TypeScript type check
npm run build             # production build (tsc -b && vite build)
npm run test:e2e          # Playwright end-to-end (12)
```

630 automated tests (273 unit + 345 integration + 12 e2e); type check and build
clean. The integration suite uses a separate config
(`vitest.integration.config.ts`) and is **not** part of `npm run test`.

## Current status

- **Branch:** `reconstruction/collab-first` (active reconstruction).
- **Milestone commit:** `3214cef` — completes the shared-draft adoption milestone
  (Share handoff).
- **Packaging:** a **draft** pull request into `main` tracks this milestone; it is
  work-in-progress packaging, not the final reconstruction release.
- **Stable checkpoints (never moved):** `week1-demo` (`ca8bb48`) and `prototype-v1`
  (`4147372`) preserve the earlier timeline-first prototype.

## Not yet built (roadmap)

Live presence, remote cursors/selections, and jump-to-collaborator · durable
`Shared · saved` state (content + metadata coverage) · title/language conflict
handling · Recent versions and local read-only preview ·
retention/expiry. These are sequenced in `docs/IMPLEMENTATION_PLAN.md`; the next
milestone is a **review/decision gate**, not yet started.

## Intentionally out of scope

Authentication and accounts · deployment infrastructure · multiple files or a file
tree · code execution, terminal, or output panes · chat and comments · AI or
autocomplete · linting or automatic formatting · a permanent timeline · restore
from version · branching/forking. The product is deliberately a single shared code
sheet, not an IDE.

## Documentation

- `docs/PRODUCT_BRIEF.md` — canonical product definition.
- `docs/RECONSTRUCTION_STATUS.md` — **as-built** status, architecture, demo, and QA
  for the current milestone (`3214cef`).
- `docs/RECONSTRUCTION_ARCHITECTURE.md` — the reconstruction architecture (design
  contract this milestone implements a slice of).
- `docs/IMPLEMENTATION_PLAN.md` — milestone plan (M0–M12).
- `docs/DECISIONS.md` — decision log (prototype + reconstruction).
- `docs/ARCHITECTURE.md` and `docs/archive/prototype-v1/` — historical
  (`prototype-v1`); preserved, not active direction.
