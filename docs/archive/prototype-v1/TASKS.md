# Echo/Rewind — Task Tracker

> **Archived planning notes — Week 1 complete.**
> All phases below were completed as of 2026-07-02. The table reflects the original
> planning state and has not been back-filled; treat it as a record of what was planned,
> not what remains to do. The project is frozen for demo recording.

Status legend: `✅ done` · `🔄 in progress` · `⬜ todo` · `⏸ blocked`

---

## Phase 1 — Foundation

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Scaffold app (Vite + React + TS + Tailwind + deps) | ✅ | |
| 2 | Static `/r/demo` shell | ✅ | AppShell, placeholder components, Amber tokens |
| 3 | Project documentation | ✅ | docs/ folder, all ten files |

## Phase 2 — Visual Lock

| # | Task | Status | Notes |
|---|---|---|---|
| 4 | Amber shell refinement | ⬜ | Audit CSS tokens, remove placeholder copy, lock visuals |

## Phase 3 — Identity & Presence

| # | Task | Status | Notes |
|---|---|---|---|
| 5 | Per-tab session identity | ⬜ | `useSessionIdentity`, sessionStorage, UUID + name + color |
| 6 | Presence data model | ⬜ | `usePresence` hook stub, `PresenceBar` consuming hook |

## Phase 4 — Sync Layer

| # | Task | Status | Notes |
|---|---|---|---|
| 7 | y-websocket server | ⬜ | `server/index.ts`, `npm run server`, `ConnectionStatus` wired |

## Phase 5 — Editor

| # | Task | Status | Notes |
|---|---|---|---|
| 8 | CodeMirror editor | ⬜ | Replace `EditorPlaceholder`, CM6 + Amber theme, no Yjs yet |
| 9 | CodeMirror-Yjs binding | ⬜ | `y-codemirror.next`, shared `Y.Text`, two-tab sync |

## Phase 6 — Collaboration

| # | Task | Status | Notes |
|---|---|---|---|
| 10 | Awareness presence | ⬜ | Broadcast identity via awareness, `usePresence` live |
| 11 | Remote cursors / selections | ⬜ | `yCollab()` extension, colored per-user cursors |
| 12 | Seed starter code | ⬜ | Insert snippet when `Y.Text` is empty after sync |

## Phase 7 — Timeline

| # | Task | Status | Notes |
|---|---|---|---|
| 13 | Snapshot recorder | ⬜ | `src/lib/snapshots.ts`, debounce 1500 ms, `Y.Array` |
| 14 | Timeline markers | ⬜ | `useSnapshots()` in `TimelineScrubber`, remove hardcoded markers |

## Phase 8 — Rewind

| # | Task | Status | Notes |
|---|---|---|---|
| 15 | Past preview mode | ⬜ | `usePastMode`, read-only editor, `--past-bg`, pill |
| 16 | Return to now | ⬜ | Exit past mode, restore live editor, hide pill |

## Phase 9 — Verification

| # | Task | Status | Notes |
|---|---|---|---|
| 17 | Playwright two-tab test | ⬜ | `e2e/two-tab.spec.ts`, sync + presence + scrub + return |

## Phase 10 — Polish

| # | Task | Status | Notes |
|---|---|---|---|
| 18 | README + devlog | ⬜ | Screenshot, quickstart, brief devlog |

---

## Blockers

None currently.

---

## Out of Scope (Week 1)

- Multiple rooms
- Auth
- Database / persistence
- JavaScript execution
- File tree
- Mobile
- Chat / comments
- Command palette
- Historical cursor replay
- Landing page
