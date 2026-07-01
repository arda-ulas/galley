# Echo/Rewind — Architecture

## Overview

Echo/Rewind is a React single-page application paired with a hand-rolled Node.js WebSocket server. Two browser tabs open to the same room share a Yjs CRDT document over WebSocket, giving them a consistent view of the collaborative text and an append-only snapshot log. The client converts that snapshot log into a scrubable timeline; clicking a marker or dragging the rail replaces the live editor with a read-only view of an older document state, entirely in local React state, without disturbing the Yjs document or the other tab.

## Data model

The room's `Y.Doc` holds two shared structures:

- `Y.Text("content")` — the live collaborative document text, bound to the CodeMirror editor via y-codemirror.next
- `Y.Array<Snapshot>("snapshots")` — an immutable append-only log; entries are never removed or mutated

`Snapshot` shape:
```ts
type Snapshot = {
  id: string;       // crypto.randomUUID()
  text: string;     // full document text at capture time
  createdAt: number; // Date.now()
};
```

## Sync layer

`server/index.mjs` is a custom WebSocket server written directly against the `ws` package and the `y-protocols` encoding library. It does not use the y-websocket npm server binary — the server is hand-rolled for simplicity and full control.

On connection it handles two message types:
- `MSG_SYNC (0)` — standard Yjs two-step sync protocol; brings a new client up to date with the room's current document state
- `MSG_AWARENESS (1)` — forwards cursor and presence updates to all other clients in the room

Rooms are created lazily on first connection. Starter code is inserted into `Y.Text("content")` atomically at room creation time. Because Node.js is single-threaded, `getRoom()` is effectively a critical section — two concurrent connections cannot both observe an empty room and both insert the seed.

`/__test/reset` (POST, `TEST_MODE` only) clears the in-memory rooms map. Playwright's `beforeEach` hook calls this endpoint to give each E2E test a clean starting state.

## Awareness

Each tab broadcasts ephemeral state via `provider.awareness`:
- `{ user: { id, name, color, status } }` — identity and connection status, set once on mount from `sessionStorage`
- `{ cursor: ... }` — current cursor/selection position, updated on every CodeMirror view update while the editor has focus; set to `null` when entering past mode so remote cursors disappear

`sessionStorage` (not `localStorage`) ensures each browser tab gets a unique, stable identity that is not shared across tabs in the same browser profile.

The server tracks which awareness client IDs each WebSocket connection owns. On disconnect, it calls `removeAwarenessStates` with those IDs, which broadcasts a removal update to remaining clients so stale avatars clear immediately.

## Snapshot recorder (`src/lib/snapshots.ts`)

`createSnapshotRecorder` attaches an observer to `Y.Text`. On each change it clears and restarts a `setTimeout` of `SNAPSHOT_IDLE_MS` (1500ms). When the timer fires:
- If the text is empty, it skips (no snapshot of an empty document)
- If the text equals the last snapshot's text, it skips (no duplicate)
- Otherwise it pushes a new `Snapshot` to `Y.Array<Snapshot>`

The observer checks `transaction.local` before acting — remote updates arriving from other tabs do not trigger a snapshot. Only the tab that typed the content captures it.

The recorder returns a cleanup function that unobserves and clears the pending timer; `RoomPage` calls it from a `useEffect` cleanup.

## Past preview

Past mode is pure local React state: `selectedSnapshot: Snapshot | null` in `RoomPage`.

When a snapshot is selected:
- `CollaborativeEditor` destroys the live CodeMirror view (which has the `yCollab` extension and the Yjs binding)
- It creates a new CodeMirror view initialized with `snapshot.text` and `readOnly: true`
- The "Viewing the past" pill animates in via Framer Motion
- `provider.awareness` cursor field is cleared to `null`

The live `Y.Doc` and `Y.Text` are never touched. The other tab keeps collaborating normally.

When the user clicks "Return to now":
- `setSelectedSnapshot(null)` is called
- `CollaborativeEditor` destroys the read-only view and recreates the live view with the `yCollab` extension
- The Yjs binding re-establishes; the editor reflects the current live document state, including any edits made by the other tab while this tab was in past mode

## Timeline

`snapshotsToMarkers()` in `src/lib/timeline.ts` converts the snapshot array to percentage positions along the rail:
- Empty input → empty output
- Single snapshot → pinned at 80% (clear of the "now" label on the right)
- Multiple snapshots → linearly mapped from 5% to 88% by `createdAt`, capped at the 30 most recent entries

`nearestMarkerForPosition()` finds the marker whose position is closest to a given percentage. It is used by both the rail click handler and the drag handler.

Drag scrub: `pointerdown` on the rail starts a drag, `pointermove` calls `nearestMarkerForPosition` on each move and updates `selectedSnapshot`, `pointerup` / `pointercancel` stops the drag. Drag state is tracked locally in the timeline component. If the pointer is released outside the rail, the next pointer move that re-enters the rail sees `e.buttons === 0` and clears the drag state.

## Component tree

```
App
└── RoomPage              owns selectedSnapshot state, mounts snapshot recorder
    ├── AppShell          three-row grid shell (header / editor area / footer)
    │   ├── ConnectionStatus
    │   └── PresenceBar
    ├── CollaborativeEditor   live or read-only CodeMirror view, Yjs binding
    └── TimelineScrubber  rail, markers, drag handler
```

`RoomPage` is the sole orchestration point for mode switches. It passes `pastSnapshot` down to `CollaborativeEditor` and marker callbacks down to `TimelineScrubber`.
