# Echo/Rewind — Canonical Prompts

Reference prompts for recurring agent tasks. Paste verbatim or adapt as needed.

---

## Amber Shell Refinement (Step 4)

```
Task: Audit and lock the Amber visual shell.

Files to check:
- src/styles/ (CSS custom properties)
- src/components/AppShell.tsx
- src/components/PresenceBar.tsx
- src/components/ConnectionStatus.tsx
- src/components/TimelineScrubber.tsx
- src/components/EditorPlaceholder.tsx
- index.html

Acceptance criteria:
1. All color tokens from docs/DESIGN.md are defined as CSS custom properties.
2. No Tailwind default blue appears anywhere in the UI.
3. No placeholder copy visible in the rendered app ("static scaffold", "CodeMirror placeholder", "markers only").
4. The three-row layout (36px top bar / 1fr editor / 52px bottom timeline) is stable.
5. `npx tsc --noEmit` passes.

Do not change any behavior. Do not add new components. Token names and hex values must exactly match docs/DESIGN.md.
```

---

## Per-Tab Session Identity (Step 5)

```
Task: Implement per-tab session identity using sessionStorage.

Check Context7 for any relevant React 19 hooks patterns if needed. No third-party identity library.

Create: src/lib/useSessionIdentity.ts

Schema:
  type SessionIdentity = {
    id: string;        // UUIDv4 — use crypto.randomUUID()
    name: string;      // adjective + animal, e.g. "Swift Fox"
    color: string;     // hex from the presence color palette
  };

Behavior:
- On first call, check sessionStorage for key "echo-rewind:identity"
- If absent, generate a new identity and persist it
- Return the identity on every subsequent call within the same tab

Names: pick from a hardcoded list of ~20 adjectives × ~20 animals. Seed randomly.
Colors (in order): #F5A623, #5BB8A0, #A78BFA, #F87171, #34D399

Wire:
- Import hook in RoomPage
- Pass local user to PresenceBar as the first user (before awareness users)
- Show a subtle "You" indicator on the local user's avatar

Acceptance:
- Two tabs show different names and colors
- Refreshing a tab reuses the existing identity
- npx tsc --noEmit passes
- npm run test passes
```

---

## y-websocket Server (Step 7)

```
Task: Add a y-websocket server and connect the client.

Check Context7 for: y-websocket server setup and WebsocketProvider API.

Create: server/index.ts
  - Import { WebSocketServer } from 'ws'
  - Import { setupWSConnection } from 'y-websocket/bin/utils'
  - Listen on port 1234
  - Log "Echo/Rewind server listening on ws://localhost:1234"

Add to package.json scripts:
  "server": "node --loader ts-node/esm server/index.ts"
  (or tsx if ts-node/esm causes issues — check which is available)

IMPORTANT: If ws, ts-node, or tsx is not already installed in package.json, stop and ask for approval before adding any dependencies.

Create: src/lib/room.ts
  - Create a singleton Y.Doc
  - Create a WebsocketProvider connected to ws://localhost:1234, room "demo"
  - Export { doc, provider }

Wire ConnectionStatus:
  - Import provider from room.ts
  - Derive status from provider.wsconnected: "synced" | "connecting" | "offline"
  - Use useEffect to subscribe to provider status events

Acceptance:
- npm run server starts without errors
- Two tabs both show "Synced" in ConnectionStatus within 2 seconds
- npx tsc --noEmit passes
```

---

## CodeMirror Editor (Step 8)

```
Task: Replace EditorPlaceholder with a real CodeMirror 6 editor.

Check Context7 for: @codemirror/view EditorView setup, @codemirror/state, @codemirror/lang-javascript.

Create: src/components/CollaborativeEditor.tsx

Requirements:
- EditorView mounted in a useEffect, destroyed on unmount
- Extensions: javascript(), lineNumbers(), EditorView.theme({...}) with Amber token colors
- Theme must match: background --editor-bg, text --editor-text, line numbers --editor-line, selection with --accent at 20% opacity
- No Yjs binding yet — local editor only
- Editor fills the full container height

Wire:
- Replace <EditorPlaceholder /> with <CollaborativeEditor /> in RoomPage

Acceptance:
- Editor renders with Amber theme
- Editor is editable (typing works locally)
- Line numbers visible
- No Yjs errors in console
- npx tsc --noEmit passes
```

---

## Snapshot Recorder (Step 13)

```
Task: Implement the snapshot recorder.

Check Context7 for: Yjs Y.Array API, Y.Text observe API.

Create: src/lib/snapshots.ts

Schema:
  type Snapshot = {
    id: string;
    text: string;
    createdAt: number;
  };

Behavior:
- Import doc from src/lib/room.ts
- Get snapshots array: doc.getArray<Snapshot>('snapshots')
- Observe doc.getText('content')
- Debounce: after 1500 ms of no changes, capture text and push a new Snapshot
- Use crypto.randomUUID() for id

Create: src/lib/useSnapshots.ts
  - Subscribe to Y.Array observe event
  - Return snapshots as React state
  - Clean up observer on unmount

Wire:
- Call initSnapshotRecorder() once in RoomPage after provider syncs
- Pass useSnapshots() result to TimelineScrubber

Acceptance:
- After typing and pausing 1.5 s, a snapshot appears in Y.Array
- useSnapshots() returns updated array without page refresh
- Snapshot appears in both Tab A and Tab B (Yjs sync)
- npx tsc --noEmit passes
- npm run test passes (unit test for debounce logic)
```

---

## Playwright Two-Tab Test (Step 17)

```
Task: Write the Playwright two-tab e2e test.

Check Context7 for: @playwright/test browser contexts API.

File: e2e/two-tab.spec.ts

Test cases:

1. Two distinct identities
   - Open context A and context B, both navigate to /r/demo
   - Assert presence bar in context A shows 2 users
   - Assert the two user names are different

2. Realtime sync
   - Type "hello world" in context A editor
   - Wait for context B editor to contain "hello world" (timeout: 3000 ms)

3. Timeline marker appears
   - After typing, wait 2000 ms
   - Assert at least one marker dot is visible in context A timeline

4. Past mode entry
   - Click the first marker
   - Assert the past mode pill is visible ("Viewing the past")
   - Assert the editor has readonly attribute

5. Return to now
   - Click "Return to now"
   - Assert the pill is gone
   - Assert the editor is editable

Config: server must be running before tests. Use webServer in playwright.config.ts if possible.

Acceptance:
- All 5 test cases pass
- npm run test:e2e exits 0
```
