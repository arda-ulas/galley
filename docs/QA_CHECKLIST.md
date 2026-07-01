# Echo/Rewind — QA Checklist

Run this checklist before each demo or deployment. All items must pass.

---

## Environment

- [ ] `npm run server` starts without errors on port 1234
- [ ] `npm run dev` starts without errors on port 5173
- [ ] No TypeScript errors: `npx tsc --noEmit` exits 0
- [ ] No Vitest failures: `npm run test` exits 0
- [ ] No Playwright failures: `npm run test:e2e` exits 0

---

## Two-Tab Identity

- [ ] Tab A and Tab B show different user names in the header
- [ ] Tab A and Tab B show different avatar colors
- [ ] Refreshing Tab A gives it a new identity (sessionStorage cleared on refresh? No — sessionStorage persists within the tab until the tab is closed. Refresh reuses existing session identity.)
- [ ] Opening a third tab gives it a third identity
- [ ] Closing and reopening a tab gives it a new identity (new tab = new sessionStorage)

---

## Connection

- [ ] Both tabs show "Synced" within 2 seconds of page load
- [ ] Closing Tab A: Tab B's presence bar loses Tab A's avatar within ~5 seconds
- [ ] Reopening Tab A: Tab B's presence bar gains Tab A's avatar again

---

## Realtime Sync

- [ ] Typing in Tab A appears in Tab B within 200 ms
- [ ] Typing in Tab B appears in Tab A within 200 ms
- [ ] Typing in both tabs simultaneously: both changes appear in both tabs (no data loss)
- [ ] The merged result is the same in both tabs (Yjs convergence)

---

## Remote Cursors

- [ ] Moving cursor in Tab A shows a colored cursor caret in Tab B
- [ ] The caret is labeled with Tab A's user name
- [ ] Making a selection in Tab A shows a colored highlight in Tab B
- [ ] Multiple cursors / selections are visually distinct by color

---

## Starter Code

- [ ] On first load (empty room), the starter TypeScript snippet appears in both tabs
- [ ] Reloading Tab B (after Tab A has typed content) does not reset to the starter — it syncs to the current content

---

## Snapshot Capture

- [ ] After typing and pausing for ~2 seconds, a marker appears on the timeline
- [ ] Multiple pauses produce multiple markers at increasing positions on the track
- [ ] Markers appear in both Tab A and Tab B (shared Y.Array)
- [ ] Hovering a marker shows a tooltip with a relative time ("just now", "1 min ago")

---

## Past Mode Entry

- [ ] Clicking an early timeline marker enters past mode
- [ ] Editor content changes to the snapshot text
- [ ] Editor is read-only (typing has no effect)
- [ ] Editor background shifts to the cool dark past tone (`--past-bg`)
- [ ] "Viewing the past · [N min ago]" pill is visible
- [ ] Remote cursors are hidden or ghosted in past mode
- [ ] The other tab is not affected (still shows live editor in present state)

---

## Return to Now

- [ ] "Return to now" button is always visible in past mode
- [ ] Clicking "Return to now" exits past mode
- [ ] Editor background returns to the warm live tone
- [ ] Editor is editable again
- [ ] Pill disappears
- [ ] Remote cursors reappear
- [ ] Editor content matches the current live Yjs state (including edits made while in past mode)

---

## Visual / Aesthetic

- [ ] No generic Tailwind blue visible anywhere
- [ ] No placeholder copy visible ("static scaffold · markers only", "CodeMirror placeholder")
- [ ] No dead buttons (every visible button has a working action)
- [ ] No fake output panel or run button
- [ ] Amber accent is used only for meaningful highlights (logo, markers, accents)
- [ ] Past mode is visually unmistakable from live mode
- [ ] Framer Motion animations play on first marker appear (not on every re-render)

---

## Performance

- [ ] Page load to interactive: under 2 seconds on localhost
- [ ] Typing latency in the same tab: imperceptible
- [ ] Sync latency between tabs: under 200 ms on localhost
- [ ] No memory leak (presence users clean up on disconnect)

---

## Automated Tests

### Vitest unit tests
- [ ] `useSessionIdentity` — returns consistent identity within a session
- [ ] `snapshots.ts` — snapshot is pushed after debounce fires
- [ ] `usePastMode` — `enterPast` / `exitPast` state transitions

### Playwright e2e
- [ ] Two tabs open `/r/demo`, see different user names in presence bar
- [ ] Type in Tab A, assert text in Tab B within 2 s
- [ ] Pause 2 s, assert at least one marker on timeline
- [ ] Click first marker, assert past mode pill visible
- [ ] Assert editor is read-only in past mode
- [ ] Click "Return to now", assert pill gone, editor editable
