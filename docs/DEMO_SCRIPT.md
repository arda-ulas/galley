# Echo/Rewind — Week 1 Demo Script

## Setup

**Terminal 1 — WebSocket server**
```
npm run server
```

**Terminal 2 — Vite dev server**
```
npm run dev
```

Open `http://127.0.0.1:5173/r/demo` in two browser tabs. Arrange them side by side. Both tabs must show **Live** in the top bar before starting.

**Failure recovery:** If the header shows Connecting instead of Live, make sure `npm run server` is running in a separate terminal on port 1234.

---

## Demo flow

**Step 1.** Show two tabs side by side.
"Two tabs, two distinct identities — each tab gets its own name and color from sessionStorage."

**Step 2.** Point to the presence avatars in each tab's top bar.
"Both tabs see each other's presence in real time via Yjs awareness."

**Step 3.** Type in Tab A.
"Yjs CRDT syncs every keystroke to Tab B over WebSocket."

**Step 4.** Click in Tab B, move the cursor.
"Remote cursor appears in Tab A — y-codemirror.next renders it as a named widget."

**Step 5.** Stop typing, wait about two seconds.
"After 1500ms of idle time, the snapshot recorder commits the current text to a Y.Array."

**Step 6.** Point to the timeline at the bottom of the screen.
"A marker appears on the timeline."

**Step 7.** Type more text immediately (do not pause).
"This text is live — it hasn't been captured in a snapshot yet."

**Step 8.** Click the marker.
"Clicking a marker loads that snapshot into a read-only CodeMirror view."

**Step 9.** Point to the pill that appears above the editor.
"The 'Viewing the past' pill shows when the snapshot was taken."

**Step 10.** Try to type in the editor.
"The editor is read-only — typing does nothing. The live Yjs document is untouched."

**Step 11.** Click somewhere on the empty rail (not on a marker dot).
"Rail click selects the nearest snapshot — no need to hit the dot precisely."

**Step 12.** Press and drag across the rail.
"Drag scrub: pointermove updates the selected snapshot as you move."

**Step 13.** Click Return to now.
"The live collaborative editor is restored — Yjs binding re-established, cursor broadcasting resumes."

**Step 14.** Type in Tab A again.
"Back to live sync. The timeline is the memory of the session."

---

All demo behaviors are verified by 13 Playwright E2E tests.
