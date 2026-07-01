# Echo/Rewind

A collaborative code room where the timeline is the interface.

Users edit code together in real time, see each other's cursors, and can scrub a timeline to rewind the session and inspect earlier states of the document.

## Features

- Realtime collaborative editing via Yjs CRDT
- Multiplayer presence with distinct per-tab identities (sessionStorage)
- Remote cursor rendering via y-codemirror.next
- Automatic snapshot capture after 1500ms idle (debounced)
- Timeline with clickable markers
- Rail click and drag-scrub to nearest snapshot
- Read-only past preview mode (local state, never mutates Y.Text)
- Animated "Viewing the past" pill with timestamp
- "Return to now" restores the live collaborative editor
- Premium dark Amber theme

## Tech stack

Vite · React · TypeScript · CodeMirror 6 · Yjs · y-websocket · y-codemirror.next · Tailwind v4 · Framer Motion · Vitest · Playwright

## Local demo

**Terminal 1 — WebSocket server**
```
npm run server
```

**Terminal 2 — Vite dev server**
```
npm run dev
```

Then open two tabs at `http://127.0.0.1:5173/r/demo`.

Both tabs must show **Live** in the top bar before starting the demo.

## Known limitations

- In-memory server only — all room state is lost on server restart
- No auth or persistence (Week-1 scope)
- `/r/demo` is the only room (roomId hardcoded in App.tsx for Week 1)
- Starter code is duplicated in server/index.mjs for race-safe server-side seeding; src/lib/editorSeed.ts is the canonical reference
- Bundle is ~846 kB unminified (Yjs + CodeMirror are large)

## Testing

```
npm run test          # Vitest unit tests (42 tests)
npx tsc --noEmit     # TypeScript type check
npm run build         # Production build
npm run test:e2e      # Playwright E2E (13 tests, starts server automatically)
```
