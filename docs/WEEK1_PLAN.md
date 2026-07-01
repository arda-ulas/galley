# Echo/Rewind — Week-1 Implementation Plan

## Goal

Ship the Week-1 demo: `/r/demo` open in two browser tabs, two visible cursors, and a scrubber that reliably reconstructs the past.

## Implementation Order

Steps are ordered for minimum risk. Each step must leave the app in a runnable state before the next begins.

---

### Step 1 — Scaffold app ✅
Vite + React + TypeScript + Tailwind v4 project created. Dependencies installed. Dev server runs.

### Step 2 — Static `/r/demo` shell ✅
`AppShell`, `PresenceBar`, `ConnectionStatus`, `TimelineScrubber`, and `EditorPlaceholder` components exist. Route `/r/demo` renders. Visual structure matches the Amber design system. Components are static with hardcoded demo data.

### Step 3 — Project documentation ✅
`docs/` folder with `PROJECT_SPEC.md`, `WEEK1_PLAN.md`, `DESIGN.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `TASKS.md`, `DEMO_SCRIPT.md`, `QA_CHECKLIST.md`, `AGENTS.md`, `PROMPTS.md`.

### Step 4 — Amber shell refinement
Audit the CSS custom properties and Tailwind config against the Amber palette. Verify: background, surface, border, text, muted, accent, teal, live green, temporal blue, past background. Remove any stray Tailwind defaults or placeholder copy. Lock the visual shell before any real functionality is added.

### Step 5 — Per-tab session identity
On app mount, read or create a session record in `sessionStorage`. Record includes `id` (UUID v4), `name` (adjective + animal word pair from a fixed seed list), `color` (round-robin from the Amber palette array). Export `useSessionIdentity()` hook. Add a `Me` indicator in the header (subtle, initials avatar). Two tabs in the same browser must display different names and colors.

### Step 6 — Presence data model
Define `PresenceUser` type and `usePresence()` hook (stub returning only the local user for now). `PresenceBar` consumes the hook instead of hardcoded `demoUsers`. This decouples the UI from the later Yjs awareness wiring.

### Step 7 — y-websocket server / client connection
Add `server/` directory. Write `server/index.ts`: a `y-websocket` server (Node `ws` + Yjs). Add `npm run server` script. Write `src/lib/room.ts`: creates the Yjs `Doc`, the `WebsocketProvider`, and exports both. `ConnectionStatus` reads live `provider.status`. Two tabs must both show "Synced".

### Step 8 — CodeMirror editor
Replace `EditorPlaceholder` with a real `CollaborativeEditor` component. Wire CodeMirror 6 with `javascript()` language support and the Amber editor theme. No Yjs binding yet — editor is local only. Verify it renders, is editable, and line numbers show.

### Step 9 — CodeMirror-Yjs binding
Add `y-codemirror.next` binding in `CollaborativeEditor`. Bind the shared `Y.Text` to the editor view. Typing in one tab must appear in the other within ~100 ms.

### Step 10 — Awareness presence
Broadcast the local session identity via `WebsocketProvider.awareness`. Subscribe to awareness changes and update `usePresence()`. `PresenceBar` now shows real connected users. Disconnected users disappear within ~5 s of tab close.

### Step 11 — Remote cursors / selections
Add `yCollab()` extension from `y-codemirror.next` with user awareness. Style remote cursors using the user's `color`. In live mode cursors must be visible and labeled.

### Step 12 — Seed starter code
On room creation (first `Y.Text` value is empty), insert the starter TypeScript snippet. Subsequent connections must not overwrite existing content.

### Step 13 — Snapshot recorder
In `src/lib/snapshots.ts`: debounce Y.Text change events (~1500 ms idle). On fire, push `{ id, text, createdAt }` into a `Y.Array<Snapshot>` on the shared doc. Export `useSnapshots()` hook returning the array reactively.

### Step 14 — Timeline markers
`TimelineScrubber` consumes `useSnapshots()`. Render a marker dot per snapshot at the proportional position along the track. Add hover tooltip with `formatRelative(snapshot.createdAt)`. Remove hardcoded `demoMarkers`.

### Step 15 — Past preview mode
Add `usePastMode()` hook: `{ isPast, snapshotIndex, enterPast(index), exitPast() }`. Clicking a marker calls `enterPast`. In past mode: replace editor content with the snapshot text, set CodeMirror `readOnly`, shift editor background to `--past-bg`, render the "Viewing the past · [time ago]" pill, ghost or hide remote cursors.

### Step 16 — Return to now
"Return to now" button in past mode calls `exitPast()`. Restores the live Yjs-bound editor, removes the pill, reverts background, shows remote cursors again. Button must always be reachable — not hidden behind the editor.

### Step 17 — Playwright two-tab test
Write `e2e/two-tab.spec.ts`. Open two browser contexts. Both navigate to `/r/demo`. Type in context A. Assert content appears in context B within 2 s. Assert presence bar shows 2 users. Drag scrubber to first marker. Assert editor becomes read-only. Click "Return to now". Assert editor is editable again.

### Step 18 — README / devlog polish
Update `README.md` with project description, screenshot, and `npm run dev` + `npm run server` quickstart. Add a brief devlog entry summarizing the week.

---

## Risk Register

| Risk | Mitigation |
|---|---|
| `y-codemirror.next` API has changed | Check Context7 docs before each API call |
| Two-tab test flaky due to timing | Use `waitForSelector` / polling in Playwright, not fixed `sleep` |
| Snapshot Y.Array not observed reactively | Use `Y.Array.observe` not a React effect on a value snapshot |
| Past mode leaks the Yjs observer | Always `unobserve` in cleanup |
| Visual regressions when wiring real components | Run Playwright visual check on each major step |
