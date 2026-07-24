# Echo/Rewind

Real-time collaborative code sharing — an in-progress reconstruction on the
`reconstruction/collab-first` branch.

> **Status: in-progress reconstruction, mid-milestone M4 (Share handoff).**
> The collaboration-first product is being rebuilt from the ground up. The M1
> local draft and the server prerequisites for Share exist, but the client
> Share handoff (M4) is not finished, so this branch does **not** implement the
> full collaborative experience yet. See "Current state" below for exactly what
> exists today. `docs/PRODUCT_BRIEF.md` is the canonical product definition.

## Current state (this branch)

The reconstruction separates the **visible product** from the **backend**; they
are at different stages.

**Visible product — M1 local draft.** The app renders a single local code draft
at `/`:

- Syntax-aware CodeMirror 6 editing with document title and language selection
- Real Yjs-backed undo/redo via the editor keymap
- Find/search (highlight matches, Escape returns focus to the editor)
- Fully local: no upload, no WebSocket, and no remote object are created while
  editing
- Every non-root path (including `/r/demo`) intentionally renders a neutral
  "unavailable link" state rather than a draft or a false error cause

The collaborative sheet UI, provider-connection UI, and presence are **not yet
wired into the render tree**. There is no two-tab collaborative demo on this
branch.

**Backend — durable sheet creation and validated restart bootstrap.** A
hand-rolled Node WebSocket server implements durable sheet creation over
`node:sqlite`, validated restart bootstrap, per-sheet write serialization, and
malformed-message containment. Live WebSocket edits are currently relayed in
memory and are not yet persisted. It boots and is covered by the server tests,
but no client UI consumes it yet.

## Tech stack

Vite · React 19 · TypeScript · CodeMirror 6 · Yjs · y-websocket ·
y-codemirror.next · y-protocols · `ws` · `node:sqlite` · Tailwind v4 ·
Framer Motion · Vitest · Playwright

Requires Node `>=22.22.2 <23` (see `.nvmrc`).

## Running locally

**App (M1 local draft)**
```
npm install
npm run dev        # http://127.0.0.1:5173
```

**WebSocket server** (runs and passes its tests, but has no UI consumer yet)
```
npm run server     # ws://127.0.0.1:1234
```

## Testing

```
npm run test              # Client unit tests — Vitest / jsdom (18 tests)
npm run test:integration  # Server tests — Vitest / node (323 tests)
npx tsc --noEmit          # TypeScript type check
npm run build             # Production build (tsc -b && vite build)
npm run test:e2e          # E2E — Playwright, M1 draft (8 tests)
```

349 tests total (18 client + 323 server + 8 e2e). Type check, build, and all
suites pass. The server suite lives under a separate config
(`vitest.integration.config.ts`) and is **not** included in `npm run test`.

## History

The original prototype — the "a collaborative code room where the timeline is
the interface" concept, with snapshot timeline scrubbing and past-preview — is
preserved as tags, not on this branch:

- `prototype-v1` (`4147372`) — stable historical collaboration prototype
- `week1-demo` (`ca8bb48`) — earlier demo checkpoint

`docs/ARCHITECTURE.md` documents that prototype and is explicitly marked
historical. That timeline-first framing is retired and is not the reconstruction
target.

## Documentation

- `docs/PRODUCT_BRIEF.md` — canonical product definition
- `docs/RECONSTRUCTION_ARCHITECTURE.md` — reconstruction architecture
- `docs/IMPLEMENTATION_PLAN.md` — milestone plan (M0–M12)
- `docs/DECISIONS.md` — decision log
- `docs/ARCHITECTURE.md` — historical (`prototype-v1`)
