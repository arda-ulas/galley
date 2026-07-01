# Echo/Rewind — Architecture

## Overview

Echo/Rewind is a single-page application with a companion WebSocket server. There is no backend database, no auth service, and no REST API. All state lives in Yjs documents synced over WebSockets.

```
Browser Tab A          Browser Tab B
┌─────────────┐        ┌─────────────┐
│  React SPA  │        │  React SPA  │
│  CodeMirror │◄──────►│  CodeMirror │
│  Yjs Doc    │        │  Yjs Doc    │
└──────┬──────┘        └──────┬──────┘
       │                      │
       └──────────┬───────────┘
                  │ WebSocket
         ┌────────┴────────┐
         │  y-websocket    │
         │  server         │
         │  (Node.js)      │
         └─────────────────┘
```

## Client

### Entry point
`src/main.tsx` → mounts `<App />` into `#root`.

### Routing
`src/App.tsx` — hardcoded to render `<RoomPage roomId="demo" />`. No router library for week 1.

### Pages
`src/pages/RoomPage.tsx` — assembles `AppShell` with live data from hooks.

### Components
```
src/components/
  AppShell.tsx           — three-row grid shell
  CollaborativeEditor.tsx — CodeMirror + Yjs binding
  PresenceBar.tsx        — user avatar row
  ConnectionStatus.tsx   — WebSocket state indicator
  TimelineScrubber.tsx   — timeline track + markers
  ui/                    — shadcn primitives (tooltip, etc.)
```

### Hooks
```
src/lib/
  useSessionIdentity.ts  — per-tab UUID, name, color from sessionStorage
  usePresence.ts         — live presence users from Yjs awareness
  useSnapshots.ts        — Y.Array<Snapshot> reactive hook
  usePastMode.ts         — { isPast, snapshotIndex, enterPast, exitPast }
  room.ts                — Y.Doc, WebsocketProvider singleton
  snapshots.ts           — snapshot recorder (debounced Y.Text observer)
  theme.ts               — CodeMirror Amber theme extension
  cn.ts                  — clsx + tailwind-merge utility
```

### State model

**Session identity** — `sessionStorage`. Never shared with the server. Broadcast via awareness.

**Shared document** — single `Y.Doc` per room, synced via `y-websocket`. Contains:
- `doc.getText('content')` — the collaborative editor text
- `doc.getArray('snapshots')` — append-only array of `Snapshot` objects

**Awareness** — per-user ephemeral state broadcast via `WebsocketProvider.awareness`. Contains `{ id, name, color, cursor, selection }`.

**Past mode** — local React state only. Never shared. Entering past mode does not affect other users.

### Snapshot schema
```ts
type Snapshot = {
  id: string;          // UUIDv4
  text: string;        // full document text at capture time
  createdAt: number;   // Date.now()
};
```

## Server

`server/index.ts` — Node.js process. Uses `ws` WebSocket library wrapped by `y-websocket`'s `setupWSConnection`. Listens on `ws://localhost:1234`.

No persistence. Restarting the server clears all room state (acceptable for week 1).

## Data Flow — Typing

```
User types in Tab A
  → CodeMirror transaction
  → y-codemirror.next converts to Yjs update
  → Y.Doc applies update locally
  → WebsocketProvider sends update over WebSocket
  → Server broadcasts to all clients in room
  → Tab B's WebsocketProvider receives update
  → Tab B's Y.Doc applies update
  → y-codemirror.next transaction updates CodeMirror view
  → Tab B editor reflects new content
```

## Data Flow — Snapshot

```
User pauses typing for 1500 ms
  → debounced observer fires
  → reads Y.Text.toString()
  → pushes Snapshot into Y.Array
  → Y.Array sync propagates to all tabs
  → useSnapshots() hook re-renders TimelineScrubber
  → new marker appears on timeline in all tabs
```

## Data Flow — Past Mode

```
User clicks marker on timeline
  → enterPast(snapshotIndex) called
  → usePastMode sets isPast = true
  → CollaborativeEditor reads snapshot.text
  → Sets CodeMirror content to snapshot.text
  → Sets readOnly = true
  → Editor background transitions to --past-bg
  → Pill appears: "Viewing the past · N min ago"
  → Remote cursors ghosted
```

Past mode is **local only**. It does not pause or rewind the Yjs document for other users.

## Technology Rationale

| Technology | Why |
|---|---|
| Yjs | Established CRDT library with strong collaboration semantics. Correct merge without coordination. |
| y-websocket | Simplest Yjs sync transport. Zero config for week 1. No database. |
| CodeMirror 6 | Modular, TypeScript-native, excellent Yjs integration via y-codemirror.next. |
| Vite | Fast HMR. Native ESM. No config overhead for single-page apps. |
| Tailwind v4 | CSS-variable-first design tokens. Works well with Amber's custom palette. |
| React 19 | Concurrent features available. Standard ecosystem. |
| sessionStorage | Tab-scoped identity without cookies, auth, or server round-trips. |
