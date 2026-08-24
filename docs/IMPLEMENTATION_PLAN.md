# Implementation Plan — Galley v1 (revision 4)

> **This document is the single authoritative execution roadmap for finishing Galley.**
>
> **Revision 4 supersedes revision 3 in full**, which superseded revision 2 in full. Prior revisions
> are recoverable from git history. Where revisions disagree, revision 4 governs. No other planning
> document may sequence work; if one appears to, it is stale and must be corrected or archived (§13).
>
> **Revision 4 exists to resolve a Codex architecture rejection of the revision-3 M5 design.** It
> changes no product scope, no milestone ordering, and no approved mechanism. It corrects six
> blocking architectural findings, all of which have been re-verified against the **pinned packages
> actually installed in this repository** rather than against documentation or memory:
>
> | # | Blocker | Resolution | Section |
> |---|---|---|---|
> | 1 | State-vector-only coverage cannot see deletions | Deletion-aware snapshot watermark | **§6.4** |
> | 2 | `MSG_DURABLE = 3` collides with `messageQueryAwareness` | Type **4**, verified free | **§6.5** |
> | 3 | Split persistence lifecycle ownership | `livePersister` is sole owner | **§6.6** |
> | 4 | COMMIT failure poisons the adapter; retry claim was false | Retryable vs outcome-uncertain | **§6.7** |
> | 5 | UI projection contradicts provider event ordering | `hasCompletedInitialSync` | **§6.8** |
> | 6 | T4 validated hosting, not the architecture | Volume + single-writer + proxy gates | **§5.4** |
>
> **Pinned versions this revision is verified against:** `yjs 13.6.31` · `y-websocket 3.0.0` ·
> `y-protocols 1.0.7` · `y-codemirror.next 0.3.5` · `lib0 0.2.117`. **Any upgrade to `yjs` or
> `y-websocket` invalidates §6.4 and §6.5 and requires re-verification before merge.**
>
> **Addendum — Codex second-pass correction.** After the rewrite above, Codex passed every
> M4.5/M5a architecture contract except one: §6.6.2's task-start capture boundary cleared only
> `dirtyAfterCapture`, never `dirty`, so a persister that had ever seen one edit could never observe
> "no successor needed" and would schedule an unconditional successor after every single commit,
> forever — `flush()` and clean shutdown could never converge. §6.6.2 now clears both flags together
> at the capture boundary; a **quiescence guarantee** and an **AC-quiescence** acceptance criterion
> (§6.12) were added as the regression guard, alongside a required unit test. No other
> already-approved contract in this document changed as part of this correction.
>
> **Companion documents and their standing:**
> - `docs/PRODUCT_BRIEF.md` — canonical **product** contract. Still authoritative. Requires two
>   narrow amendments named in §13.1.
> - `docs/RECONSTRUCTION_ARCHITECTURE.md` — approved **technical design** contract. Still
>   authoritative and **not** superseded; this plan sequences it and cites its §numbers. Revision 4
>   departs from it in exactly four places, each named explicitly in §4.3.
> - `docs/DESIGN_BRIEF.md` — canonical **visual/interaction** contract; governs final UI copy.
> - `docs/RECONSTRUCTION_STATUS.md` — rolling **as-built** record. Updated at each milestone close.
> - `docs/DECISIONS.md` — decision log (D-001…D-018 today; revision 4 adds D-019…D-030, §14).
> - `docs/SQLITE_DECISION.md` — persistence toolchain record. Implemented, unchanged.
> - `docs/ARCHITECTURE.md`, `docs/archive/prototype-v1/` — historical only.
>
> **Baseline:** branch `reconstruction/collab-first`, HEAD `7d1efed`.
> **Checkpoints `week1-demo` (`ca8bb48`) and `prototype-v1` (`4147372`) are never moved.**
>
> **Last updated:** 2026-08-24.

---

## 1. Product target

**Galley** — a local-first collaborative code sheet that starts as a private draft, becomes a live
shared document in one gesture without remounting the editor or losing undo state, exposes truthful
collaboration and save state, and provides bounded read-only version recovery without disrupting the
live session.

The name **Galley is adopted conceptually** as of revision 3. UI copy remains product-neutral
("this sheet"). **The GitHub repository slug stays `echo-rewind`** and `package.json` `"name"` stays
`echo-rewind` until M12; there is no technical reason to rename earlier, and renaming breaks the
existing remote, the draft PR, and every external link.

### 1.1 Hard scope — the v1 build list

Exactly these fourteen items. Nothing else is v1.

| # | Capability | Status | Milestone |
|---|---|---|---|
| 1 | Local private draft at `/` | **shipped** | done |
| 2 | Seamless no-remount Share handoff | **shipped** | done |
| 3 | Durable live collaborative edits | missing | **M5** |
| 4 | Truthful saved / saving / reconnecting / unsynced state | missing | **M5** |
| 5 | Named presence and remote cursors | missing | **M7** |
| 6 | Jump-to-collaborator + Back | missing | **M7** |
| 7 | Bounded Recent versions | missing | **M8** |
| 8 | Local read-only historical preview | missing | **M9** |
| 9 | Back to current without disrupting collaboration | missing | **M9** |
| 10 | Download / export | missing | **M4.5** |
| 11 | Basic bounded retention / eviction | missing | **M10** |
| 12 | Paper UI polish + accessibility | partial | **M4.5 (defect) + M11** |
| 13 | Deployment at a real URL | missing | **M4.5 (spike) + M12** |
| 14 | Case-study-quality README / demo | missing | **M12** |

### 1.2 Hard scope — the exclusion list

Binding for every milestone. A milestone that touches any of these has failed its scope gate.

**Product exclusions:** auth · accounts · permissions · ownership · link revocation · multi-file or
project trees · file tree · code execution · terminal · package installation · chat · comments ·
AI · autocomplete · linting · automatic formatting · restore-from-version · named checkpoints ·
branching · diffs · replay · follow mode · read-only links · Point (v1) · multiple themes (Ink,
Graphite) · theme switcher · presenter mode · classroom-scale collaboration · mobile-first work
beyond not-breaking.

**Engineering exclusions:** multi-node architecture · horizontal scaling · external database ·
Redis · message bus · update-log persistence representation · sophisticated retention tiering ·
premature performance work · speculative refactors of unshipped subsystems · observability
platforms · feature flags · migration frameworks beyond the existing forward-only chain.

---

## 2. Verified current state

Established by direct code inspection at `7d1efed`. Every claim below carries a source. This section
is ground truth, not aspiration — later sections build on it and nothing else.

### 2.1 What is genuinely complete

- **Local draft at `/`.** One unconnected `Y.Doc` + `Y.Text("content")`, one client-owned
  `Awareness`, one external `Y.UndoManager` with `trackedOrigins: new Set()`
  (`src/lib/draftSession.ts:40-49`). No provider, no socket, no remote object before Share —
  proven by `src/App.import.test.tsx` via `installWebSocketSpy()` (`src/test/websocketProbe.ts:14-37`)
  and by `e2e/draft.spec.ts:40`.
- **No-remount Share handoff — independently verified, CONFIRMED.** The same `Y.Doc`, the same
  `Awareness`, and the same `Y.UndoManager` survive the handoff. `App` is stateless
  (`src/App.tsx:18`) and Share uses `history.replaceState` only (`src/lib/route.ts:82`), so
  `DraftPage` never unmounts and the URL change is address-bar-only. `y-websocket@3.0.0` assigns the
  supplied `Awareness` rather than replacing it (`node_modules/y-websocket/src/y-websocket.js:298`).
  The `EditorView` effect keys on session identity alone (`src/components/DraftEditor.tsx:88`).
  Proven by `src/pages/DraftPage.noRemount.test.tsx:123` and, in a real browser, by
  `e2e/share.spec.ts:82-94` (DOM node) and `:130-176` (pre-Share undo group survives).
- **Idempotent atomic create.** `POST /api/sheets` → `handleCreateSheet` (`server/sheets.mjs:184`) →
  `db.createSheet` (`server/persistence/db.mjs:598-672`): receipt lookup → id-collision check →
  three inserts in one `BEGIN IMMEDIATE` transaction. Repeat token replays the **immutable creation
  receipt**, never current state; proven immutable across later writes, metadata tampering, and a
  full restart (`server/persistence/createSheet.test.mjs:210-287`).
- **SQLite persistence for creation.** `node:sqlite` `DatabaseSync`, schema version 2, four tables
  (`schema_version`, `sheets`, `metadata`, `idempotency`). WAL, `synchronous = FULL`,
  `busy_timeout = 5000`, `foreign_keys = ON` — each **set and read back on every open** before
  migrations (`server/persistence/db.mjs:749-787`). Forward-only migrations with a validated
  singleton `schema_version` row and no destructive recovery.
- **Hardened Yjs/WebSocket input boundaries.** Binary-only frames, layered size caps, a strict
  single-root plain-text structural allowlist (`server/yjs.mjs:116-150`), full clone-and-replay sync
  preflight (`server/app.mjs:109-136`), and whole-payload awareness preflight before any apply
  (`server/app.mjs:186-201`). Failures close only the offending socket.
- **Generation-safe session lifecycle.** Generation id + `AbortController` per open, totalized
  outcomes, terminal-wins ordering, latched single-shot cleanup (`src/lib/sheetSession.ts`,
  D-015).
- **Deterministic test infrastructure.** Generation-scoped three-moment create barrier
  (`server/app.mjs:497-660`), durable reset that drains held creates first, one-shot DB and app
  fault seams, real SIGKILL hot-WAL recovery harness, per-test `fs.mkdtemp` file-backed DBs guarded
  by `assertFileBacked` (rejects `:memory:`), a rate-limiter fake clock, a WebSocket construction
  probe, and a DEV-only undo-capture boundary hook (`window.__galleyTest.stopUndoCapturing`).
- **Validation is green.** 273 unit + 345 integration + 12 e2e = **630 tests, 0 failures**;
  `npx tsc --noEmit` exits 0; `npm run build` exits 0 (one non-fatal chunk-size advisory —
  main bundle 753.41 kB / 247.66 kB gzip).

### 2.2 The headline gap — live edits are not durable

**CONFIRMED by independent adversarial verification.** After `POST /api/sheets` commits revision 1,
**no Yjs update received over the WebSocket is ever written back to SQLite.**

- The only server-side `doc.on("update")` listener is a pure peer fan-out
  (`server/app.mjs:334-344`); its body is encoder construction plus `clients.forEach(… client.send)`.
- `Y.applyUpdate(doc, update, ws)` (`server/app.mjs:170`) is the last authoritative statement in the
  inbound path. No DB call follows.
- `ws.on("close")` (`server/app.mjs:868-878`) removes the client and its awareness ids. No flush.
- `disposeRoom` (`server/app.mjs:471-482`) destroys `Awareness` then `Y.Doc` without snapshotting.
- `performCleanup` (`server/app.mjs:950-1017`) runs `dispose-rooms` **before** `close-db`, with no
  flush step anywhere.
- The only `db.*` references in `server/app.mjs` are the import, `db.__test.resetAll()` (`:719`),
  `db.close()` (`:1014`), and passing `db` into the three handlers.

**Consequence:** every production sheet is frozen at `server_revision = 1` and
`metadata_revision = 1`. Kill the server after a live edit and the sheet reverts to the create-time
snapshot. The existing restart test (`server/ws.test.mjs:394-405`) seeds via `db.createSheet` and so
proves only that **creation-time** state survives. `server/shareCoordinator.test.mjs:291` is worded
with deliberate precision: the in-flight edit is proven to reach the **room**, explicitly not the
database.

**The gap is wiring, not implementation from zero.** Both primitives exist, are unit-tested, and
have zero production callers:
- `db.persistState(sheetId, { state, stateVector })` (`server/persistence/db.mjs:858-860` →
  `:564-579`) — update-only, `server_revision + 1`, returns `{ serverRevision, updatedAt }`.
- `writeQueue.enqueue(sheetId, task)` (`server/persistence/writeQueue.mjs:30-49`) — per-sheet FIFO,
  rejection-non-poisoning, already proven to yield strictly increasing revisions 2..N+1 under 12
  concurrent same-sheet writes (`server/persistence/writeQueue.test.mjs:81-118`). Constructed at
  `server/app.mjs:267`, exposed at `:1108`, **never called**.

### 2.3 What is partially built

| Area | State |
|---|---|
| `server_revision` | Real column, correctly incremented — but only by the uncalled `persistState`. `insertSheet` hardcodes `VALUES (?, 1, …)` (`db.mjs:363-367`). Exposed to clients in the create and bootstrap responses, permanently `1`. |
| `metadata` table | Create-only. No update statement, no `tx.updateMetadata`. Title/language are write-once at Share; `metadata_revision` can never advance past 1. |
| `sheets.updated_at` | Written by both writers but **not selected** by `selectSheetRecord` (`db.mjs:336-348`), so `loadValidatedSheet` cannot see it. A de-facto last-activity column no policy reads — **free input for M10**. |
| Client state union | `local \| sharing \| shared \| connecting \| stopped \| failed` (`src/lib/useShareFlow.ts:71-79`). `shared` conflates connected-and-synced with connected-but-unsynced. No `reconnecting`, no `saving`, no `saved`, no dirty tracking, no committed vector. |
| `onStatus` / `onSync` | Plumbed through `createSheetProvider` (`src/lib/providerFactory.ts:101,165-168`) and supplied by **no live caller**. The wire exists; nothing listens. |
| Awareness relay | Works, but echoes every update back to its own author (`server/app.mjs:364-366` omits the origin guard that the doc relay has at `:340`). Harmless, one wasted frame per presence change. |
| Paper visual system | Implemented as inline styles from a frozen `PAPER` object (`src/lib/paperTheme.ts:13-20`). No CSS custom properties, no Tailwind theme config. |

### 2.4 Live defects found during the audit

These are real, shipping, user-visible or operationally significant. Each is assigned below.

| # | Defect | Evidence | Assigned |
|---|---|---|---|
| **DEF-1** | **Amber leaks into the Paper page.** `src/styles/tokens.css` is still imported by `global.css:2` and reaches the rendered page through three rules: `html { background: var(--bg) }`, `html { color: var(--text) }`, and `::selection { color-mix(… var(--accent) 38% …) }`. **Every non-CodeMirror text selection in the live app is amber `#F5A623`**, and `color-scheme: dark` on `:root` forces dark native UI — the `<select>` dropdown, scrollbars, and default focus rings — inside a warm-white sheet. | `src/styles/tokens.css`, `src/styles/global.css:1-26` | **M4.5** |
| **DEF-2** | **Wrong product name in the browser tab.** `index.html:6` is `<title>Echo/Rewind</title>` — the retired product. No `document.title` write, no favicon. | `index.html:6` | **M4.5** |
| **DEF-3** | **Zero `aria-live` regions in the live tree.** Every state transition (`Local draft` → `Sharing…` → `Shared · link copied` → `Connection stopped.`) is silent to screen readers. The repo's only `aria-live` is in the dead `AppShell.tsx:91`. | `src/components/DraftShell.tsx` | **M5** (state) / **M11** (audit) |
| **DEF-4** | **Focus is dropped after Share.** `ShareButton` returns `null` on success (`src/components/ShareControl.tsx:42`), destroying the focused element; focus falls to `<body>`. During `sharing` the button is `disabled` (`:26`), which also drops focus. | `src/components/ShareControl.tsx:26,42` | **M4.5** |
| **DEF-5** | **`getRoom(name)` is exported unguarded.** A get-or-create for an **empty** room by **arbitrary name** that bypasses `loadValidatedSheet` entirely, exported outside `__test` (`server/app.mjs:1112`) and sharing the same `rooms` map as `acquireHydratedRoom`. Calling it with a real sheet id shadows that sheet with an empty doc. Unreachable from the network today. | `server/app.mjs:398-404, 1112` | **M4.5** |
| **DEF-6** | **Rooms are never evicted.** No `rooms.delete` exists anywhere. Every ever-joined sheet permanently retains a `Y.Doc`, an `Awareness`, and a live 3-second `setInterval` (y-protocols' awareness sweep) for the process lifetime. | `server/app.mjs:283,471-489` | **M10** |
| **DEF-7** | **The 512 KiB canonical cap is a one-way brick.** Once a room's merged canonical state crosses `MAX_CANONICAL_STATE_BYTES`, every subsequent update is rejected and the sender's socket closed `4400` — no user-visible explanation, no recovery path. Reachable by fragmented editing: ~50,000 scattered single-character inserts exceed 524,288 canonical bytes at only 50k visible characters. | `server/app.mjs:128` → `server/yjs.mjs:198-200` | **M4.5 (measure)** / **M5 (surface)** |
| **DEF-8** | **No `popstate` listener.** `App` reads `window.location.pathname` at render time only (`src/App.tsx:18`). Browser Back/Forward does not re-resolve the route. | `src/App.tsx:18` | **M4.5** |
| **DEF-9** | **Duplicated limit constants.** `MAX_VISIBLE_CONTENT_CODE_UNITS` and `MAX_CANONICAL_STATE_BYTES` are declared twice with identical values — `server/limits.mjs:41-42` and `server/yjs.mjs:41-42`. Two sources of truth. | both files | **M4.5** |

### 2.5 Measured performance of the inbound path

The sync preflight (`server/app.mjs:109-136`) is **O(document), not O(update)**, per inbound message
per client. Each message costs 2 fresh `Y.Doc` allocations, **3 full `Y.encodeStateAsUpdate` of the
whole room**, 2 `Y.encodeStateVector`, 4 `Y.applyUpdate`, 1 full `Y.decodeUpdate` with a per-struct
loop, 1 full `content.toString()`, and 2 `decodeStateVectorStrict`.

Measured on Node 22.22.2 / darwin, fragmented documents, one 18–20 byte delta:

| Structs | Canonical bytes | Per-message |
|---|---|---|
| 1,000 | 9,884 | **1.67 ms** |
| 5,000 | 49,884 | **4.49 ms** |
| 20,000 | 203,500 | **22.54 ms** |
| 30,000 | 313,500 | **37.36 ms** |
| 45,000 | 478,500 | **53.89 ms** |
| contiguous append, 100k chars | — | **0.2–0.3 ms** |

**The cost tracks struct count, not character count.** Contiguous typing merges into few structs and
is cheap; fragmented editing is not. This work is synchronous on the single Node thread inside
`ws.on('message')`, blocking every other room and every HTTP request. At 45k structs the ceiling is
roughly **18 messages/sec across the whole server**.

### 2.6 What is missing entirely

Durable live persistence · flush on shutdown · room eviction · any custom server→client message type
or acknowledgement (only `MSG_SYNC = 0` and `MSG_AWARENESS = 1` are handled; unknown types are
silently ignored at `server/app.mjs:857`) · WebSocket message rate limiting · connection caps ·
Origin validation on the WS upgrade · server heartbeat / ping-pong / dead-socket reaping (zero
matches for `ping|pong|isAlive|heartbeat` in `server/app.mjs`) · versions table · retention columns ·
idempotency-record GC · Download/export (zero hits for `download|Blob|createObjectURL` in `src/`) ·
Versions surface · jump-to-collaborator · presence UI · any awareness `user` field (so remote carets
would render as y-codemirror.next's defaults: cyan `#30bced`, "Anonymous", serif, hover-only label) ·
CORS/OPTIONS handling · proxy-aware client IP (`server/sheets.mjs:212` uses
`req.socket.remoteAddress`, which collapses to the proxy behind any load balancer) · static file
serving · production start script · any deployment artifact · **any CI configuration**.

### 2.7 Obsolete — the dead island

Eleven source files, unreachable from `src/main.tsx`, verified by import-graph grep:

`src/lib/room.ts` · `src/lib/usePresence.ts` · `src/lib/useProviderStatus.ts` ·
`src/lib/useSessionIdentity.ts` · `src/components/AppShell.tsx` · `src/components/PresenceBar.tsx` ·
`src/components/ConnectionStatus.tsx` · `src/components/ui/button.tsx` ·
`src/components/ui/badge.tsx` · `src/lib/cn.ts` · `src/lib/codeMirrorTheme.ts`

Plus `src/styles/tokens.css`, which is **not** independently dead — it is coupled to `global.css`
(DEF-1) and must be removed as one change, not deleted alone.

> **CLAUDE.md is stale on two points and must be corrected in M4.5:** it lists only four dead files
> (`room.ts` and the three hooks) when eleven are dead, and it instructs "leave `tokens.css` in
> place," which the audit shows now preserves a live visual defect.

Six npm dependencies are used **only** by the dead island and become removable with it:
`framer-motion`, `class-variance-authority`, `lucide-react`, `@radix-ui/react-slot`, `clsx`,
`tailwind-merge`.

Retained-but-uncalled server code is **not** dead and must **not** be deleted: `db.persistState`,
`createWriteQueue`, and `db.getSheet` are the declared seams M5 and M10 consume.

### 2.8 Repository state

- `main` is at `4147372` (= tag `prototype-v1`) and is a **strict ancestor** of the branch —
  **34 commits behind, 0 ahead, cleanly fast-forwardable.** A draft PR already tracks the branch.
- **The GitHub landing page therefore shows the retired timeline-first product to any portfolio
  viewer.** This is the single highest-leverage hygiene item against the stated evaluation criterion.
- No `LICENSE` file; no `"license"` field in `package.json`.
- No `.github/` directory — **nothing runs the 630-test suite automatically.**
- Eight PNG screenshots at repo root, **untracked and unignored** — one `git add .` from being
  committed to the root.
- `.playwright-mcp/` (4.8 MB, 100 files) is ignored only by `.git/info/exclude`, which is
  machine-local and does not travel with a clone.
- `data/` is correctly gitignored; the dev DB holds real content.

---

## 3. Reconciliation — Version B against revision 2

Every revision-2 milestone gets a disposition. Nothing is preserved by inertia.

| Rev-2 milestone | Disposition | Rationale |
|---|---|---|
| M0a baseline characterization | **DELETE** | Complete and consumed. The probes it produced (`src/test/websocketProbe.ts`) shipped. |
| M0b SQLite/toolchain spike | **DELETE** | Complete. `docs/SQLITE_DECISION.md` is committed and implemented. |
| M1 local draft | **DELETE (done)** | Shipped. |
| M1c prototype client cleanup | **MERGE → M4.5** | **Never completed.** Revision 2 scoped it to six files; eleven are dead, plus `tokens.css` coupling and six npm dependencies. Re-scoped and folded into the consolidation milestone rather than resurrected as its own milestone. |
| M2 durable persistence + queue | **DELETE (done)** | Shipped, including the queue primitive. |
| M3 durable create API | **DELETE (done)** | Shipped. |
| M4 complete Share handoff | **DELETE (done)** | Shipped and independently verified. |
| — | **NEW: M4.5** | Consolidation, de-risking spikes, Download, and the live defects of §2.4. Did not exist in revision 2. |
| M5a ack + state machines | **KEEP, absorb M5b** | The core milestone. Renamed **M5**. |
| M5b `Shared · saved` wording | **MERGE → M5** | See §4.3(a). |
| M6 metadata sync **+ Download** | **SPLIT** | Download → **M4.5**. Metadata mutation → **M6 (narrowed)**, and flagged as the one scope decision in §4.4. |
| M7 identity/presence/jump | **KEEP, reordered** | Unchanged in content; now depends on M5 only. |
| M8 server-owned versions | **KEEP** | Unchanged. Its data contract is locked now (§9) so M5 leaves a clean seam. |
| M9 local historical preview | **KEEP** | Unchanged. |
| M10 retention + final expiry | **NARROW** | Reduced to the correctness-bearing subset plus room eviction (DEF-6). See §4.3(c). |
| M11 Paper convergence + a11y | **KEEP, narrowed** | DEF-1/2/4 move earlier to M4.5, so M11 is convergence and audit, not defect repair. |
| M12 soak + documentation | **KEEP, widened** | Absorbs production deployment, the case-study README, and the demo. |

**Net:** 16 revision-2 milestones → **8 remaining milestones** (M4.5, M5, M6, M7, M8, M9, M10, M11,
M12 — nine entries, of which M6 is conditional). Six are deleted as complete, one is merged forward,
one is merged into another, one is split, one is new.

---

## 4. The critical path

### 4.1 Validated sequence

```
M4.5  Consolidation · defects · Download · benchmark · deploy spike · CI · main
  │
  ▼
M5    Durable live persistence + truthful state  ◄── THE architectural milestone
  │
  ├─────────────┬─────────────┐
  ▼             ▼             ▼
M6 (optional) M7 presence   M8 versions
metadata      jump/Back     (server-only)
  │             │             │
  │             └──────┬──────┘
  │                    ▼
  │                  M9 local read-only preview
  │                    │
  │             M10 retention + room eviction  (needs M8)
  │                    │
  └──────────┬─────────┘
             ▼
           M11 Paper convergence + accessibility
             │
             ▼
           M12 deploy · demo · README · case study
```

Explicit edges: `M4.5→M5` · `M5→M6` · `M5→M7` · `M5→M8` · `M7+M8→M9` · `M8→M10` ·
`M6+M9+M10→M11` · `M11→M12`.

**Safe parallelism:** M6, M7, and M8 are mutually independent once M5 lands and touch largely
disjoint modules. M7 is sequenced **before** M8 in practice because it unlocks the primary portfolio
frame and the demo, while M8 is invisible until M9. M10 may run alongside M9.

### 4.2 The six ordering questions, answered

The brief asked whether the assumed sequence is correct. Four items change.

**(a) Does the benchmark belong before M5? — YES, and for a stronger reason than performance.**

Not merely a perf gate. The preflight already computes `Y.encodeStateAsUpdate(probe)` and
`Y.encodeStateVector(probe)` (`server/app.mjs:124-125`) — **most of what the persister needs**, though
revision 4 adds a `Y.snapshot()` capture on top (§6.4). Whether M5 recomputes these or reuses them is
an architectural decision that must be made against measured numbers, not guessed. The measurements
in §2.5 already exist; M4.5 turns them into a committed, re-runnable harness with a stated budget so
M5 can be judged against a baseline. **Revision 4 adds the snapshot-capture cost to the matrix**, so
the deletion-aware watermark is measured before it is built. See §5.3.

**(b) Presence before or after durable state? — AFTER. Keep the revision-2 order.**

Presence has higher demo value and lower architectural coupling, which is a real argument for
pulling it forward. It loses on two grounds. First, the product's *stated* differentiator is
truthful state; shipping named cursors on a substrate where `Shared` is a half-truth compounds
exactly the debt the product claims to have paid. Second, **a reviewer who restarts the server and
loses their sheet has found a fatal bug; a reviewer who does not see cursors has found a missing
feature.** Bugs cost more than gaps. M5 first.

**(c) Does metadata/Download belong where revision 2 put it? — NO. Split them.**

Revision 2 bundled them for convenience. **Download is pure client, has zero dependencies, needs no
server, and its inputs (title, language) already exist.** Bundling it behind the metadata conflict
machine delays a half-day, demo-completing feature behind the second-hardest milestone in the plan.
Download moves to **M4.5**; it completes the demo loop (draft → share → collaborate → download)
before the hard work begins. Metadata mutation stays as narrowed M6 — see §4.4.

**(d) Is retention product correctness or operational hygiene? — BOTH, and it is required.**

The product brief forbids promising permanence and commits to "a clearly disclosed service retention
policy." The design brief (§12) is sharper: stronger wording such as `Older versions are not kept.`
is legal *only if* architecture actually deletes them. So retention is **correctness of disclosure**
the moment any disclosure is made — and it becomes unavoidable at deployment, because a public link
on a free tier with unbounded sheet growth and **rooms that are never evicted (DEF-6)** fills both
disk and memory. M10 is required, and narrowed to the subset that carries that weight.

**(e) Should M5b be part of M5a? — YES. Merge them.**

Revision 2 split them so `Shared · saved` could not ship before metadata coverage existed. But the
correct guard is **the predicate, not a milestone boundary.** Build the complete combined coverage
predicate in M5 — content vector subsumption **and** no pending metadata mutation **and**
`committedMetadataRevision` covering local. Because metadata is immutable post-Share today, the
metadata leg is trivially satisfied and `saved` is legally earnable at M5. When M6 introduces
mutations, the already-built predicate blocks on them with no new gate.

This is strictly safer than the split, on one condition: **M5 must ship a test that injects a
synthetic `pendingMetadataMutation` and asserts `saved` is withheld** — writable at M5 even though
the product cannot yet produce one. That test is a named M5 acceptance criterion (§6.12 AC-12).

**(f) Should deployment happen earlier? — YES, as a spike. This is the largest correction.**

The topology is already deployment-shaped: `wsBase()` derives `ws:`/`wss:` from `window.location`
(`src/lib/topology.ts`), and all paths are relative and same-origin. But **four hard blockers exist
and none is discoverable without deploying**: no static serving (a user hitting
`https://host/{sheetId}` gets a bare 404), no start script, a hardcoded CWD-relative
`PRODUCTION_DB_PATH` that is explicitly *not* env-overridable (`server/app.mjs:239-240`), and a rate
limiter keyed on `req.socket.remoteAddress`, which collapses to a single global 30/min quota behind
any proxy.

The decisive one is the database path. **If the chosen host has no persistent volume, the entire
"durable saved" claim is false in production** — and discovering that at M12, after building M5
through M10 on top of it, would invalidate the milestone the whole roadmap is organized around.
M4.5 therefore includes a bounded deployment spike whose only job is to answer that question. See
§5.4.

### 4.3 Deliberate departures from `RECONSTRUCTION_ARCHITECTURE.md`

Four, each recorded as a decision in §14.

**(0) §8 — the durable acknowledgement carries a deletion-aware snapshot, not a bare
`committedStateVector`.** The architecture's ack payload names `committedStateVector` and its client
logic says "compare `committedStateVector` with the current local state vector." **That comparison is
provably unable to detect deletions.** Verified against the installed `yjs 13.6.31`: deleting six
characters left `Y.encodeStateVector` byte-identical at `016f0b` while canonical state changed, and a
cross-client deletion left it identical at `010106`. A state vector is an insertion-clock summary —
`server/yjs.mjs` says so in its own header comment ("A state vector is a per-client clock summary,
not a content hash"). Revision 4 replaces it with an encoded `Y.Snapshot` carrying both the state
vector and the delete set. Rationale and full contract in §6.4. → **D-027**.

**(a) §6/§8/§17 — `Shared · saved` earned at M5, not gated behind a separate wording milestone.**
The architecture defines the predicate; it does not require a milestone boundary to enforce it.
Revision 3 builds the complete predicate once. Rationale in §4.2(e). → **D-019**.

**(b) §7 — the persister must produce byte-exact canonical output, and this is now a named
constraint rather than an implication.** `loadValidatedSheet` rejects a sheet as `corrupt` unless
`bytesEqual(record.state, canonical.canonicalUpdate)` (`server/loadValidatedSheet.mjs:112-117`). A
live persister that writes anything other than `Y.encodeStateAsUpdate(doc)` from a doc whose
`"content"` root was predeclared as `Y.Text` **bricks every sheet it touches on next join.** The
architecture assumes this; revision 4 states it as a first-class M5 invariant (§6.2 I-7). → **D-020**.

**(c) §11 — retention is narrowed and room eviction is added.** The architecture's full
final-expiry sequence (nine steps, `expiry-pending`, `closing`, lifecycle-lock) is correct but
larger than Version B requires. Revision 3 keeps the race-safety core and the coherent single-
transaction deletion, drops the elaborate policy surface, and **adds idle room eviction (DEF-6)**,
which the architecture does not mention and which is a genuine leak. → **D-021**.

### 4.4 The one open scope decision — M6

**M6 (metadata mutation) is the only milestone not clearly implied by the accepted Version B list.**
Version B does not mention editable title/language. Flagging rather than silently including it.

- **Option A — cut M6.** Title and language are chosen at Share and immutable thereafter. Honest,
  simpler, less code, defensible ("one sheet, one language, named at creation"). Costs: the
  collaborator who joins an `Untitled sheet` can never fix it, and the Download filename is frozen
  at Share time.
- **Option B — narrow M6 (recommended).** Revisioned title/language mutation with stale-base
  rejection and explicit reapply, per architecture §12. Roughly one milestone of work. Justified
  within Version B because item 12 ("Paper UI polish") inherits the design brief, and the design
  brief §7 specifies the title as "editable in place."

**Recommendation: Option B**, because a permanently-unrenameable shared document is a visible product
wart that a portfolio reviewer will notice in the first thirty seconds. The decision is the user's;
the roadmap is correct either way, because the M5 saved-predicate already accounts for the metadata
leg whether or not mutations ever occur.

---

## 5. M4.5 — Consolidation, de-risking, and Download

**Goal:** leave the repository coherent, honest, measured, and known-deployable before the
architectural milestone begins. No architectural change.

**Dependencies:** none. **Safe stop:** yes, at every task boundary.

### 5.1 T1 — Delete the dead island

**Problem.** Eleven unreachable source files and six unused dependencies sit in the tree. Revision 2
scheduled this as M1c and it never ran. Two architectures nominally coexist, and `CLAUDE.md`
under-reports the extent.

**Desired invariant.** Every file under `src/` is reachable from `src/main.tsx` or is a test of
something that is.

**Work.** Delete the eleven files of §2.7. Remove `framer-motion`,
`class-variance-authority`, `lucide-react`, `@radix-ui/react-slot`, `clsx`, `tailwind-merge` from
`package.json`. Update `CLAUDE.md`'s reconstruction-status paragraph to match reality (it currently
names four dead files and instructs preserving `tokens.css`).

**Do not delete:** `db.persistState`, `createWriteQueue`, `db.getSheet` — declared M5/M10 seams.

**Tests.** No new tests; the existing 630 must stay green. Add one grep-gate assertion that no live
module imports the deleted names.

**Acceptance.** Full validation set green; `npm ls` shows no orphaned dependency; import-graph grep
from `main.tsx` reaches every non-test file under `src/`.

### 5.2 T2 — Fix the live defects

**DEF-1 (amber leak).** Coupled change, never partial: delete `src/styles/tokens.css`, drop the
`@import "./tokens.css"` at `global.css:2`, and replace the three surviving usages (`html`
background, `html` color, `::selection`) with `PAPER` values. Remove `color-scheme: dark`. Verify
the `<select>` dropdown, scrollbars, and focus rings render light.

**DEF-2 (tab title).** `index.html` title → a Galley-neutral title. Add a favicon.

**DEF-4 (focus drop).** Share success must move focus to a defined target (the URL field or the
state phrase), not to `<body>`. The `disabled` transition during `sharing` must not drop focus
either — use `aria-disabled` with a no-op handler, or move focus before disabling.

**DEF-5 (`getRoom` export).** Move under `__test` or delete; rewrite `server/app.test.mjs:364-437`
against `acquireHydratedRoom`.

**DEF-8 (`popstate`).** Add a `popstate` listener in `App` so Back/Forward re-resolves the route.

**DEF-9 (duplicated constants).** Collapse `MAX_VISIBLE_CONTENT_CODE_UNITS` and
`MAX_CANONICAL_STATE_BYTES` to `server/limits.mjs`; `server/yjs.mjs` imports them.

**Tests.** Unit: focus lands on the named target after Share; `popstate` re-resolves. Playwright:
selection colour is not amber; native `<select>` renders light.

### 5.3 T3 — Inbound-path benchmark harness

**Problem.** The preflight is O(document) per inbound message and was measured ad hoc (§2.5). M5
adds work to the same path. Without a committed, re-runnable harness and a stated budget, M5 cannot
be judged.

**Desired invariant.** A single command reports per-message preflight cost across a fixed document
matrix, and the numbers are checked into the repository as a baseline.

**Design — do not change the architecture first, measure it.**

*Document matrix (both dimensions, because cost tracks structs, not characters):*

| Case | Visible size | Construction |
|---|---|---|
| A | 2 KB (~60 lines) | contiguous paste — the primary real case |
| B | 10 KB (~300 lines) | contiguous paste |
| C | 50 KB | contiguous paste |
| D | 250 KB | contiguous paste — the `MAX_VISIBLE_CONTENT_CODE_UNITS` ceiling |
| E | 10 KB | **fragmented** — many scattered single-char inserts and deletes |
| F | 50 KB | **fragmented** — approaching the 512 KiB canonical cap |

*Workloads:* single keystroke (~20–40 B) at 10/sec; a 5 KB paste; and the target case —
**two clients at 8 updates/sec each = ~16 inbound messages/sec on the server.**

*Metrics:* p50 / p95 / p99 / max per `preflightSyncUpdate` call, broken down by phase
(`encodeStateAsUpdate(doc)` · `applyUpdate(probe, currentState)` · `applyUpdate(probe, update)` ·
`canonicalizeSubmission`) so the dominant term is identified, not guessed; **event-loop lag** under
the 2-client workload; and heap delta over 10k calls returning to baseline after GC (a probe-doc
leak check).

**Revision 4 additions — the durability capture must be measured before it is built:**
- **`Y.snapshot(doc)` + `Y.encodeSnapshot(...)` cost** per case, since M5 runs it inside the
  synchronous capture block (§6.6) on every persist attempt.
- **`doc.getText("content").toString()` cost** per case — the M8 seam, captured in the same block.
- **Encoded snapshot size** per case. Early measurement on the pinned `yjs 13.6.31`: 8 B for a
  trivial doc, 26 B at 10 scattered deletions, 275 B at 100, 2,976 B at 1,000, and 15,881 B at 5,000
  scattered deletions on a 77,636 B canonical document — roughly **20% of canonical state under
  pathological fragmentation**, implying ≈105 KiB at the 512 KiB canonical cap. That fits inside
  `MAX_WS_FRAME_BYTES` (1 MiB) but is broadcast to every client on every commit, so the benchmark
  must report it and §6.5 bounds it.
- **Client-side `covers()` cost** (§6.4) at each case, since it runs on every ack and every
  dirty→clean re-evaluation in the browser.

*Budget for this product:*
- **p95 ≤ 5 ms** at case B (10 KB contiguous) — the primary case.
- **p95 ≤ 25 ms** at case D (250 KB, the enforced ceiling).
- **Event-loop lag < 50 ms** sustained under the 2-client workload at case C. Rationale: past
  roughly 50 ms, remote cursor motion stops reading as live.
- **Synchronous capture block (state + snapshot + text) ≤ 20 ms** at case D, and **≤ 3 ms** at
  case B. This block holds the event loop and cannot be interrupted, so it is budgeted separately.
- **Encoded snapshot ≤ 128 KiB** at every case. Exceeding it is a redesign trigger, not a warning.

*Redesign triggers:* p95 > 25 ms at case C · event-loop lag > 50 ms in the 2-client workload at
case C · heap not returning to baseline · or M5's persist hook pushing the combined path past the
lag ceiling.

*Redesign directions — documented, built only on trigger:*

1. **Fuse the double canonicalization.** `preflightSyncUpdate` applies the update to a probe, then
   calls `canonicalizeSubmission` on the probe's **re-encoded** state, which internally builds a
   *third* doc and applies again. Validating structurally on the probe directly removes roughly two
   of the ~5 full-document passes **at zero semantic cost**. First move; nearly free.
2. **Persistent probe doc per room.** Keep one probe alongside the live doc in lockstep; apply the
   update to the probe, then to live. Cost becomes O(update). A failed apply leaves the probe
   partially mutated, so the failure path rebuilds it from the live doc — rare, and the fixture at
   `server/ws.test.mjs:855-910` already exercises exactly that case. This is the real fix; it
   changes the cost class.
3. **Amortized size-envelope check.** With (2), the merged-state size check still needs the full
   encode. Maintain a running byte estimate and perform the exact check only above ~80% of the cap.

> **Do not** move the 512 KiB envelope check off the ingress boundary. It is what guarantees the live
> doc never exceeds what is persistable. Deferring it to the persist path would produce an in-memory
> document that can never be written — strictly worse than the current cliff.

**Acceptance.** `node bench/preflight.mjs` (or equivalent) emits the matrix; results are committed to
`docs/BENCHMARK.md` with the date, machine, and Node version; a stated verdict of PASS or a named
redesign trigger.

### 5.4 T4 — Deployment architecture gate *(strengthened in revision 4)*

**Problem.** Four blockers (§4.2(f)). Revision 3 framed this as "does hosting work." That was too
weak: **Galley's durability contract rests on two architectural assumptions the host must satisfy,
and neither is verified by a page loading.** The whole of M5 is unsound if either fails.

The two assumptions:
1. **A genuinely persistent volume** holds the SQLite file *and its WAL/SHM siblings*.
2. **Exactly one application writer process**, at all times, including mid-deployment. The revision
   increment is a read-modify-write and `busy_timeout` is untested under contention (§6.7); the
   entire single-writer design (D-021, §1.2) assumes this. Two overlapping replicas — the default
   behaviour of many platforms during a rolling deploy — would each hold their own in-memory
   `Y.Doc` for the same sheet and write conflicting full-state snapshots over each other.

**Desired invariant.** A staging URL where a sheet created before a redeploy is still readable
after it over `wss:`, served by exactly one writer, with a proxy that cannot be spoofed.

**Work (bounded).**
- Make the production DB path env-configurable via `GALLEY_DB_PATH` (retain the current safety: test
  mode still requires `GALLEY_TEST_DB_PATH`; production falls back to the existing default).
- Serve `dist/` from the Node process with an `index.html` fallback for `/{sheetId}`. Keep `/api`
  and `/ws` matching **ahead of** the static handler.
- Add a `start` script.
- Read `X-Forwarded-For` for the rate limiter's client IP **only** behind explicit trust-proxy
  configuration with a bounded hop count — never unconditionally.
- Configure the platform for **a single replica with a stop-before-start deployment strategy**
  (no rolling/overlapping replicas, no autoscaling).

**Acceptance — every item is a required, separately evidenced check.** A page that loads is not a
pass.

| # | Check | Evidence required |
|---|---|---|
| **A1** | `GALLEY_DB_PATH` resolves **inside the persistent mounted directory** | Print the resolved absolute path at boot; compare against the mount point |
| **A2** | `galley.db`, `galley.db-wal`, **and** `galley.db-shm` all live on that volume | Directory listing from inside the running container after a write |
| **A3** | A real restart/redeploy actually recreates or restarts the process | Boot log timestamp and PID change across the deploy |
| **A4** | A sheet created before the redeploy is readable after it | Create → note id → redeploy → reload `/{id}` → content intact |
| **A5** | **Exactly one application writer at all times, including during deployment** | Platform config shows 1 replica + stop-before-start; observe boot logs across a deploy and confirm **no interval where two instances are live** |
| **A6** | No stale in-memory writer survives a deploy | Old PID confirmed exited **before** the new PID binds |
| **A7** | Direct `/{sheetId}` navigation serves the SPA | Fresh browser, no prior visit, deep link resolves |
| **A8** | `/api` and `/ws` win over the SPA fallback | `GET /api/sheets/{id}` returns JSON, not `index.html`; `/ws/{id}` upgrades, not 200 HTML |
| **A9** | External HTTPS upgrades to WSS | Two real browsers converge over `wss:` on the public URL |
| **A10** | Trusted-proxy parsing is bounded to configured peers/hops | Request from an untrusted peer with `X-Forwarded-For` set → header **ignored** |
| **A11** | A direct `X-Forwarded-For` cannot spoof the client address | Send a forged header; confirm the rate limiter attributes the real peer, not the forged value |

`docs/DEPLOYMENT.md` records the host, mount configuration, env vars, replica/deploy strategy, and
an explicit pass/fail for **each** of A1–A11.

> **STOP condition (§15.1).** If the target host cannot guarantee **both** a persistent volume (A1,
> A2, A4) **and** a single writer including during deployment (A5, A6), T4 fails and M5 must not
> begin. **Do not resolve this by adding multi-node coordination, distributed locking, or a shared
> external database** — those are explicit exclusions (§1.2). Resolve it by choosing a different
> host, or by escalating the product decision.

**Explicitly not in this spike:** custom domain · CDN · autoscaling · monitoring · backups ·
zero-downtime deploys · announcing the URL.

### 5.5 T5 — Download / export

**Problem.** The demo loop is incomplete: a user can draft, share, and collaborate, but cannot get
the text back out.

**Desired invariant.** One click yields a file whose name derives from the sheet's title and whose
extension derives from its language, containing exactly the current live text.

**Architecture.** Pure client. New `src/lib/exportFile.ts`: filename derivation + sanitization +
extension mapping from `LANGUAGE_ALLOWLIST`; a `Blob` + object-URL download. No server involvement,
no persistence. A Download control in the header overflow, per design brief §7.

**Behaviour.** Current live text only. Title-derived, sanitized filename — strip path separators,
control characters, and leading dots. Empty or fully-sanitized-away titles fall back to `untitled`.
Language-derived canonical extension.

**Tests.** Unit: filename derivation; sanitization of path separators, control chars, leading dots,
and an all-symbols title; empty-title fallback; extension per allowlisted language.
Playwright: download produces the expected filename and extension.

### 5.6 T6 — Repository hygiene

- **Fast-forward `main` to `reconstruction/collab-first`.** `main` is a strict ancestor, 34 commits
  behind. Today the repository's landing page shows the retired product to every portfolio viewer.
  Tags preserve the history; nothing is lost. Merge the existing draft PR or fast-forward directly.
  **Continue working on `reconstruction/collab-first`** afterward per the checkpoint policy.
- Add a `LICENSE` (MIT) and a `"license"` field. An unlicensed portfolio repository is legally
  all-rights-reserved — a mild but free-to-fix negative signal.
- **Add CI** — a GitHub Actions workflow running `npm run test`, `npm run test:integration`,
  `npx tsc --noEmit`, `npm run build`, and `npm run test:e2e` on push and PR. Highest
  signal-per-effort item in the plan: 630 tests currently prove nothing to a reader who does not
  clone the repo.
- Add `.playwright-mcp/` to `.gitignore` (it is currently only in machine-local
  `.git/info/exclude`) and delete the directory. Remove the empty `work/` directory and the three
  on-disk `.DS_Store` files.
- Move the eight root PNGs to `docs/screenshots/` and track them deliberately; they are the M4
  milestone evidence and will be superseded at M12.
- Reconcile `README.md` status wording and `CLAUDE.md`'s stale dead-file paragraph.

### 5.7 M4.5 acceptance

Full validation set green (`npm run test` · `npm run test:integration` · `npx tsc --noEmit` ·
`npm run build` · `npm run test:e2e` · `git diff --check`) · `git status` clean · CI green on a real
push · `main` shows Galley · `docs/BENCHMARK.md` committed with a verdict · `docs/DEPLOYMENT.md`
committed with an explicit durability observation · Download works end-to-end · no amber pixel
survives a Playwright selection screenshot.

**Codex checkpoint:** light, except T4 (deployment posture: env handling, static serving, and
trust-proxy configuration) which is **mandatory**.

---
## 6. M5 — Durable live persistence + truthful state

The architectural milestone. Everything above it is preparation; everything below it depends on its
revision model. **Revision 4 rewrites this section in full** in response to the Codex rejection; the
milestone's goal, ordering, and approved mechanisms are unchanged.

### 6.1 Problem

After creation the server's in-memory `Y.Doc` accumulates live edits that are relayed and never
stored (§2.2). The client shows `Shared`, which `RECONSTRUCTION_STATUS.md` carefully defines as
"created durably and adopted" — but a user reads it as *saved*. There is no `Saving…`, no
`Reconnecting…`, no dirty tracking, and no warning on navigating away with unsynced work. The three
truthful states the product brief requires — *shared-and-saved*, *reconnecting*, *unsynced* — are
not representable in the client's state union.

### 6.2 Desired invariants

- **I-1** Every live edit the server accepts becomes durable within a bounded time, or the client is
  told it did not.
- **I-2** The client never displays a durability claim stronger than a committed SQLite transaction
  covers.
- **I-3** A committed write at revision R is never overwritten by a write derived from state older
  than R.
- **I-4** Persistence failure is distinguishable from transport failure, in the mechanism and in
  the wording.
- **I-5** Transport interruption never regresses the durability view — what was committed stays
  committed.
- **I-6** An uncommitted edit is never claimed saved, and navigating away while dirty warns.
- **I-7** Persisted bytes are byte-exact server-canonical output, so a persisted sheet always
  reloads (D-020).
- **I-8** Nothing in the persistence model forecloses the M8 version model (§9).
- **I-9 (new)** The durability watermark is **deletion-aware**: any accepted mutation that changes
  canonical document state — including a deletion that leaves the state vector unchanged —
  invalidates coverage until a later commit covers it.
- **I-10 (new)** Persistence lifecycle state has exactly one owner. No component other than
  `livePersister` may hold dirty, scheduled, queued, in-flight, or retry state.
- **I-11 (new)** A durability outcome that cannot be proven is never reported as success.

### 6.3 Why a state vector is not enough *(Codex blocker 1)*

Revision 3 defined coverage as state-vector subsumption. **This is provably wrong**, verified
against the installed `yjs 13.6.31`:

```
insert "hello world" then delete 6 chars, same client
  text       : "hello world" -> "hello"
  stateVector: 016f0b        -> 016f0b     *** UNCHANGED ***
  canonical  : *** CHANGED ***

client B deletes text authored by client A
  B text     : "abcdef" -> "abef"
  B stateVec : 010106   -> 010106          *** UNCHANGED ***
```

Yjs deletions create **no new structs**. They mark existing items deleted and record the range in
the transaction's DeleteSet. `Y.encodeStateVector` encodes only per-client insertion clocks, so it
cannot observe a deletion at all. `server/yjs.mjs` already states this in its own header comment:
*"A state vector is a per-client clock summary, not a content hash."*

Consequence had revision 3 shipped: a user deletes a block of code, the state vector is unchanged,
the client computes "covered", and the UI displays **`Shared · saved` for a deletion that is not in
the database**. That is precisely the false-saved failure the entire honesty thesis exists to
prevent. Codex was right to block.

### 6.4 The deletion-aware durability watermark *(resolves Codex blocker 1)*

#### 6.4.1 Representation

The watermark is an encoded **`Y.Snapshot`**, which carries both halves of document identity:
`{ sv: Map<clientID, clock>, ds: DeleteSet }`.

All required functions are **public exports of `yjs 13.6.31`** — verified present in the module's 103
exports, no private fields, no internals reach:

| Function | Role |
|---|---|
| `Y.snapshot(doc)` | capture `{sv, ds}` from the authoritative doc |
| `Y.encodeSnapshot(snap)` | serialize for the wire and for comparison stability |
| `Y.decodeSnapshot(bytes)` | client-side deserialize |
| `Y.mergeDeleteSets([a, b])` | non-mutating union — **verified non-mutating** |
| `Y.equalDeleteSets(a, b)` | delete-set equality |

**This is a watermark, not a restore point.** Galley never calls `Y.createDocFromSnapshot`, so the
`gc: false` requirement that normally accompanies Yjs snapshots **does not apply**. Verified: the
server's `gc: true` doc and a `gc: true` client doc produce identical delete sets
(`[[1,[[4,6]]]]` on both sides), and a persist→canonical-re-encode→reload round-trip preserves the
delete set exactly. Recording this explicitly because it is the property that keeps §9's version
model and the 512 KiB canonical envelope intact.

#### 6.4.2 What is captured, and from where

Captured **synchronously from the authoritative server `Y.Doc`**, inside one uninterrupted block
with **no `await` between any two lines** (§6.6.2). Node's single-threaded execution guarantees no
Yjs mutation can interleave:

```js
// ─── SYNCHRONOUS CAPTURE BLOCK — no await, no I/O, no yield ───
const state    = Y.encodeStateAsUpdate(doc);          // canonical bytes (D-020, I-7)
const snap     = Y.snapshot(doc);                     // { sv, ds } — deletion-aware
const coverage = Y.encodeSnapshot(snap);              // portable watermark (I-9)
const text     = doc.getText("content").toString();   // M8 seam (§9) — same read
// ──────────────────────────────────────────────────────────────
```

All four derive from the same document state by construction. `state` and `coverage` describe the
same instant; `text` is the plain-text projection of that same instant. This is the
same-synchronous-read capture Codex approved, extended with `coverage`.

#### 6.4.3 The client predicate

```ts
/** Does the committed watermark cover everything in the client's current document? */
function covers(committed: Y.Snapshot, local: Y.Snapshot): boolean {
  // 1. Insertions: every local clock must be at or below the committed clock.
  for (const [clientId, clock] of local.sv) {
    if ((committed.sv.get(clientId) ?? 0) < clock) return false;
  }
  // 2. Deletions: local's delete set must be a subset of committed's.
  //    ds_l ⊆ ds_c  ⟺  merge(ds_c, ds_l) == ds_c
  return Y.equalDeleteSets(
    Y.mergeDeleteSets([committed.ds, local.ds]),
    committed.ds,
  );
}
```

`local` is `Y.snapshot(localDoc)`, recomputed at evaluation time — never cached across a mutation.

**Subset, not equality — deliberately.** Equality would also be safe, but it would withhold `saved`
whenever the *server* is ahead of this client (another participant's edit was persisted but has not
yet been relayed here). Subset asks the precise question: *is everything I can currently see
durable?* Coverage is monotonic in the right direction because a DeleteSet only ever grows — Yjs has
no un-delete.

#### 6.4.4 Verified behaviour of every required case

Each row was executed against `yjs 13.6.31`:

| Case | Expected | Verified |
|---|---|---|
| **Deletion-only mutation** | uncovered until re-commit | `false` after delete, `true` after re-capture ✅ |
| **Empty delete set** (no deletions anywhere) | covered | `true` ✅ |
| **ACK race** — capture → client deletes → ack handled | **must stay uncovered** | `false` ✅ |
| **Offline deletion, then reconnect** | covered → uncovered offline → covered after reconnect+persist | `true` → `false` → `true` ✅ |
| **Multi-client deletions** (A and B each delete a range) | server covers both clients | `true` for both ✅ |
| **Insertion + deletion combined** | stale ack uncovered, fresh ack covered | `false` / `true` ✅ |
| **GC interaction** (`gc: true` both sides) | delete sets identical | identical ✅ |
| **Canonical re-encode + reload** | delete set preserved | preserved ✅ |

#### 6.4.5 Synchronous invalidation before the next render

`livePersister` on the server and the client's durability reducer both subscribe to
`doc.on("update", …)`. **Verified: a deletion-only transaction does emit an update event** (the
update carries the DeleteSet — that is how deletions reach peers at all), and **the listener runs
synchronously before `delete()` returns**.

Client rule: any `update` event — local or remote — sets `dirty = true` **synchronously inside the
Yjs transaction**, which is strictly before CodeMirror finishes its view update and before React
re-renders in that same event-loop turn. Coverage is therefore never re-evaluated stale, and
`Shared · saved` cannot survive a keystroke or a deletion for even one frame.

Coverage is recomputed (running `covers()`) only when (a) a fresh, non-stale ack arrives, or
(b) `dirty` is set and a re-evaluation is requested — never on every render, since `Y.snapshot()`
is O(document).

#### 6.4.6 Fallback if this contract ever fails

Every function above is a stable public export and every case is verified, so no fallback is
expected. Recording the rule anyway, because it is a durability claim: **if a robust deletion-aware
coverage comparison ever cannot be expressed without private or unstable Yjs internals — for example
after a `yjs` major upgrade removes or changes `mergeDeleteSets` / `equalDeleteSets` — then
`Shared · saved` must not be exposed at all.** Cap the strongest wording at `Shared · connected`,
keep `Saving…` on any dirty state, and choose a different truthful contract before re-enabling
`saved`. **Never fall back to state-vector-only coverage.** → **D-027**.

#### 6.4.7 Persistence semantics (unchanged except where noted)

**When an edit becomes durable.** When the SQLite transaction storing a canonical state blob whose
**snapshot watermark** covers that edit has committed under WAL + `synchronous = FULL`.

**Serialization.** Through `writeQueue.enqueue(sheetId, …)`; one in-flight persist per sheet.
`db.persistState` runs inside `runExclusive` (`BEGIN IMMEDIATE` … `COMMIT`).

**Debounce and coalescing.** Quiet debounce **400 ms**; max-latency cap **2000 ms** so `Saving…`
cannot persist indefinitely under continuous typing. Both configurable, both belong in
`server/limits.mjs`. Worst case ≈2.5 writes/sec/sheet.

**Revision semantics.** `server_revision` is monotonic per sheet; create sets 1; each committed live
persist increments by exactly 1 and writes the **full** canonical encoded state, its state vector,
and (revision 4) its snapshot watermark.

> **Cross-process caveat (documented, not fixed).** The increment is a read-modify-write
> (`SELECT server_revision` → `UPDATE`), not an atomic `SET server_revision = server_revision + 1`.
> It is correct under `BEGIN IMMEDIATE` with the single-threaded synchronous binding and one
> connection per process. It is **not** proven safe across two processes on one file — which is why
> multi-node is an explicit exclusion (§1.2) and why **T4/A5 gates single-writer deployment** (§5.4).

**What the client may call "saved".** `Shared · saved` if and only if:
transport connected **and** `hasCompletedInitialSync` **and** current sync complete **and**
`covers(committedSnapshot, Y.snapshot(localDoc))` **and** no `pendingMetadataMutation` **and**
`committedMetadataRevision >= localMetadataRevision`.

**Storage of the watermark.** The snapshot bytes are held **in memory** on the server alongside the
room (owned by `livePersister`), and broadcast in the ack. They are **not** added to the SQLite
schema — M5 requires no migration. On restart the server rehydrates the doc from the durable blob
and recomputes the watermark with `Y.snapshot(doc)`, which is exact by construction.

**Process death.** Everything since the last committed revision is lost. The client never claimed it
was saved, so no claim was false. **Notably self-healing:** a still-open client retains those edits
in its own `Y.Doc`; reconnect merges them back and the next persist recovers them.

**Multiple clients, one queue.** One authoritative server `Y.Doc` per sheet; all updates merge into
it; one debounced persist covers all of them; one watermark covers every client's clocks and
deletions. There is no per-client write and no per-client ack.

### 6.5 The durability frame *(resolves Codex blocker 2)*

#### 6.5.1 Message number — verified, not assumed

Codex was right that `3` collides. Read from
`node_modules/y-websocket/src/y-websocket.js:20-23` on the pinned `y-websocket 3.0.0`:

```js
export const messageSync            = 0
export const messageQueryAwareness  = 3     // ← revision 3's proposed MSG_DURABLE
export const messageAwareness       = 1
export const messageAuth            = 2
```

`messageHandlers` is populated at indices **0, 1, 2, 3** only. **`MSG_DURABLE = 4`** is free and is
the chosen value. The design is **additive** — no existing y-websocket message type is repurposed or
reinterpreted. → **D-024 (revised)**.

The server already ignores unknown inbound top-level types (`server/app.mjs:857`), so an old client
that does not understand type 4 is unaffected; it simply logs `Unable to compute message` and
continues, and correctly never advances beyond `Shared · connected`.

#### 6.5.2 Binary codec

One frame, two variants, discriminated by a status byte immediately after the type. `lib0/encoding`
and `lib0/decoding` throughout, matching the rest of the wire format.

**Success (`status = 0`):**

| Field | Encoding |
|---|---|
| `MSG_DURABLE` | `writeVarUint(4)` |
| `status` | `writeVarUint(0)` |
| `serverRevision` | `writeVarUint` |
| `committedAt` | `writeVarUint` (epoch ms) |
| `committedMetadataRevision` | `writeVarUint` |
| `coverage` | `writeVarUint8Array` — `Y.encodeSnapshot(snap)` |

**Failure (`status = 1`):** transported, because §6.8 rule 9 must distinguish storage failure from
transport failure and the client cannot infer a storage failure from silence.

| Field | Encoding |
|---|---|
| `MSG_DURABLE` | `writeVarUint(4)` |
| `status` | `writeVarUint(1)` |
| `serverRevision` | `writeVarUint` — last known-good committed revision |
| `fatal` | `writeVarUint` — `0` retryable, `1` outcome-uncertain / poisoned (§6.7) |

No text, no error message, no stack — nothing that could leak internals, consistent with the
existing scrubbed-error discipline.

#### 6.5.3 Provider handler registration

`y-websocket.js:304` does `this.messageHandlers = messageHandlers.slice()` — **a per-instance copy**.
Registration is therefore instance-local and cannot leak into other providers or the module:

```ts
// inside createSheetProvider, on the concrete instance, before connect()
(provider as unknown as { messageHandlers: Array<Handler | undefined> })
  .messageHandlers[MSG_DURABLE] = (_encoder, decoder, _provider, _emitSynced, _type) => {
    // decode, validate, invoke onDurable — and WRITE NOTHING to _encoder
  };
```

**The handler must write nothing to the encoder.** `readMessage` returns the encoder and its caller
sends a reply only when `encoding.length(encoder) > 1` (`y-websocket.js:189-191`). Writing to it
would send a spurious frame the server would reject as an unknown type.

`ProviderLike` deliberately hides the concrete provider (`src/lib/providerFactory.ts:76-86`), so this
narrow cast lives **inside** `createSheetProvider` and the returned handle stays opaque. Callers
receive a new `onDurable` callback option alongside the existing `onStatus` / `onSync` / `onTerminal`.

The same handler is reachable from the BroadcastChannel path (`y-websocket.js:342`), so it must be
origin-agnostic. Galley sets `disableBc: true` (`src/lib/providerFactory.ts:151`), so that path is
inert today, but the handler must not assume a WebSocket origin.

#### 6.5.4 Frame handling rules

| Situation | Rule |
|---|---|
| **Malformed frame** | Any decode failure, unknown `status`, trailing bytes, or a `coverage` payload that `Y.decodeSnapshot` rejects → **ignore the frame entirely**. Do not mutate durability state, do not disconnect, do not throw. Count it on a test-visible counter. |
| **Duplicate frame** | Same `serverRevision` as the last applied → **no-op**. Re-applying is harmless but must not re-emit a state change or restart animations. |
| **Stale / lower revision** | `serverRevision <= lastAppliedRevision` → **discard**. Verified necessary: an older watermark reports `covers → false` where the newer reports `true`, so applying it out of order would flip `Shared · saved` back to `Saving…` and violate I-5. |
| **Higher revision** | Apply: replace `committedSnapshot`, `committedMetadataRevision`, `lastAppliedRevision`; clear any storage-failure state; re-evaluate coverage. |
| **Failure frame** | Apply only if `serverRevision >= lastAppliedRevision`. Set storage-failure state with the `fatal` flag. **Never** clears dirty. |
| **Oversized `coverage`** | Above the §5.3 budget (128 KiB) → ignore the frame and count it; the client stays conservatively uncovered. |

> **Non-blocking note (informational, not required for M5 acceptance).** The duplicate-frame rule
> above keys on `serverRevision` alone, which is sufficient for M5's guarantees (§6.12) because a
> revision is only ever reused by a literal re-send of the same frame. A build-time refinement worth
> considering — not required to pass any AC — is keying dedup on the *effective frame state*
> (revision + status + coverage digest) rather than revision alone, so a hypothetical future retry
> path that reuses a revision with different content is not treated as a no-op by accident. This does
> not change any M5 test or acceptance criterion; it is a defensive-coding note for the
> implementer.
>
> **Non-blocking note (informational).** On a fresh join (not a reconnect), the server should include
> the **current committed durability watermark** in its initial payload so a quietly-joining client
> — one that makes no edits — can settle straight to `Shared · saved` once `hasCompletedInitialSync`
> and `syncComplete` are both true, rather than sitting at `Shared · connected`/row-12 `Saving…`
> until the next unrelated commit happens to broadcast a frame. This is a UX quality-of-life
> refinement, not a correctness requirement: §6.8.3 row 12 already handles "connected, synced, no
> watermark yet" safely as `Saving…`, which is truthful, just conservative. Not an M5 acceptance
> criterion; may be folded into the initial bootstrap response at implementation time if it fits
> without expanding the milestone.

### 6.6 `livePersister` — sole lifecycle owner *(resolves Codex blocker 3)*

Revision 3 put `dirty` and `lastPersistedRevision` on the room record while the debounce lived in a
separate module. **That split is removed.** The room record keeps exactly what it has today —
`{ doc, awareness, clients }` — plus an **opaque handle** to its persister. It stores no persistence
state of its own.

#### 6.6.1 Exclusive ownership

`livePersister` exclusively owns, per sheet: the debounce timer · `dirty` · `scheduled` · `queued` ·
`inFlight` · retry state and backoff · `dirtyAfterCapture` · the committed watermark and
`lastCommittedRevision` · storage-failure state · the set of outstanding persistence tasks · and
`flush()`. **No other module reads or writes any of these.** `server/app.mjs` may only call
`persister.noteUpdate()`, `persister.flush()`, and `persister.dispose()`.

#### 6.6.2 One precise lifecycle

States: `idle → dirty → scheduled → queued → capturing → inFlight → (committed | failed)`.

> **Correction (post-Codex-pass).** An earlier draft of this section cleared only
> `dirtyAfterCapture` at task start and never cleared `dirty` itself. Because settlement's successor
> check was `dirtyAfterCapture || dirty`, `dirty` — once set by the first `noteUpdate()` — stayed
> `true` forever: every commit would see `dirty === true`, schedule an unconditional successor, that
> successor would commit and see `dirty === true` again, and so on. The persister could never reach
> `idle`, `flush()` could never converge, and clean shutdown could hang. **Both flags are now
> cleared together at the task-start capture boundary.**

1. **`noteUpdate()`** — called from the room's existing `doc.on("update")` listener beside the
   fan-out. Sets `dirty = true`. If the persister is `idle`, arms the quiet debounce (400 ms) and,
   if not already running, the max-latency cap (2000 ms), then transitions to `scheduled`. If a task
   is already `queued`, `capturing`, or `inFlight` — i.e. it has already passed its own capture
   boundary and cannot see this mutation — **additionally** sets `dirtyAfterCapture = true`, so the
   mutation is guaranteed a successor without arming a second, redundant debounce. **Never persists
   inline.**
2. **Timer fires** → `queued`: `writeQueue.enqueue(sheetId, task)`. The debounce handle is cleared
   here so a subsequent update (once this task is past its capture boundary) arms a fresh cycle via
   rule 1.
3. **Task begins** → `capturing`. **At this exact boundary, immediately before capturing, both
   `dirty` and `dirtyAfterCapture` are synchronously cleared to establish the captured state as the
   new baseline:**

   ```js
   dirtyAfterCapture = false;
   dirty = false;
   const captured = captureCurrentState(doc); // §6.4.2 synchronous block
   ```

   Because there is no `await` between the clear and the capture, and Node is single-threaded, no
   Yjs mutation can land in the gap — the two statements and the capture are effectively one atomic
   step. **Both flags start this task's lifetime at `false`; the captured state now legitimately
   claims everything that was true of the document up to and including this instant.**
4. **`inFlight`** — the first `await` occurs only *after* the capture. Any Yjs mutation accepted from
   here on — during `capturing`'s remaining synchronous tail, or during `inFlight` — is, by
   definition, **not** covered by `captured`, and must not be silently absorbed by it. It goes
   through `noteUpdate()` (rule 1), which — because the persister is no longer `idle` — sets
   `dirtyAfterCapture = true` (and `dirty = true`, harmlessly, since nothing reads `dirty` again
   until the *next* task's own capture boundary clears it).
5. **Settlement:**
   - **Committed** → store the watermark, bump `lastCommittedRevision`, clear storage-failure,
     broadcast the success frame, invoke the §9 revision hook, then:
     - **if `dirtyAfterCapture` (equivalently `dirty`, since rule 4 sets both together) is `true`**,
       immediately schedule exactly one successor attempt;
     - **if neither flag is set**, transition to `idle`. **This is the terminating case the earlier
       draft could never reach.**
   - **Failed** → classify per §6.7. Broadcast the failure frame. Retryable → schedule a successor
     with backoff (this successor attempt will itself re-capture the current document at its own
     boundary, so it is correct regardless of the flags' state). Outcome-uncertain → enter terminal
     storage-failure; schedule nothing.

> **Successor guarantee (I-1), preserved exactly.** Every accepted mutation after a capture and
> before settlement still guarantees a successor attempt, because `dirtyAfterCapture` is cleared
> *immediately before* the capture (rule 3) and set by any subsequent update (rule 4). The
> correction changes only what happens when **no** such mutation occurs: settlement now correctly
> observes both flags `false` and goes `idle`, instead of incorrectly observing a `dirty` flag that
> was set once, at the very first edit, and never cleared.

> **Quiescence guarantee (new).** If exactly one document mutation occurs, its debounce fires, its
> task captures the resulting state, and no further mutation occurs before that task commits, then
> settlement observes `dirtyAfterCapture === false` **and** `dirty === false` (both cleared at this
> task's own capture boundary in rule 3, and nothing has run `noteUpdate()` since) and the persister
> reaches `idle` after exactly one commit. No successor is scheduled. `flush()` called any time
> after that commit resolves immediately with `covered: true`.

> **Race preserved exactly (P1/U2).** (1) P1 reaches its capture boundary, clears both flags, and
> captures S1. (2) U2 is accepted after that boundary — during P1's remaining synchronous tail or
> while P1 is `inFlight` — so rule 4 sets `dirtyAfterCapture = true`. (3) P1 commits S1. (4)
> Settlement sees `dirtyAfterCapture === true` and schedules exactly one successor, P2. (5) P2
> reaches *its own* capture boundary, clears both flags, and captures S2 — which includes U2,
> because U2 already landed in the live `Y.Doc` before P2's capture ran. (6) P2 commits S2. (7) No
> further edits occur, so settlement now sees both flags `false` and the persister reaches `idle`.
> (8) `flush()` returns `covered: true`.

#### 6.6.3 `flush()` — exact contract

```
flush(): Promise<{ covered: boolean, reason?: "storage-fatal" | "storage-retry-exhausted" }>
```

1. **Cancel** the pending debounce and max-latency timers.
2. **If the latest state is not covered**, run the §6.4.2 synchronous capture immediately.
3. **Enqueue** the resulting persistence task.
4. **Await all outstanding tasks** for this sheet — including any already `inFlight` from before the
   flush, and any successor scheduled by rule 5 while the flush was running. Loop until the queue for
   this sheet is empty *and* the latest state is covered, or a terminal failure occurs.
5. **Return `{ covered: true }` only when the latest state is durably covered.** Any other outcome
   returns `covered: false` with a reason.

> **A failed flush must not destroy the `Y.Doc`.** The in-memory doc is at that moment the **only**
> copy of the uncovered edits. `disposeRoom` must be called only after `flush()` returns
> `covered: true`, or after an explicit, logged decision to abandon (shutdown deadline reached).
> Abandoning is logged at error level with the sheet id and the uncovered revision. Connected clients
> still hold those edits in their own `Y.Doc`s and will re-sync them on reconnect (§6.4.7).

#### 6.6.4 Shutdown ordering

`performCleanup` (`server/app.mjs:950-1017`) gains **two** steps before the existing
`dispose-rooms`:

```
1. settle-create-hold        (existing)
2. httpServer.close          (existing — stop accepting new work)
3. terminate-clients         (existing)
4. close-wss                 (existing)
5. flush-persisters   ◄── NEW: await flush() for every room, bounded by a deadline
6. drain-write-queue  ◄── NEW: await the write queue empty for every sheet
7. dispose-rooms             (existing — now provably safe)
8. close-http                (existing)
9. clear-rate-limiter        (existing)
10. close-db                 (existing — LAST, unchanged)
```

Steps 3–4 precede the flush deliberately: no new updates can arrive once clients are gone, so the
flush converges instead of chasing a moving document. `POST /__test/reset` gains the same 5–6
ordering before it disposes rooms and clears rows, extending D-016.

#### 6.6.5 The `persistState` NULL footgun

`tx.persistState` passes `payload.state ?? null` and `payload.stateVector ?? null` into an
unconditional `SET state = ?, state_vector = ?` (`db.mjs:324-328, 571-577`). Calling it without a
payload **NULLs both blobs while still bumping the revision**, and `loadValidatedSheet` treats a null
`state` as `corrupt`. `livePersister` always supplies both, and M5 adds an assertion in
`persistState` that rejects a null/absent `state` or `stateVector` outright.

### 6.7 SQLite failure semantics *(resolves Codex blocker 4)*

Revision 3 claimed a persistence failure could be recovered by "a later success." **Verified false
for COMMIT failure.** From `server/persistence/db.mjs:681-740`:

| Fault | Adapter state after | Recoverable in-process? |
|---|---|---|
| **BEGIN fails** | stays `idle` — *"state flips to active only after BEGIN succeeds"* | ✅ **yes** |
| **Statement fails + ROLLBACK succeeds** | `state = "idle"` — *"clean rollback → recoverable"* | ✅ **yes** |
| **ROLLBACK fails** | `state = "poisoned"` | ❌ **no** |
| **COMMIT fails** | `state = "poisoned"` — *"clean state is uncertain → poison"* | ❌ **no** |

Once poisoned, `assertUsable()` throws *"adapter is poisoned by a prior unrecoverable failure; it can
only be closed"* on **every** subsequent operation. No later write can succeed in that process.

#### 6.7.1 Two classes, with rules

**Retryable (pre-commit, outcome known to be "did not commit"):**
- BEGIN failure before transaction ownership.
- Statement/write failure followed by a **confirmed successful** rollback.
- Queue-level failures that never reached the adapter.

→ Broadcast failure frame with `fatal = 0`. Retry with backoff. A later success **does** clear the
storage-failure state. Retry is inherently safe because each attempt writes the full current state.

**Storage-fatal / outcome-uncertain:**
- COMMIT failure — the transaction may or may not have durably committed. **The outcome cannot be
  proven from inside the process.**
- ROLLBACK failure.
- Any state where commit outcome cannot be established.
- Any operation attempted against an already-poisoned adapter.

→ Broadcast failure frame with `fatal = 1`. **Schedule no retry.** Enter terminal storage-failure for
the process.

#### 6.7.2 Binding rules

- **An outcome-uncertain failure must never emit a durability success frame** (I-11). It is not
  "probably saved."
- **A poisoned adapter can never emit a success ack**, because it can never commit again. Any code
  path that would emit one after poisoning is a defect.
- **Recovery requires process restart.** The server does not attempt in-process repair, does not
  reopen the database, and does not swap adapters — that is out of scope and would risk two handles
  on one file (§1.2).
- **Dirty state remains conservatively unsaved.** The client keeps showing storage-failure wording
  and keeps the navigation warning armed. The editor stays editable; clients retain their edits.
- On the next process start the room rehydrates from the last **provably** committed blob. If the
  uncertain COMMIT did land, its state is present and harmless; if it did not, connected clients
  re-sync their copies. Either way no false claim was made.

#### 6.7.3 Test-seam correction

Revision 3's retry-recovery test used `db.__test.failNextCommit()`, which **poisons** — so it could
never have demonstrated recovery. Corrected:

- **Retry-recovery** uses `db.__test.failNextBegin()` (verified non-poisoning) or
  `failCreateSheetAfter(step)`-style statement faults with clean rollback.
- **`failNextCommit()` and `failNextRollback()` are used only to test the poisoned/terminal path** —
  asserting no success ack ever follows, no retry is scheduled, and the UI holds storage-failure.

> **Non-blocking note (informational, not required for M5 acceptance).** §6.7.1's two-class rule
> ("retryable" vs "outcome-uncertain") is stated in terms of *which adapter operation failed*, which
> the current `db.__test.*` fault seam already models directly (`failNextBegin` vs `failNextCommit`/
> `failNextRollback`). At implementation time, prefer surfacing this as a **typed/structured
> disposition** on the thrown error or return value (e.g. an explicit `{ retryable: boolean }` field
> or a dedicated `OutcomeUncertainError` class) rather than having `livePersister` infer the class by
> inspecting an error message string — string-matching is brittle across SQLite driver versions and
> is not how the rest of this codebase classifies errors (`TransactionRollbackError`,
> `SheetIdCollisionError`, `MissingSheetError`, and `PersistenceIntegrityError` are all typed today).
> This does not change §6.7's classification rule itself, only how the implementer should express it
> in code; it is not a new acceptance criterion.

### 6.8 Client state projection *(resolves Codex blocker 5)*

#### 6.8.1 Why revision 3 was wrong

Verified in `y-websocket 3.0.0`, `closeWebsocketConnection`: on losing a **connected** socket the
provider does `provider.synced = false` → emits `status: 'disconnected'` → schedules `setupWS` with
exponential backoff. `src/lib/providerFactory.ts:18` already documents this ordering.

Revision 3's rule *"transport = connecting **or** sync ≠ complete → `Connecting…`"* therefore fires on
**every reconnect**, because a reconnect always sets `synced = false` and passes through
`connecting`. The user would see `Connecting…` — the first-time-join phrase — instead of
`Reconnecting…`, and the unsaved-risk warning would never appear.

#### 6.8.2 Tracked facts

The reducer tracks five facts, not a linear status:

| Fact | Source |
|---|---|
| `hasCompletedInitialSync` | latched **true** on the first `sync(true)`; **never reset** for the life of the session |
| `transportConnected` | `onStatus` (`connected` / `connecting` / `disconnected`) |
| `syncComplete` | current `onSync` value — goes false on every drop |
| `covered` | `covers(committedSnapshot, Y.snapshot(localDoc))` (§6.4.3) |
| `storageFailure` | `null` \| `{ fatal: false }` \| `{ fatal: true }` from the failure frame |

Plus the existing session phase (`local` / `sharing` / `failed` / `adopted`) and terminal close cause.

`hasCompletedInitialSync` is the fact that separates "still arriving for the first time" from
"was here, dropped, coming back."

#### 6.8.3 Complete priority table — no fallthrough

Evaluated top to bottom; **the first match wins**. The table is total: every reachable combination
matches a row at or above row 12, and no uncovered state can reach row 12.

| # | Condition | Phrase |
|---|---|---|
| 1 | phase = `local` | `Local draft — not uploaded` |
| 2 | phase = `sharing` | `Sharing…` |
| 3 | phase = `failed` | `Couldn't share — your draft is safe here` |
| 4 | sheet lookup invalid / expired | `This link is unavailable` |
| 5 | transport terminal (4400/4404/4409/4500) | terminal wording by cause |
| 6 | `storageFailure.fatal === true` | `Not saved — storage failed` |
| 7 | `!hasCompletedInitialSync` | `Connecting…` |
| 8 | `!transportConnected` **and** `!covered` | `Reconnecting — recent edits not yet saved` |
| 9 | `!transportConnected` **and** `covered` | `Reconnecting…` |
| 10 | `storageFailure !== null` *(retryable, transport up)* | `Not saved — storage failed` |
| 11 | `transportConnected` **and** `!syncComplete` | `Reconnecting…` |
| 12 | `transportConnected` **and** `syncComplete` **and** `!covered` | `Saving…` |
| 13 | `transportConnected` **and** `syncComplete` **and** `covered` **and** metadata covered | `Shared · saved` |
| 14 | `transportConnected` **and** `syncComplete` **and** `covered` **and** metadata pending | `Saving…` |

**Why the order is what it is:**

- **Row 6 above row 8.** A *fatal* storage failure outranks reconnect. It cannot be resolved by
  reconnecting and the user must not be told to wait for something that will never happen. This
  directly implements *"storage failure must not disappear merely because transport is
  reconnecting."*
- **Row 7 uses `hasCompletedInitialSync`, not `syncComplete`.** `Connecting…` is reachable **only
  before the first successful sync**, so it can never be shown for a reconnect.
- **Rows 8/9 split on coverage,** satisfying the design brief's ⚠ requirement that the claim about
  which edits are at risk match real buffering behaviour. `!covered` includes *every* uncovered
  substate — debounced, scheduled, queued, capturing, in-flight, and retryable-failed — because
  `covered` is computed from the watermark, not from the persister's phase.
- **Row 10 below 8/9** for the *retryable* case only: while the transport is down, reconnect wording
  is more actionable, and the retry will be re-attempted anyway. The fatal case is already handled at
  row 6.
- **Row 11 is `Reconnecting…`, not `Connecting…`** — reaching it requires `hasCompletedInitialSync`,
  so this is a re-sync after a drop.
- **Row 13 is the only path to `Shared · saved`,** and it requires `covered` — which is the
  deletion-aware predicate. **Row 12 catches every uncovered-but-connected state**, so there is no
  fallthrough that could label uncovered state `Shared · connected`.

> **`Shared · connected` no longer appears in this table.** With a deletion-aware watermark, a
> connected and fully synced client is either covered (row 13) or uncovered (row 12). The revision-3
> "clean baseline not yet durably covered" gap does not exist, because the create commit at revision
> 1 already establishes a covering watermark. The phrase is retained in §8 only for the interval
> before the first ack arrives on a **joining** client, which row 11 covers as `Reconnecting…`; if
> build review finds a real state that needs it, it is added as an explicit row, never as a
> fallthrough.

Exact final copy is governed by `DESIGN_BRIEF.md` §10. This table defines which claims are
technically legal, not the final strings.

#### 6.8.4 Navigation warning

`beforeunload` is armed exactly when `!covered`, regardless of transport or persister phase — the
same predicate that drives rows 8 and 12, so the warning can never disagree with the header.

### 6.9 Crash and fault matrix

Every row states durable state, server knowledge, client knowledge, the legal UI, and recovery. This
is the completeness check for §6.8: no row may produce `Shared · saved`.

| # | Point of failure | Durable state | Server knows | Client knows | Legal UI | Recovery |
|---|---|---|---|---|---|---|
| 1 | **Update never reaches server** (send fails / socket dead) | last commit | nothing of this edit | edit is local; no ack advances | `Reconnecting — recent edits not yet saved` (8) | reconnect → sync → persist |
| 2 | **Validation/preflight rejects it** | last commit | rejected; socket closed 4400 | terminal close code | terminal wording (5) | reload; edit was never accepted |
| 3 | **Authoritative apply succeeds, crash before capture** | last commit | had it in memory; lost | uncovered | `Saving…` (12), then (8) on drop | client re-syncs its copy on reconnect |
| 4 | **Captured/queued, crash before commit** | last commit | lost | uncovered | `Saving…` (12) → (8) | successor attempt after restart, from the client's re-synced state |
| 5 | **SQLite transaction in progress, process killed** | last commit (WAL guarantees atomicity — no torn write) | lost | uncovered | `Saving…` (12) → (8) | hot-WAL recovery on reopen; client re-syncs |
| 6 | **Committed, crash before ack is sent** | **new commit** | committed | still uncovered — it never saw the ack | `Saving…` (12) → (8) | **conservatively pessimistic, never false**; next ack after reconnect covers it |
| 7 | **Ack received** | new commit | committed | covered | `Shared · saved` (13) | — |
| 8 | **Retryable persistence failure** (BEGIN fail / clean rollback) | last commit | failed, outcome known | `fatal = 0` frame | `Not saved — storage failed` (10), or (8) if also disconnected | automatic retry with backoff; success clears it |
| 9 | **Outcome-uncertain / poisoned** (COMMIT or ROLLBACK failure) | **unknown** | cannot prove either way | `fatal = 1` frame | `Not saved — storage failed` (6) — outranks reconnect | **process restart required**; no in-process retry |
| 10a | **Reconnect while covered** | last commit | unchanged | covered, transport down | `Reconnecting…` (9) | resync; nothing to persist |
| 10b | **Reconnect while uncovered** | last commit | unchanged | uncovered | `Reconnecting — recent edits not yet saved` (8) | resync pushes edits → persist → ack |
| 10c | **Reconnect after a fatal storage failure** | unknown | poisoned | `fatal = 1` sticky | `Not saved — storage failed` (6) | restart; reconnect alone does **not** clear it |
| 10d | **Reconnect after server restart** | last commit | rehydrated from blob; watermark recomputed | uncovered until first ack | (8) → (12) → (13) | client's newer state merges in; next persist covers it |

**Row 6 is the load-bearing one.** A commit that lands without its ack leaves the client
*pessimistic* — it says `Saving…` for state that is in fact durable. That is the correct direction of
error and the only one this design permits. There is no row in which the client claims `saved` for
state that is not durable.

### 6.10 Tests

*No arbitrary sleeps in any causal path.* The determinism mechanism is a **test-only persist
barrier**, an exact analogue of the proven create barrier (`server/app.mjs:497-660`):
`POST /__test/hold-persist` → `holdId`; `GET /__test/hold-persist/reached?holdId=…`;
`POST /__test/release-persist?holdId=…`. Generation-scoped, 409 on re-arm while entered, inert on a
stale id, and **settled by reset and shutdown before storage is cleared or closed** — extending
D-016 and D-017 rather than inventing a new pattern.

**Unit — coverage predicate (`covers`).** Deletion-only mutation uncovered until re-commit ·
insertion-only · **insertion + deletion combined** · empty delete set · multi-client deletions ·
snapshot encode/decode round-trip stability · `mergeDeleteSets` non-mutation of its inputs ·
coverage under `gc: true` on both sides · **a state-vector-only comparison would have returned
`true` for the deletion-only case** (a regression guard that documents *why* the snapshot exists).

**Unit — durability frame.** Success codec round-trip · failure codec round-trip with both `fatal`
values · **stale/lower `serverRevision` ignored** · **duplicate frame is a no-op** · **malformed
frame ignored without state mutation or disconnect** (truncated, unknown status, trailing bytes,
`coverage` that fails `Y.decodeSnapshot`) · oversized `coverage` ignored · **the handler writes
nothing to the encoder** (asserting `encoding.length(encoder) <= 1`, so no spurious reply).

**Unit — projection.** The full §6.8.3 table, every row · `hasCompletedInitialSync` latches on first
sync and never resets · **a reconnect after first sync never yields `Connecting…`** · fatal storage
failure outranks reconnect · **no combination reaches `Shared · saved` while uncovered** ·
`beforeunload` armed exactly when `!covered` · a synthetic `pendingMetadataMutation` withholds
`saved` (forward-compat for M6).

**Unit — persister lifecycle.** Quiet debounce fires once · max-latency cap fires under continuous
updates · **dirty-after-capture schedules a successor attempt** · **flush while queued** awaits the
queued task · **flush while in-flight** awaits it and any successor · **flush after a recoverable
failure** retries and returns `covered: true` · flush returns `covered: false` on terminal failure ·
`persistState` rejects a null/absent `state` or `stateVector`. Plus the two scenarios below, which
are the regression guards for the task-start clearing defect corrected in §6.6.2:

- **Quiescence: one update -> one commit -> idle.** (1) Start with the persister `idle`. (2) Accept
  one document update via `noteUpdate()`. (3) Advance the fake clock past the quiet debounce. (4)
  Assert exactly one persistence task is captured and enqueued. (5) Let the task succeed. (6) Assert
  no further edit occurs. (7) Assert **exactly one** successful commit occurred (the write-queue
  mock/spy call count is 1). (8) **Assert no successor task is scheduled** -- the persister's phase
  is `idle`, not `scheduled`/`queued`/`capturing`/`inFlight`. (9) Assert the write queue for this
  sheet has drained. (10) Call `flush()` and assert it resolves `{ covered: true }` **without
  enqueuing any additional task**. This test fails under the pre-fix behaviour (`dirty` never
  cleared) because step 8 would observe a scheduled successor and the persister would never settle.
- **Update after capture -> exactly one successor.** (1) P1 reaches its capture boundary (assert via
  a test hook that both `dirty` and `dirtyAfterCapture` read `false` at this instant). (2) While P1
  is `queued`/`inFlight`, accept a second update U2. (3) Let P1 commit. (4) Assert **exactly one**
  successor (P2) is scheduled -- not zero, not two. (5) Assert P2's capture includes U2's content.
  (6) Let P2 commit. (7) Assert no further edits occur. (8) Assert the persister reaches `idle`
  after P2's commit (not a third, spurious successor). (9) Call `flush()` and assert it resolves
  `{ covered: true }`.

**Integration (vitest node, file-backed SQLite).**
- Edit over WS → await ack → `server_revision` incremented **and** the stored blob decodes to the
  expected text.
- **Restart durability — the headline test.** Create → connect → edit → await ack → shutdown →
  restart on the same DB file → reconnect → content present.
- **Deletion-only durability.** Create → connect → **delete** text → await ack → restart → the
  deletion survives. *This is the test revision 3 could not have passed.*
- Byte-exactness (I-7): after a live persist, `loadValidatedSheet` returns `ok`, not `corrupt`.
- Revision monotonicity across ≥100 rapid two-client edits.
- Stale-write ordering: a delayed persist cannot regress a newer committed revision.
- **Retryable failure recovery using `failNextBegin()`** — failure frame with `fatal = 0`, socket
  stays open, editor stays editable, **a later success clears it**.
- **Poisoned-adapter behaviour using `failNextCommit()`** — failure frame with `fatal = 1`, **no
  success ack ever follows**, no retry is scheduled, and every subsequent write attempt throws
  `assertUsable`.
- **Shutdown ordering:** flush and queue-drain complete before `dispose-rooms`; a pending debounced
  edit is durable after graceful shutdown.
- **A failed flush does not destroy the `Y.Doc`** before the abandon decision is logged.
- The ack reaches a **non-writing** client.
- Extend the SIGKILL harness (`server/persistence/recovery.test.mjs`) with a fixture mode that
  performs a **live-edit flush** before signalling, proving hot-WAL recovery of a live edit rather
  than only of a create.

**E2E (Playwright).** Type → `Saving…` → settles to `Shared · saved` · **delete text → `Saving…` →
`Shared · saved`, and the deletion survives reload** · `saved` never appears while a persist is held
at the barrier · **flush-while-queued: hold a persist, edit again, release, and the final state is
covered** · kill and restart the collaboration server → `Reconnecting…` (**never** `Connecting…`) →
converges → `Shared · saved` · injected persistence failure → storage wording distinct from reconnect
wording, editor still editable · **fatal storage failure stays visible while the transport
reconnects** · navigate away while dirty → the warning fires · reload after edits → content present.

**Deployment (M4.5 T4, re-asserted here because M5 depends on them).**
- **Single-writer assumption:** an automated or scripted check that the platform reports exactly one
  running instance, and that a deploy shows no interval with two live PIDs (§5.4 A5/A6).
- **Spoofed `X-Forwarded-For`:** a request from an untrusted peer carrying a forged header is
  attributed to the real peer address, not the forged one (§5.4 A10/A11).

### 6.11 Scope controls for M5

**Do not build:** an update log or any incremental persistence representation · event sourcing ·
multi-node or cross-process coordination · distributed locking · a shared external database · a
persistence retry-count cap or circuit breaker · in-process adapter repair or reopen after poisoning ·
WS message rate limiting (M12 hardening) · room eviction (M10) · **metadata mutation (M6)** ·
version capture (M8) · presence (M7) · a general server→client RPC layer — `MSG_DURABLE` is one
message with two variants, not a protocol · performance optimization not triggered by the M4.5
benchmark · schema changes (M5 requires **no** migration; the watermark is in-memory only).

### 6.12 Acceptance criteria

1. Full validation set green, including `npm run test:e2e`, and CI green.
2. **AC-restart:** an edit made over WS after creation survives a real server restart on a
   file-backed database.
3. **AC-deletion:** a **deletion-only** edit survives a real server restart, and `Shared · saved`
   is never shown for an uncommitted deletion.
4. **AC-byte-exact:** after any live persist, `loadValidatedSheet` returns `ok`. A regression here
   bricks sheets, so this is a hard gate.
5. **AC-saved-gate:** `Shared · saved` renders only when `covers(committedSnapshot,
   Y.snapshot(localDoc))` holds; a barrier-held persist keeps the phrase at `Saving…` indefinitely.
6. **AC-frame-hygiene:** stale, duplicate, malformed, and oversized durability frames are each
   ignored without mutating durability state or dropping the connection.
7. **AC-reconnect-wording:** after the first successful sync, no transport drop ever produces
   `Connecting…`; a drop while uncovered produces the unsaved-risk phrasing.
8. **AC-failure-classes:** a recoverable pre-commit fault (`failNextBegin`) retries and recovers; a
   COMMIT failure emits `fatal = 1`, schedules no retry, and **never** emits a later success ack.
9. **AC-successor:** a mutation accepted after capture and before settlement always results in a
   successor persist attempt.
10. **AC-flush:** graceful shutdown flushes and drains before disposing rooms. A `SIGKILL`
    mid-debounce legitimately loses the last window — and the test asserts the UI never claimed that
    window was saved.
11. **AC-monotonic:** `server_revision` is strictly monotonic per sheet across ≥100 rapid two-client
    edits, with no older write overwriting a newer one.
12. **AC-metadata-forward:** a synthetic pending metadata mutation withholds `saved`, proving the
    predicate is complete before M6 exists.
13. **AC-budget:** the M4.5 benchmark re-run shows the persist hook and the synchronous capture block
    have not pushed the inbound path past the §5.3 ceilings.
14. **AC-quiescence (new):** after exactly one document mutation settles with no further edits, the
    persister reaches `idle` with no successor scheduled, and `flush()` resolves `{ covered: true }`
    without enqueuing additional work. Regression guard for the task-start dirty-clearing correction
    in §6.6.2.
15. `docs/RECONSTRUCTION_STATUS.md` updated; the UI-claim gate table (§8) updated.

**Codex checkpoint: mandatory** — the coverage predicate, the frame codec and handler registration,
the persister lifecycle, the failure classification, and the projection table.

## 7. M6 – M12 (summary)

Each is deep-planned when its predecessor closes, not now. Contracts and non-goals are fixed here.

### M6 — Metadata mutation *(conditional — see §4.4)*
Revisioned title/language: `serverMetadataRevision` · `localMetadataRevision` ·
`pendingMetadataMutation`. Server accepts a mutation only when its base matches current; on stale
base it returns the authoritative value. **No silent drop, no blind auto-replay** — surface the
authoritative value and keep the local pending value for explicit reapply (architecture §12).
Requires the first `metadata` UPDATE statement (none exists today).
**Depends:** M5. **Not:** rich metadata · per-field CRDTs · auto-merge.

### M7 — Identity, presence, remote cursors, jump/Back
Per-sheet `localStorage` identity, editable and unverified. Awareness `user` field — **never set
today**, so remote carets currently fall back to y-codemirror.next's cyan "Anonymous" serif label;
M7 must style `.cm-ySelectionInfo` / `.cm-ySelectionCaret` in `paperTheme.ts`. Presence chip,
gutter tick, jump-to-collaborator, single-slot Back, and a multi-client undo-isolation proof reusing
the existing `UndoManager` — **not** re-owning it. Presence must lag content sync, never lead it
(architecture §14). Awareness-boundary hardening (payload and rate limits, heartbeat, connection cap,
stale cleanup) lands here. Salvage `ADJECTIVES`/`ANIMALS` and the `isAwarenessUser` / `readUsers`
dedupe logic from the dead hooks before deleting them in M4.5 — record them in the M7 issue.
**Depends:** M5. **Not:** follow mode · Point · avatar pile · group dashboard.

### M8 — Server-owned bounded versions
Migration version 3 adds the `versions` table (§9). Capture from a committed `sourceRevision` via
the M5 commit hook; sequence ordering; dedup; long-debounce coalescing under an injected clock;
transactional hard bound.
**Depends:** M5. **Not:** preview UI (M9) · diffs · restore · attribution.

### M9 — Local read-only historical preview
Hidden-inert live editor plus a separate read-only preview view with **no `yCollab` binding** — so it
structurally cannot mutate the live doc (D-005). Suppress the local awareness cursor while previewing.
Exclude the hidden editor from the accessibility tree. Return restores focus and viewport.
**Depends:** M7 + M8. **Not:** restore · diff · historical cursor replay (D-010).

### M10 — Retention, eviction, and expiry *(narrowed — D-021)*
Last-activity retention using the **already-written but unread** `sheets.updated_at`; startup and
periodic sweeps under an injected clock; a `closing` guard so a reconnect or queued write cannot
race in after expiry begins; coherent single-transaction deletion of sheet + metadata + versions +
idempotency (the FK cascade already handles the last two). **Plus idle room eviction (DEF-6)** —
`disposeRoom` already does the teardown correctly; it needs a refcount and a caller, and a flush
before disposal.
**Depends:** M8. **Not:** retention tiers · user-visible countdowns · grace periods · soft delete ·
ownership or revocation.

### M11 — Paper convergence and accessibility
Convergence only — every surface already exists by this point, and DEF-1/2/4 were fixed in M4.5.
Responsive behaviour, keyboard audit, visible focus, live-region audit, reduced-motion, the contrast
and grayscale gates. Consider addressing the 753 kB bundle advisory here.
**Depends:** M6 + M9 + M10. **Not:** Ink · Graphite · theme switcher · any first-time behavioural UI.

### M12 — Production deployment, demo, and case study
Promote the M4.5 staging spike to a real public URL. Ship the deployment hardening the spike
deliberately deferred: **WS message rate limiting** (a socket can currently send unlimited valid
small updates, each paying the full O(document) preflight — the clearest public-deployment abuse
vector), Origin validation on the WS upgrade, and connection caps. Final soak. Case-study README,
demo script, and screenshots. **Decide the repository rename here, and only here.**
**Depends:** all. **Not:** custom infrastructure · autoscaling · multi-region · analytics.

---

## 8. UI-claim gates

No phrase renders before its proof exists. Updated for revision 4 — the `Shared · saved` proof is now
the **deletion-aware** predicate, and `Connecting…` is gated on `hasCompletedInitialSync`.

| Phrase | Technical proof | Earns it | Forbidden before |
|---|---|---|---|
| `Local draft — not uploaded` | no provider, no remote object | **shipped** | — |
| `Sharing…` | idempotent create in flight | **shipped** | — |
| `Connecting…` | **`hasCompletedInitialSync === false`** — the first join only, never a reconnect (§6.8.3 row 7) | **shipped**, re-gated **M5** | — |
| `Shared · connected` | valid sheet **+ completed initial sync**, no watermark yet received | **M5** | M5 |
| `Saving…` | transport connected, sync complete, **`covers()` false** (§6.4.3) | **M5** | M5 |
| `Reconnecting…` | transport interrupted **and covered**, or re-syncing after first sync | **M5** | M5 |
| `Reconnecting — recent edits not yet saved` | transport interrupted **and `covers()` false** | **M5** | M5 |
| `Not saved — storage failed` | durability failure frame received; `fatal = 1` outranks reconnect | **M5** | M5 |
| **`Shared · saved`** | **`covers(committedSnapshot, Y.snapshot(localDoc))`** — insertion clocks **and** delete set — **and** no pending metadata mutation **and** metadata revision covered | **M5** | **M5** — never before. **A state vector alone can never earn this** (§6.3). |
| `This link is unavailable` (invalid) | typed invalid/not-found lookup | **shipped** | — |
| `This link is unavailable` (expired) | retention expiry | **M10** | M10 |
| `● name — here` presence | live awareness after sync-complete | **M7** | M7 |
| `Viewing version … — read-only` | version served from durable store; live doc untouched | **M9** | M9 |
| `Only recent versions are available.` | bounded store | **M8** | M8 |
| `Older versions are not kept.` | retention **actually deletes** | **M10** | M10 |

---

## 9. Version model contract — locked now, built at M8

M5 must not create a persistence model that makes M8 awkward. These decisions are made now and are
binding on M5's implementation.

**A committed revision** is one committed SQLite transaction storing a new
`(state, state_vector, server_revision)` triple. Revisions are dense and monotonic per sheet from 1.

**Every durability acknowledgement corresponds to exactly one revision — but not every revision
becomes a version.** Versions are a strictly coalesced subset. This decoupling is essential: a
400 ms persist debounce would otherwise produce ~150 versions per minute.

**Ordering** is by `sequence_number` (monotonic per sheet, independent of revision), with
`source_revision` as the provenance pointer. `created_at` is display metadata only, immune to clock
skew.

**Coalescing** uses its own much longer debounce (15–30 s idle, injected clock), replacing rather
than appending within the window. A pending capture lost to a crash is acceptable and already
decided (architecture §10).

**Representation — canonical plain text.** Evaluated against the alternatives:

| Option | Storage | Preview read cost | Effect on live doc | `gc:false` required |
|---|---|---|---|---|
| (a) Full Yjs state per version | full encode × bound | must build a `Y.Doc` to extract text | none | no |
| (b) Incremental log + replay | smallest | replay from a base — slow, complex, large corruption surface | none | yes, for true snapshots |
| **(c) Canonical plain text** ✅ | visible text × bound | `SELECT text` — zero Yjs, zero CPU | **structurally impossible** | no |
| (d) Yjs snapshot API | grows monotonically with deletions | moderate | none | **yes** |

**(c) is chosen.** It matches the architecture's locked row shape, and it makes D-005 an invariant of
the type system rather than of developer discipline — **a string cannot mutate a `Y.Doc`.** (d) is
rejected on two independent grounds: it forces `gc: false`, which makes the server doc grow with
every deletion and collides directly with the 512 KiB canonical envelope; and it carries
authorship-adjacent data that architecture §10 forbids. **Nothing in the current code sets
`gc: false`** (verified: the only occurrence is a test fixture at
`server/loadValidatedSheet.test.mjs:273`), so this choice is free.

**Row shape** (migration version 3, M8):
`{ version_id, sheet_id, sequence_number, source_revision, text, created_at }`, `sheet_id` with
`ON DELETE CASCADE` — matching the existing `metadata` and `idempotency` pattern so M10's deletion
stays coherent by construction.

**Bounds — two, not one.** A count bound (proposed **20 versions/sheet**) *and* a total-text-bytes
bound (proposed **2 MB/sheet**), oldest-first eviction, both enforced in the same transaction as the
insert. The count bound alone permits 20 × 250 KB = 5 MB per sheet, which is too much on a small
deployed instance. **Locking the byte bound now is cheap; retrofitting it after M10 is not.**

**Historical read path.** `GET /api/sheets/{id}/versions` (list) and
`GET /api/sheets/{id}/versions/{versionId}` (text). **Plain HTTP GET — no socket, no write path, no
room acquisition.** A preview cannot touch the live document because it never obtains a handle to
one.

> **The one seam M5 must build.** At the moment a persist transaction commits at revision R, the
> persister must emit `{ sheetId, serverRevision: R, committedAt, text, coverage }` where `text` is
> `doc.getText("content").toString()` and `coverage` is `Y.encodeSnapshot(Y.snapshot(doc))`, **both
> captured in the same synchronous block that produced the state blob** (§6.4.2). **Build this hook
> in M5 with zero subscribers.** Without it, M8 must re-decode the stored blob — wasteful and racy.
> This is the single most important forward-compatibility decision in this plan. Cost: one
> `toString()` plus one `snapshot()` per persist, both cheap beside the encode already happening and
> both budgeted in §5.3.
>
> *Revision 4 note:* `coverage` is added to the hook payload because the persister computes it anyway
> for the durability frame (§6.5.2). M8 does not need it, and **must not** start storing it — the
> version row shape stays exactly as specified above. It is included only so that a future consumer
> never has to reconstruct a watermark that was already in hand. Codex passed this seam; nothing else
> about it changes.

---

## 10. Scope-creep controls

Named per milestone so the temptation is recognized rather than rationalized.

| Milestone | Tempting creep | Ruling |
|---|---|---|
| M4.5 | "While deleting dead code, refactor the live modules." | **No.** Deletion only. Refactors need a milestone. |
| M4.5 | "While deploying, add monitoring/CDN/custom domain." | **No.** The spike answers one question: does the volume persist? |
| M4.5 | "The benchmark shows a hotspot — optimize it now." | **No.** Optimize only on a §5.3 trigger, and only in the listed order. |
| M5 | "Add an update log — it's more efficient." | **No.** Rejected in architecture §7/§22. Full blob is the smallest correct representation at this scale. |
| M5 | "Handle two server processes." | **No.** Multi-node is an explicit exclusion; the revision RMW is documented as single-process. |
| M5 | "Generalize `MSG_DURABLE` into an RPC layer." | **No.** One message type, one payload. |
| M5 | "Add a circuit breaker after N failures." | **No.** No better user action exists; bound the rate, not the count. |
| M6 | "Make title/language CRDTs so they merge." | **No.** Architecture §12 decided revisioned fields deliberately. |
| M7 | "Follow mode is a small addition to jump." | **No.** Post-v1. Jump is one-shot by decision. |
| M7 | "Show an avatar pile for 3+ people." | **No.** Design brief §9 rejects it by name. |
| M8 | "Store the Yjs state so restore is possible later." | **No.** Copy-not-restore is locked; text-only is the invariant that makes D-005 free. |
| M9 | "Add a diff between versions." | **No.** Excluded. |
| M10 | "Add retention tiers / user-configurable windows." | **No.** One window, one sweep. |
| M11 | "Ship Ink for dark-mode users." | **No.** Design brief §3: Paper is the sole first-pass obligation. |
| M12 | "Rename the repository and rebrand everything." | **Only here**, and only as a deliberate decision. |

---

## 11. Validation commands

Every code milestone ends with all six, all clean:

```bash
npm run test && npm run test:integration && npx tsc --noEmit && npm run build && npm run test:e2e && git diff --check
```

`npm run test` is client-only (jsdom, `src/**/*.test.{ts,tsx}`). The server and client-lifecycle
suites are the separate `npm run test:integration` (node, `server/**/*.test.mjs`). From M4.5 onward
**CI runs all of them on every push**, so "green locally" is no longer the standard.

---

## 12. Deferred work

**Post-v1 (decided, not scheduled):** restore from version · named checkpoints · local recents ·
read-only links · continuous follow mode · duplicate from version · mobile viewing polish · Ink and
Graphite themes · Point (pending `docs/experiments/POINT_EXPERIMENT.md`).

**Known and consciously carried:**
- The 512 KiB canonical cliff (DEF-7). M4.5 measures how reachable it is under realistic editing;
  M5 gives it honest user-facing wording. Raising the cap or compacting the document is post-v1.
- Cross-process revision safety (§6.4.7). Documented, single-node by design, and gated by T4/A5 (§5.4).
- Idempotency records are never garbage-collected. M10's sheet deletion cascades them, which is
  sufficient at this scale.
- The 753 kB main bundle advisory. Candidate for M11.
- Awareness relay echoes to its own origin (`server/app.mjs:364-366`). One wasted frame; harmless.

---

## 13. Document supersession

### 13.1 Required companion-document edits

1. **`docs/PRODUCT_BRIEF.md` — disambiguate "deployment."** The "Explicitly excluded" list contains
   *deployment* alongside code execution, terminal, and package installation — i.e. product features
   Galley does not offer. **Version B requires hosting Galley at a real URL**, so the brief must say
   so explicitly: Galley does not deploy the *user's* code; Galley itself is hosted. `README.md`'s
   "deployment infrastructure" exclusion needs the same clarification. This is a genuine
   contradiction and must not be left to charitable reading.
2. **`docs/PRODUCT_BRIEF.md` — record the Galley name adoption and the Version B scope lock**, noting
   that Version B is narrower than "Minimum complete v1" on exactly one point (metadata editability,
   §4.4).
3. **`CLAUDE.md`** — correct the dead-file list (eleven, not four) and remove the now-stale
   "leave `tokens.css` in place" instruction, which preserves DEF-1.
4. **`docs/README.md`** — mark this document as the authoritative execution roadmap.
5. **`docs/AGENTS.md`** — references `docs/DESIGN_DIRECTION.md` and `docs/TASKS.md`, neither of which
   exists. Archive it or fix the references.

### 13.2 Supersession mechanics

- **This file is the only roadmap.** Revision 2 lives in git history; it is not archived to a
  separate file, because a second planning file is exactly the overlapping infrastructure to avoid.
- `RECONSTRUCTION_ARCHITECTURE.md` is **not** superseded — it remains the technical design contract,
  with the three departures of §4.3 recorded as decisions.
- `RECONSTRUCTION_STATUS.md` becomes a **rolling** as-built record, its header updated at each
  milestone close. It answers "what is true now"; this document answers "what happens next." Neither
  may answer the other's question.
- No new planning document may be created. New decisions go in `DECISIONS.md`; new sequencing goes
  here.

---

## 14. New decisions to record in `DECISIONS.md`

| ID | Decision |
|---|---|
| **D-019** | `Shared · saved` is earned at M5 via a complete coverage predicate, not gated behind a separate wording milestone. The predicate includes the metadata leg from the start and is proven by a synthetic pending-mutation test before M6 exists. |
| **D-020** | The live persister writes byte-exact server-canonical output (`Y.encodeStateAsUpdate` on a doc whose `"content"` root was predeclared as `Y.Text`), because `loadValidatedSheet` compares stored bytes for equality and any deviation permanently bricks the sheet. |
| **D-021** | Retention is narrowed to last-activity expiry, a `closing` race guard, and coherent single-transaction deletion; idle room eviction is added to the same milestone. Elaborate retention policy surface is out of scope. |
| **D-022** | Recent versions store canonical plain text, not Yjs state, snapshots, or an update log — making the non-mutation invariant (D-005) structural rather than disciplinary, and avoiding the `gc: false` requirement that collides with the 512 KiB canonical envelope. |
| **D-023** | Versions are bounded by **both** a count and a total-bytes limit per sheet, enforced transactionally with the insert. |
| **D-024** *(revised r4)* | Live durability is acknowledged by a new **`MSG_DURABLE = 4`** WebSocket message broadcast to **all** clients in a room after commit, because durability coverage is a property of the document, not of one client's edit. Type **4** was chosen after reading `y-websocket 3.0.0`, where `messageQueryAwareness = 3` is already taken; the design is purely additive and repurposes no existing type. The handler is registered on the provider's **per-instance** `messageHandlers` copy and writes nothing to the reply encoder. |
| **D-025** | Persist scheduling uses a quiet debounce plus a max-latency cap, so `Saving…` cannot persist indefinitely under continuous typing. |
| **D-026** | The name **Galley** is adopted conceptually; the repository slug and `package.json` name remain `echo-rewind` until M12. |
| **D-027** *(new r4)* | The durability watermark is a **deletion-aware encoded `Y.Snapshot`** (`{sv, ds}`), not a state vector. Verified against `yjs 13.6.31`: deletions leave `encodeStateVector` byte-identical while canonical state changes, so state-vector coverage would have authorized `Shared · saved` for an undeleted-in-storage deletion. Coverage is `sv` subsumption **plus** `equalDeleteSets(mergeDeleteSets([ds_c, ds_l]), ds_c)`, using only public exports. Galley never restores from these snapshots, so `gc: false` is **not** required. **If this comparison ever cannot be expressed without private Yjs internals, `saved` is withdrawn entirely rather than weakened.** |
| **D-028** *(new r4)* | `livePersister` is the **sole owner** of all persistence lifecycle state. The room record holds no dirty, scheduled, queued, in-flight, or retry state — only an opaque persister handle. A persist attempt captures `{state, coverage, text}` in one synchronous block with no `await`, and any mutation accepted after capture guarantees a successor attempt. |
| **D-029** *(new r4)* | SQLite faults are classified as **retryable** (BEGIN failure; statement failure with confirmed clean rollback) or **outcome-uncertain** (COMMIT failure, ROLLBACK failure), because the adapter **poisons** on the latter and no later write can succeed in-process. Outcome-uncertain failures never emit a durability success, schedule no retry, and require a process restart. |
| **D-030** *(new r4)* | The client projection is computed from `hasCompletedInitialSync` (latched, never reset) plus current transport, current sync, coverage, and storage-failure state — **not** from a linear status. `Connecting…` is reachable only before the first successful sync; every later drop is a reconnect state. A fatal storage failure outranks reconnect wording. |

---

## 15. Stop conditions

Stop and reconsider the architecture — do not continue — if any of these occurs.

1. **The deployment gate (M4.5 T4) fails on persistence or on single-writer.** Specifically: the
   database and its WAL/SHM siblings do not live on a persistent volume (A1, A2), a sheet does not
   survive a redeploy (A4), or the platform cannot guarantee **exactly one writer process at all
   times including during deployment** (A5, A6). Every durable claim in the product is false in
   production, and the single-writer assumption underpins the revision read-modify-write (§6.4.7).
   Reconsider the **host** *before* building M5, not after. **Do not resolve this with multi-node
   coordination, distributed locking, or a shared external database** — all are excluded (§1.2).
2. **The benchmark trips a §5.3 redesign trigger and the listed redesigns do not clear it.** The
   input-containment strategy itself is then wrong for this product, and that is an architecture
   decision, not an optimization.
3. **Byte-exact canonical persistence (I-7) cannot be achieved reliably.** If a persisted sheet can
   ever fail to reload, the durability claim is unsafe at any wording. Do not ship a probabilistic
   `saved`.
4. **The 512 KiB canonical cliff proves reachable by ordinary editing.** If a normal session can
   brick a sheet, that is a product-level defect that outranks the remaining roadmap.
5. **`Shared · saved` cannot be made to lag reality in every tested interleaving.** The honesty
   thesis is the product; a `saved` that is ever early is worse than no `saved` at all. Cap the
   wording at `Shared · connected` and redesign.
5a. **Deletion-aware coverage cannot be expressed on stable public Yjs API.** If a `yjs` upgrade
   removes or changes `snapshot` / `encodeSnapshot` / `mergeDeleteSets` / `equalDeleteSets`, do not
   reach for private internals and do not fall back to state-vector coverage. **Withdraw `saved`**
   (§6.4.6) and choose a different truthful contract first.
6. **A milestone cannot leave the repository coherent.** If a milestone must ship half-built to be
   shippable at all, it is scoped wrong — re-split it rather than merging a broken state.
7. **Scope pressure recurs on the same excluded item twice.** Two arrivals at the same "we should
   just add X" is evidence the product definition is wrong, not that X is needed. Revisit the brief
   deliberately rather than eroding it incrementally.

---

## 16. Definition of done — Galley v1

All fourteen §1.1 items shipped. Plus:

- [ ] 630+ tests green across all three suites; `tsc` clean; build clean; **CI green on `main`**.
- [ ] A live edit made after Share survives a real server restart, proven by an automated test and
      reproducible by hand on the deployed URL.
- [ ] **A deletion-only edit** survives a real server restart, and is never reported `saved` before
      it is committed.
- [ ] `Shared · saved` never appears while `covers(committedSnapshot, Y.snapshot(localDoc))` is
      false — insertions **and** deletions — in any tested interleaving.
- [ ] Persistence failure and transport failure are visually and verbally distinct, and a **fatal**
      storage failure stays visible while the transport reconnects.
- [ ] After the first successful sync, no transport drop ever displays `Connecting…`.
- [ ] The deployed instance runs exactly one writer process, verified across a real redeploy, and a
      forged `X-Forwarded-For` cannot spoof the client address.
- [ ] Two browsers show named presence and live remote cursors; jump and Back work by keyboard alone.
- [ ] One participant previews a past version while the other keeps editing, and returning to current
      shows the collaborator's edits made during the preview.
- [ ] The live `Y.Doc` is never mutated by any preview path (D-005), proven structurally.
- [ ] Download yields a correctly named and extended file.
- [ ] An expired sheet is actually deleted — sheet, metadata, versions, and idempotency record —
      and its link reports unavailable.
- [ ] Every design-brief screen renders on Paper; keyboard flow complete; focus visible; live regions
      match the header words; reduced-motion honoured; the interface survives grayscale.
- [ ] Deployed at a real URL where a sheet created before a redeploy is readable after it.
- [ ] `README.md` reads as a case study: the product decision, the collaboration model, the honesty
      mechanism, and the recovery surface — with screenshots and a demo path.
- [ ] No claim anywhere in the product or documentation exceeds what the implementation proves.

---

*Planning document. Revision 4 creates no code and changes no product scope beyond the two
`PRODUCT_BRIEF.md` clarifications named in §13.1. It sequences the approved architecture into
milestones with UI claims gated by real technical guarantees. Implementation begins only when a
milestone is explicitly authorized.*
