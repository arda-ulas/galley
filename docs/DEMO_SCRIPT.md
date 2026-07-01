# Echo/Rewind — Demo Script

This is the walkthrough for the Week-1 portfolio demo. Every step must work without explanation or apology. If any step fails, the demo is not ready.

---

## Setup (before presenting)

1. `npm run server` — start the y-websocket server on `ws://localhost:1234`
2. `npm run dev` — start the Vite dev server on `http://127.0.0.1:5173`
3. Open `http://127.0.0.1:5173/r/demo` in **Tab A**
4. Open `http://127.0.0.1:5173/r/demo` in **Tab B** (same browser, different tab)
5. Arrange tabs side-by-side so both are visible simultaneously

---

## Demo Beats

### Beat 1 — Two identities, one room

**What to show**: Both tabs are open. Point to the header presence bar in each tab.

Tab A shows two colored avatars. Tab B shows two colored avatars. The names are different (e.g., "Swift Fox" in Tab A, "Bold Raven" in Tab B). The connection status reads "Synced" in both. The starter TypeScript snippet is visible in the editor.

**Talking point**: "Each tab gets its own identity from sessionStorage — no auth required. They're genuinely separate users sharing one room."

---

### Beat 2 — Realtime sync

**What to show**: Click into the editor in Tab A. Type a new function, e.g.:

```typescript
function greet(name: string) {
  return `Hello, ${name}!`;
}
```

**What to observe**: The same text appears in Tab B within ~100 ms. No button press, no manual sync.

**Talking point**: "Yjs CRDT syncing over WebSocket. If both users type simultaneously, Yjs merges the edits — no conflicts, no last-write-wins."

---

### Beat 3 — Remote cursors

**What to show**: Move the cursor around in Tab A. Point to Tab B — a colored cursor caret appears at the same position, labeled with the user name.

**Talking point**: "Yjs awareness protocol broadcasts cursor position. This mirrors the kind of presence pattern used by multiplayer editors."

---

### Beat 4 — Timeline accumulates

**What to show**: Pause typing for ~2 seconds. Point to the timeline footer.

A new amber marker dot appears on the timeline. Its tooltip shows "just now". Type more, pause again. Another marker appears at a later position on the track.

**Talking point**: "Every editing pause captures a snapshot. The timeline is the product — it's a record of how this session evolved."

---

### Beat 5 — Rewind

**What to show**: Click the earliest marker on the timeline (or drag the scrubber left past it).

**What to observe**:
- The editor background shifts to a cooler, darker tone
- The editor content changes to the code as it was at that snapshot
- A pill appears: "Viewing the past · 3 min ago" (or however long ago)
- The editor is read-only — clicking into it does not allow typing
- The remote cursor in Tab B ghosts or disappears

**Talking point**: "Past mode is purely local — the other tab keeps collaborating in the present. You're looking at history without disrupting the room."

---

### Beat 6 — Return to now

**What to show**: Click "Return to now" (button visible near the pill or at the bottom of the editor area).

**What to observe**:
- The editor background returns to the warm dark tone
- The live Yjs-bound content reappears (including any edits made while you were in the past)
- The "Viewing the past" pill disappears
- Remote cursors reappear

**Talking point**: "The Yjs document kept syncing while you were looking at the past. Returning to now snaps you back to the live state."

---

## Common Questions

**Q: What happens if both users type at the same exact time?**
A: Yjs CRDT merges both edits. No conflict dialog, no overwrite. Both changes appear.

**Q: Is this persisted anywhere?**
A: Not in week 1. Restarting the server clears the room. That's intentional — the focus is the rewind mechanic, not storage infrastructure.

**Q: Can I add more rooms?**
A: The routing and Yjs room name are both parameterized. Adding rooms means adding a room picker UI and multiple WebSocket connections, not a re-architecture.

**Q: What's the tech stack?**
A: Vite + React + TypeScript + CodeMirror 6 + Yjs + y-websocket + Tailwind. All open source, no proprietary cloud.

---

## Red Lines (must not happen during demo)

- Both tabs showing the same user name / color
- A "Return to now" button that doesn't do anything
- The editor staying in past mode after clicking "Return to now"
- No markers appearing after typing
- The connection status showing "Offline" or "Connecting" for more than 2 seconds after page load
- TypeScript errors visible in the console
- Any visible `undefined`, `null`, or `NaN` in the UI
