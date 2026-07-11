# Implementation Plan — Galley reconstruction (revision 2)

> **Status: planning only. No implementation authorized by this document.**
>
> - `docs/PRODUCT_BRIEF.md` — canonical product contract.
> - `docs/DESIGN_BRIEF.md` — canonical visual/interaction contract (governs final UI copy).
> - `docs/RECONSTRUCTION_ARCHITECTURE.md` — **approved** technical architecture; this plan sequences it.
> - `docs/ARCHITECTURE.md` / `docs/DECISIONS.md` — historical (`prototype-v1`).
> - A reconstruction QA checklist is a **deliverable of M12**, not an input (the only `QA_CHECKLIST.md` in the tree is historical under `docs/archive/prototype-v1/`).
> - Checkpoints `week1-demo` and `prototype-v1` **must never move**. This plan touches no tags.
> - **Working name** "Galley" is provisional; UI copy stays product-neutral ("the sheet").
> - Revision 2 resolves the Codex plan review: M0 split (M0a/M0b), M1 narrowed, a dedicated cleanup milestone (M1c), M5 split (M5a/M5b), Find/Download given owners, hardening reassigned to owning boundaries, minimum Paper UI made incremental, and the dependency graph + UI-claim gates corrected.
>
> **Last updated:** 2026-07-11.

---

## 1. Implementation principles

1. **Preserve approved product scope.** Build only what the product + architecture briefs define; nothing speculative.
2. **Architecture before UI claims.** A UI phrase ships only after the technical guarantee it asserts exists (§6 UI-claim gates).
3. **No `saved` wording before durable acknowledgement + metadata coverage exist** (M5b). Until then the strongest legal claim is `Shared · connected` / `Saving…`.
4. **Preserve the same `Y.Doc`, `Awareness`, and `Y.UndoManager` through Share** — no teardown of any of the three across the draft→shared handoff (M4; architecture §4.6, §9).
5. **Tests land in the same commit as the behavior they prove** — never a trailing "add tests" commit.
6. **Remove obsolete timeline behavior rather than hiding it** — but M1 *bypasses* (stops importing) obsolete code and a single bounded cleanup milestone (M1c) deletes it; two active architectures must never coexist.
7. **Minimum Paper UI is integrated continuously** (M1, M4, M5, M7, M9), not deferred wholesale to M11.
8. **Prefer small atomic commits** — one seam per commit; every commit builds and passes all tests.
9. **Codex review before architecture-sensitive commits** (§9 Review strategy).
10. **Never move `week1-demo` or `prototype-v1`.**

---

## 2. Current repository map

Grounded in the actual tree on `reconstruction/collab-first`.

### 2.1 Existing files

| File / subsystem | Disposition | First milestone |
|---|---|---|
| `src/main.tsx` | **adapt** | M1 (render a route resolver) |
| `src/App.tsx` | **replace** | M1 (draft at `/`, sheet at `/{id}`) |
| `src/pages/RoomPage.tsx` | **replace** | M1 (draft/sheet session view) |
| `src/lib/room.ts` (module-level always-connected provider, hardcoded `demo`) | **replace** | M1 bypass → provider factory finalized M4 |
| `src/lib/useSessionIdentity.ts` | **adapt** | M7 (per-sheet `localStorage`, editable name) |
| `src/lib/useProviderStatus.ts` (3-state) | **replace** | M5a (state reducer) |
| `src/lib/usePresence.ts` | **adapt** | M7 |
| `src/lib/snapshots.ts` (+ `.test.ts`) | **remove** | bypass M1, **delete M1c** |
| `src/lib/useSnapshots.ts` | **remove** | bypass M1, **delete M1c** |
| `src/lib/timeline.ts` (+ `.test.ts`) | **remove** | bypass M1, **delete M1c** |
| `src/components/TimelineScrubber.tsx` (+ `.test.tsx`) | **remove** | bypass M1, **delete M1c** |
| `src/lib/editorSeed.ts` | **remove** | bypass M1, **delete M1c** |
| `src/components/CollaborativeEditor.tsx` | **adapt** | M1 (external doc/awareness/undo + Find); preview change M9; theme M11 |
| `src/components/ConnectionStatus.tsx` | **replace** | M5a |
| `src/components/PresenceBar.tsx` (avatar pile) | **replace** | M7 logic / M11 visuals |
| `src/components/AppShell.tsx` (`echo://`, Live, timeline footer) | **replace** | M1 (truthful Paper draft shell) |
| `src/components/ui/{button,badge}.tsx`, `src/lib/cn.ts` | **keep** | — |
| `src/lib/codeMirrorTheme.ts` (amber) | **replace** | M1 foundation → M11 convergence |
| `server/index.mjs` | **replace/restructure** | untouched M1; restructured M2+ |
| `e2e/room.spec.ts` | **replace** | **incompatible active cases replaced in M1** (any spec that runs against `/r/demo`, the demo shell, always-connected provider, old identity, or seed/timeline behavior on the active route); remaining sync/awareness/cursor/past-mode specs adapt at their milestones |
| `src/App.test.tsx` | **replace in M1** | asserts the prototype shell/route; updated/replaced in the same commit that activates `/` |
| `TimelineScrubber.test.tsx`, `snapshots.test.ts`, `timeline.test.ts` | **delete M1c** | unit tests whose source is deleted at M1c |
| `playwright.config.ts` (dev URL `/r/demo`, single worker, `reuseExistingServer:false`) | **adapt** | M1 (dev URL `/`); durable reset M2 |
| `vitest.config.ts` | **adapt** | M2 (integration include) |
| `src/styles/{global,tokens}.css` (amber) | **replace** | M1 Paper foundation → M11 |

### 2.2 New conceptual modules (filenames indicative)

**Client:** local draft session · client sheet session · provider factory (accepts existing `Y.Doc` + `Awareness`, no eager connect) · Share coordinator · transport/sync/durability reducer · metadata coordinator · Download/export util · version-preview controller · jump/Back controller · identity store · client test seams.

**Server:** room lifecycle manager (per-sheet queue/mutex, `closing` state) · SQLite store · migration runner · durable-ack protocol · version store · retention service · validation/limits + heartbeat layer · typed errors · server test seams.

### 2.3 Dependency prerequisites the plan surfaces but does not perform

Two capabilities require packages **not currently in `package.json`**. This plan installs nothing; each is a gating decision named at its milestone:

- **R-DEP1 — SQLite binding** (for M2): resolved by the **M0b** spike.
- **R-DEP2 — `@codemirror/search`** (for M1 Find/search): the editor currently imports no search module and includes no `searchKeymap`, so Find does not exist yet. Adding `@codemirror/search` is a **prerequisite to M1's Find requirement** and must be approved with the M1 slice (it is a small, first-party CodeMirror package with no runtime risk, but it is still a dependency addition and is called out honestly rather than assumed).

---

## 3. Milestone plan

Sixteen milestones. Document order matches the corrected dependency graph (§5): **M0a, M0b, M1, M1c, M2, M3, M4, M5a, M6, M5b, M7, M8, M9, M10, M11, M12.** Each uses the §4 template (compact).

---

### M0a — Baseline characterization
- **Goal:** know exactly what the prototype does today and protect the branch from M1 regressions. **No server composition rewrite.**
- **Product contract:** none (protective).
- **Architecture sections:** none (characterization).
- **Files touched:** test-helper additions only; **`server/index.mjs` untouched.**
- **New modules:** persistence-independent test helpers (DOM/render harness assertions; a "no WebSocket constructed" probe).
- **Removed:** nothing.
- **Includes only:** characterize current routing (`main.tsx → App → RoomPage demo`) and the always-connected provider (`room.ts`); enumerate the current tests that M1/M1c will replace (seed + timeline + sync/awareness/cursor); establish test helpers that **do not depend on persistence**; confirm Playwright startup (single worker, `npm run server` + `npm run dev`, dev URL `/r/demo`); confirm current package scripts (`test`, `test:e2e`, `server` — no `test:integration`).
- **Explicitly excludes:** persistence-failure injection · durable reset · fake clock · deterministic sheet IDs · clipboard orchestration · any server factory rewrite.
- **Dependencies:** none.
- **Non-goals:** no product behavior change, no SQLite, no seams that imply persistence.
- **Acceptance:** a written baseline note (in this plan's appendix or a short doc) of current routing/provider/tests; the "no WebSocket" probe works against the current app *after* the provider is made lazy (used by M1).
- **Unit:** the render/no-socket probe helper.
- **Integration:** none.
- **Playwright:** existing suite still green (unchanged).
- **Manual QA:** none.
- **Commands:** `npm run test` · `npx tsc --noEmit` · `npm run build` · `npm run test:e2e` · `git diff --check`.
- **Commits:** `test: baseline probes (render + no-socket) for M1`.
- **Codex checkpoint:** light.
- **Safe stop:** yes — nothing changed behaviorally.

---

### M0b — SQLite / toolchain decision spike (before M2)
- **Goal:** choose the exact persistence toolchain before any persistence code. **Planning/preparation, not product behavior.**
- **Product contract:** none (enabling M2).
- **Architecture sections:** §7 (persistence) — selects the binding it assumes.
- **Files touched:** **`docs/SQLITE_DECISION.md`** — a short technical decision record (no code/package changes during the spike).
- **Decision must cover:** exact SQLite option (e.g., `node:sqlite` vs `better-sqlite3`) · Node compatibility and whether the Node version must be **pinned** · sync vs async API · native-build implications · local-install reliability · CI implications · **WAL + `synchronous = FULL` support** · migration testing approach · file-backed restart testing approach · rationale for the selection. **No external database.**
- **New modules:** none.
- **Removed:** nothing.
- **Dependencies:** none (can run in parallel with M0a/M1).
- **Non-goals:** no code, no install (the install itself is part of M2 bootstrap once approved).
- **Acceptance:** `docs/SQLITE_DECISION.md` is **reviewed and committed before M2 begins**; it unblocks M2 and resolves **R-DEP1**.
- **Tests:** none (decision artifact).
- **Commands:** `git diff --check` (docs only).
- **Commits:** `docs: sqlite/toolchain decision record (docs/SQLITE_DECISION.md)`.
- **Codex checkpoint:** **mandatory** (toolchain decision).
- **Safe stop:** yes.

---

### M1 — Local draft session (narrow first coding slice)
- **Goal:** route `/` to a truthful, empty, local draft — the smallest honest coding slice.
- **Product contract:** "Local until deliberately shared"; draft not promised to survive reload; Find/search baseline (brief §Minimum complete v1 required-editor-baseline; arch §3).
- **Architecture sections:** §3, §1 (client), §4.6 (Awareness created, not broadcast), §9 (UndoManager created).
- **Files touched:** `App.tsx` (route resolver: `/` → draft; a **dormant** `/{id}` stub is acceptable only for compatibility, constructing nothing), `main.tsx`, new draft-session module, `CollaborativeEditor.tsx` (external doc/awareness/undo + Find), a minimal Paper draft shell (new, replacing the active `AppShell` on the draft path), **`src/App.test.tsx`** (replace the prototype-shell/route assertions), and **`e2e/room.spec.ts`** (replace/remove every case that runs against the active route under prototype assumptions).
- **Includes:** one local **unconnected `Y.Doc`** · one client-owned **`Awareness`** (not broadcast) · one external client-owned **`Y.UndoManager`** (safe tracked-origins per §9) · editor receives explicit doc/awareness/undo dependencies · **no provider construction in the active draft path** · no WebSocket · no remote sheet · no Share · no persistence · no presence · **no shared/saved wording** · empty editable code sheet · local title/language state · **CodeMirror Find/search** (requires R-DEP2) · local undo via **Yjs undo keymap** (native CodeMirror history excluded).
- **Minimal truthful Paper-aligned shell:** shows `Local draft — not uploaded`; **no** Copy link, **no** Live, **no** `echo://demo`, **no** timeline footer, **no** remote controls.
- **Bypass, do not delete (source deletion is M1c):** client seed, module-level provider, snapshots, timeline utilities, `TimelineScrubber`, `useSnapshots` — stop importing them from the active path; leave the dead **source** files for M1c.
- **Active tests are M1's responsibility (not deferred to M1c):** the moment M1 activates `/` as a local draft, any existing test that executes against the active route under prototype assumptions would fail — so **M1 updates/removes them in the same behavior commit.** This covers `src/App.test.tsx` (prototype shell/route) and the incompatible `e2e/room.spec.ts` cases tied to `/r/demo`, the demo shell, always-connected provider behavior, old identity assumptions, and old timeline/seed behavior on the active route. M1c removes **only** already-unreachable prototype source and the unit tests whose source it deletes.
- **Server:** `server/index.mjs` **untouched**; `STARTER_CODE` may remain **dormant** because the draft never connects.
- **Dependencies:** M0a. (**R-DEP2** approved for Find.)
- **Non-goals:** no Share, no provider, no SQLite, no server change, no draft persistence, no mass deletion.
- **Acceptance / tests (land with the behavior):**
  - **no provider constructed** · **no WebSocket opened** · **no remote sheet created** · **exactly one local `Y.Doc`** · **exactly one `Awareness`** · **exactly one external `UndoManager`** · local editing works · local undo works · **Find/search works** · reload → fresh draft · **no remote claims or controls appear** (`Local draft — not uploaded` present; Copy link / Live / `echo://` / timeline absent).
- **Unit:** draft-session singletons; undo origin scoping (only local-origin edits undoable); Find keymap wired.
- **Playwright:** the no-socket / no-sheet / fresh-reload / Find / no-remote-controls assertions.
- **Manual QA:** open `/`, type, Find, undo, reload → empty.
- **Commands:** full validation set.
- **Commit ordering (must never expose the draft under false prototype chrome):** the route activation and the truthful Paper shell land in the **same** commit — there must be no intermediate commit where `/` points to the local draft while old chrome still shows Live, Copy link, `echo://demo`, presence, or the timeline. Suggested sequence:
  1. `test: characterize draft activation + no-socket expectations` (probes only, still green on the prototype).
  2. `feat: activate local draft at root with truthful Paper shell` — route change **+** local draft session **+** active shell replacement **+** incompatible active tests (`App.test.tsx`, incompatible `room.spec.ts`) updated/replaced, all in one commit.
  3. `refactor: editor accepts external doc/awareness/undo` — **only if** this intermediate commit still builds and passes; otherwise fold into commit 2.
  4. `feat: CodeMirror Find + Yjs undo keymap` — with tests.
  Prefer fewer commits if that is what keeps every commit truthful and green.
- **Codex checkpoint:** **mandatory** (UndoManager tracked-origin setup; draft-session ownership).
- **Safe stop:** yes — a shippable local scratch editor with Find and undo.

---

### M1c — Prototype client cleanup (bounded deletion)
- **Goal:** delete the now-unreachable prototype client history code in one isolated milestone, so two architectures never coexist.
- **Product contract:** none (hygiene); enforces "no permanent timeline."
- **Files touched:** deletions only.
- **Remove (already-unreachable source + the unit tests whose source is deleted here):** `editorSeed.ts` (if unused) · Y.Array snapshot wiring · snapshot recorder (`snapshots.ts` + `snapshots.test.ts`) · `useSnapshots.ts` · timeline utilities (`timeline.ts` + `timeline.test.ts`) · `TimelineScrubber.tsx` (+ `TimelineScrubber.test.tsx`) · any remaining dead test fixtures/helpers left over after M1.
- **Not M1c's job (already handled in M1):** the **active** `e2e/room.spec.ts` replacement and `src/App.test.tsx` replacement were done in M1's behavior commit, because they run against the active route and fail the moment `/` activates. M1c touches only source that is already unreachable and its orphaned unit tests.
- **Do not remove:** **server `STARTER_CODE`** (removed in **M3** when durable creation replaces it).
- **Dependencies:** M1.
- **Non-goals:** no server change; no behavior change (all deleted code is already unreachable after M1).
- **Acceptance:** grep shows no `snapshots`/`timeline`/scrubber references in the active tree; suite green; no dead imports.
- **Tests:** the suite passes with the deletions; an "absence" assertion (no timeline testids) may live in M1's Playwright and remains green.
- **Commands:** full set.
- **Commits:** `chore: remove unreachable prototype timeline/snapshots (post-M1 cleanup)`.
- **Codex checkpoint:** light (pure deletion of unreachable code).
- **Safe stop:** yes.
- **Note:** dead, unreachable source may exist **briefly** between M1 and M1c; M1c is the single bounded window that closes it.

---

### M2 — Durable persistence + lifecycle queue (preceded by M0b)
- **Goal:** durable server storage and reopenability.
- **Product contract:** same-link reopenability during retention (brief §Access and persistence; arch §7).
- **Architecture sections:** §7 (persistence + per-sheet write queue), §18 (data records).
- **Files touched:** `server/index.mjs` split into a composition layer; new persistence modules; `vitest.config.ts` (integration include); **new `npm run test:integration` script created here** (M2 bootstrap, first commit — §Commits).
- **Includes:** the **selected SQLite binding from M0b** · Node version decision/pinning if required · a **real server integration test runner** (`npm run test:integration`, or an updated `npm run test` that includes server tests) · file-backed temporary database · migrations + `schema_version` · **WAL + `synchronous = FULL`** · per-sheet lifecycle **queue/mutex** · serialized writes · monotonic `serverRevision` · corrupt-state handling · load-on-connect · **persistence-failure injection** · **TEST_MODE durable reset** (now that durable storage exists) · **server start/stop/restart control owned by the reconstructed server composition**.
- **Ownership note:** fake clocks and deterministic IDs are introduced **only where a service owns them** — retention's fake clock lands with M10, sheet-ID generation with M3; M2 owns the persistence store, its restart control, and persistence-failure injection.
- **Removed:** in-memory-only room state (replaced).
- **Dependencies:** M0b (resolves R-DEP1).
- **Non-goals:** no Share API (M3); **no `saved` UI** (no ack yet).
- **Acceptance:** a test-seeded sheet survives a real restart (file-backed DB); corrupt blob → sheet unavailable, server survives; WAL + FULL confirmed; parameterized SQL only.
- **Unit:** migration idempotency (run twice → no-op); per-sheet queue serialization (stale write cannot overwrite newer); revision monotonicity.
- **Integration (`test:integration`, file-backed):** write → restart → identical state; corrupt-state; persistence-failure injection.
- **Playwright:** none (no client surface).
- **Manual QA:** run the integration suite; inspect the DB file.
- **Commands:** full set **+ `npm run test:integration`** (introduced this milestone).
- **Commits (runner first — no persistence commit may precede the command it runs under):**
  1. `test: add server integration runner + file-backed harness` — creates `npm run test:integration`, the `vitest` integration include, the file-backed temp DB, and the minimal harness the first persistence behavior needs. No persistence behavior yet.
  2. `feat: sqlite store + migrations (WAL, synchronous FULL)` — with integration tests (now runnable).
  3. `feat: per-sheet write queue + monotonic revision` — with tests.
  4. `feat: load-on-connect + corrupt-state handling` — with tests.
  (Commit 1 may instead be folded into commit 2 as a single commit, but a persistence commit must never be listed before the runner exists.)
- **Codex checkpoint:** **mandatory** (schema/persistence/write queue).
- **Safe stop:** yes — persistence proven in isolation.

---

### M3 — Durable create API (server-only, UI-unexposed)
- **Goal:** create one durable sheet from a submitted draft state. **Committable independently as server-only, integration-tested, with no visible Share control.**
- **Product contract:** Share creates the remote sheet + uploads initial state (brief §Creation model; arch §4).
- **Architecture sections:** §4.1–4.5, §12 (metadata creation), §19 (create-boundary limits).
- **Files touched:** server composition; id minting; typed errors.
- **Includes:** idempotency token · atomic creation · initial Yjs state/vector · initial metadata · lost-response retry · one durable row · typed errors · **create payload limits · metadata (title/language) limits · sheet-ID generation and validation · create rate limiting where appropriate** · **removal of `STARTER_CODE`** · **no visible Share control.**
- **Hardening owned here (create boundary):** create body size, title/language sizes, sheet-ID entropy + strict parser, create-rate limit.
- **Dependencies:** **M2** (not M1).
- **Non-goals:** no client handoff (M4); no ack/`saved` (M5a/M5b).
- **Acceptance:** duplicate create → one row; lost-response + retry → same sheet; partial-failure → no half-created sheet; invalid/oversized payload → typed error; content+metadata restored after restart.
- **Unit:** token identity/collapse; id format/regex; limit checks.
- **Integration:** create → restart → intact; concurrent/duplicate collapse; malformed/oversized rejected.
- **Playwright:** none (no UI).
- **Manual QA:** drive the create API via integration.
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: idempotent durable create (token, atomic commit)`; `feat: create limits + sheet-id validation`; `chore: remove server starter seeding`; each with tests.
- **Codex checkpoint:** **mandatory** (create API).
- **Safe stop:** yes — API proven; client still draft-only.

---

### M4 — Complete Share handoff (one user-visible release gate)
- **Goal:** attach the existing client session to the new sheet with zero state loss and no reload — the **complete** Share gate. **M3 + M4 form one release gate:** M3 may merge server-only, but the **visible Share control is absent until every M4 acceptance test passes.**
- **Product contract:** one-gesture Share; both editing within seconds (brief §Core loop; arch §4.4, §4.6).
- **Architecture sections:** §4.4, §4.6, §9 (undo survives), §5 (routing), §19 (transport-boundary limits).
- **Files touched:** Share coordinator, provider factory (attach existing doc+awareness), route resolver (`history.pushState`), editor (no re-mount), Paper Share/Connecting treatment.
- **Includes:** same `Y.Doc` · same `Awareness` · same `UndoManager` · same editor where feasible · **no reload** · no duplicate content · in-flight **content** edits preserved · **metadata edits during Share queued** · **URL update only after durable creation** · **clipboard-failure fallback** (visible URL + manual Copy link; no pre-copy, no optimistic URL) · collaborator join timing · **awareness broadcasts only after attachment** · **pre-Share undo survives** · **visible Share control remains absent until all acceptance tests pass.**
- **Hardening owned here (transport boundary):** WebSocket route/path validation · Yjs update/message size limits · malformed sync-message handling.
- **M4 legal phrases:** `Sharing…` (during create request) · `Connecting…` (during attach/initial sync) · a neutral shared state after sync if needed. **Do not expose `Shared · connected` yet** (that is M5a, gated on the ack machinery).
- **Dependencies:** **M1c + M3** (M1 is transitively required through M1c). Matches the graph edge `M1c+M3→M4`.
- **Non-goals:** no durable ack/`saved` (M5a/M5b); no metadata conflict machine (M6).
- **Acceptance / tests (land with behavior):** edits during Share survive · same `Awareness` client ID + identity survive · pre-Share undo available after Share · no duplicate initial content · no reload · clipboard failure → visible URL + manual copy · a second browser joins `/{id}` immediately.
- **Unit:** reconciliation delivers post-submission edits; awareness continuity.
- **Integration:** create → attach → second client converges.
- **Playwright:** the acceptance list above (single worker).
- **Manual QA:** type, Share, keep typing during the round-trip, confirm nothing lost; open in a second browser; force a clipboard failure.
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: provider attachment to existing doc+awareness (no reload)`; `feat: share coordinator + in-flight reconciliation`; `feat: transport-boundary validation + message limits`; `feat: Sharing…/Connecting… treatment (no Shared·connected yet)`; each with tests. The Share control is enabled in the **final** commit only when the gate is green.
- **Codex checkpoint:** **mandatory** (Share handoff; doc/awareness/undo continuity).
- **Safe stop:** yes — sharing works; honesty capped below `Shared · connected`.

---

### M5a — Durable acknowledgement + internal state machines
- **Goal:** the internal machines and the ack that make most legal phrases available — **but not `Shared · saved`.**
- **Product contract:** "Always tell the truth about state" (brief principle 4; arch §6, §8).
- **Architecture sections:** §6 (three machines), §8 (ack), §2 (projection).
- **Files touched:** server (emit ack post-commit; **metadata revision field in the protocol from the start**), client reducer, state surface.
- **Includes:** ack payload (`sheetId, serverRevision, committedStateVector, committedMetadataRevision, committedAt`) · state-vector coverage · **`committedMetadataRevision` present in the protocol from the start** · transport machine · validation/sync machine · durability machine · persistence-failure **distinct** from transport-failure · reconnect handling · dirty navigation warning · invalid-link handling.
- **Removed:** `useProviderStatus.ts` + `ConnectionStatus.tsx` old 3-state.
- **Dependencies:** **M2 + M4.**
- **Non-goals:** **no `Shared · saved`** (M5b); no metadata conflict machine (M6).
- **Legal UI after M5a:** `Connecting…` · `Shared · connected` (**only** after valid lookup + completed initial sync) · `Saving…` · `Reconnecting…` · `Not saved — storage failed` · connection failure · `This link is unavailable` (invalid lookup). **Forbidden after M5a: `Shared · saved`.**
- **Acceptance / tests:** `saved` never appears · `Shared · connected` only post-sync · dirty → `Saving…` · injected persistence failure with live transport → storage-failure (not reconnect) · reconnect wording · invalid vs unavailable causes distinct · navigation warning only while dirty.
- **Unit:** phrase-legality map (§6.5); vector subsumption; dirty tracking.
- **Integration:** commit → ack → coverage; persistence-failure injection; internal cause codes.
- **Playwright:** the acceptance list.
- **Manual QA:** edit/pause → `Saving…`; kill persistence; kill transport; open a bad link.
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: durable ack payload (incl. metadata revision)`; `feat: transport/sync/durability reducer`; `feat: persistence-failure vs transport-failure`; `feat: dirty navigation warning`; each with tests.
- **Codex checkpoint:** **mandatory** (ack + state machines).
- **Safe stop:** yes — strong honesty baseline; `saved` still withheld.

---

### M6 — Metadata sync + Download
- **Goal:** title/language conflict-correct and durable; real Download/export.
- **Product contract:** document title + one language; Download/export with appropriate filename and extension (brief §Minimum complete v1; arch §12).
- **Architecture sections:** §12 (metadata state machine + export filename).
- **Files touched:** metadata coordinator (client), server metadata mutation path, **Download/export util**.
- **Includes (metadata):** `serverMetadataRevision` / `localMetadataRevision` / `pendingMetadataMutation` · edits during Share · edits while disconnected · stale-base rejection · **explicit reapply** · **no silent drop** · **no blind replay** · language allowlist.
- **Includes (Download/export — real behavior, owned here, not deferred to M11):** actual Download action · **current live text only** · **title-derived filename** · **language-derived canonical extension** · **filename sanitization** · **safe fallback filename** · **no server upload or persistence** for download.
- **Removed:** nothing.
- **Dependencies:** **M4 + M5a.**
- **Non-goals:** no rich metadata; no auto-replay; `saved` still withheld until M5b.
- **Acceptance / tests:** metadata during Share queued/applied · metadata while disconnected stays pending · stale-base surfaces authoritative + keeps pending · no silent drop / no blind replay · **Download tests: title-derived name · language-derived extension · invalid filename characters sanitized · empty title → safe fallback.**
- **Unit:** metadata state machine; allowlist; **filename derivation + sanitization + fallback.**
- **Integration:** stale-base rejection; metadata durability; reload restores title/language.
- **Playwright:** rename during Share · rename while disconnected · conflict surfaces authoritative + keeps pending · Download produces the expected filename/extension.
- **Manual QA:** rename + change language across connect/disconnect; download and inspect the file name/extension; try an all-symbols title and an empty title.
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: revisioned metadata state machine`; `feat: download/export (title+language filename, sanitized)`; each with tests.
- **Codex checkpoint:** **mandatory** (metadata conflicts).
- **Safe stop:** yes.

---

### M5b — Final legal state wording (`Shared · saved`)
- **Goal:** earn `Shared · saved` once content **and** metadata are durably covered.
- **Product contract:** truthful saved-state (brief principle 4; arch §6/§8/§12).
- **Architecture sections:** §6.5 (saved rule), §8, §12 (metadata leg).
- **Files touched:** state reducer (final coverage rule), state surface copy.
- **Includes:** final **content + metadata coverage rule** · `Shared · saved` · **UI-claim gate tests** · **no `saved` phrase before there is no pending metadata mutation and full durable coverage.**
- **Dependencies:** **M5a + M6.**
- **Non-goals:** no new behavior beyond the phrase gate.
- **Acceptance / tests:** `saved` appears only when content vector covered **and** no `pendingMetadataMutation` **and** metadata revision covered; a new content **or** metadata edit returns `Saving…`.
- **Unit:** the combined coverage predicate.
- **Integration:** ack coverage across content+metadata.
- **Playwright:** `saved`-never-early including a pending metadata mutation blocking it.
- **Manual QA:** edit content → saved; rename → back to Saving until metadata committed.
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: Shared·saved gate (content+metadata coverage)` with tests.
- **Codex checkpoint:** **mandatory** (legal state wording).
- **Safe stop:** yes — the honesty keystone complete.

---

### M7 — Identity, presence, jump/Back, multi-client undo proof
- **Goal:** full live collaboration on the approved architecture.
- **Product contract:** presence, remote cursors/selections, jump + Back, anonymous per-sheet identity (brief §Minimum complete v1; arch §9, §13, §14, §15).
- **Architecture sections:** §9 (undo isolation), §13 (jump/Back), §14 (join-before-sync), §15 (identity/3+), §19 (awareness-boundary limits).
- **Files touched:** `useSessionIdentity.ts` (→ per-sheet `localStorage`, editable), `usePresence.ts` (rebind), jump/Back controller, server heartbeat/limits, presence chip surface.
- **Includes:** per-sheet identity · editable unverified name · per-connection awareness identity · **3+ participant minimum behavior** · deterministic collaborator list · jump-to-collaborator · **single-slot Back** · **multi-client undo isolation proof** (A-undo never removes B; reconnect; multiple tabs) — **reusing the M1 manager; not reimplementing ownership.**
- **Hardening owned here (awareness boundary):** awareness payload limit · awareness rate limit · **heartbeat** · connection cap · stale-presence cleanup.
- **Removed:** per-tab `sessionStorage` identity.
- **Dependencies:** **M4 + M5a.**
- **Non-goals:** no follow mode, no Point, no avatar-pile visuals, no group dashboard; do not re-own the UndoManager.
- **Acceptance / tests:** two-person presence · third participant still renders + keyboard list complete · stale cleanup on close **and** heartbeat timeout · same-browser tabs distinct · **A-undo not B** · undo after reconnect · jump restores collaborator caret · Back restores prior scroll/selection/focus · disconnect-during-jump safe no-op.
- **Unit:** undo origin scoping; jump/Back state; identity storage.
- **Integration:** heartbeat timeout; connection cap.
- **Playwright:** the acceptance list (single worker).
- **Manual QA:** two browsers + a third; jump; interleave edits and undo.
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: per-sheet identity (localStorage, editable)`; `feat: jump-to-collaborator + single-slot Back`; `feat: awareness limits + heartbeat cleanup`; `test: multi-client undo isolation`; each with tests. **Any tracked-origin change requires mandatory Codex review before commit.**
- **Codex checkpoint:** **mandatory** (tracked-origin behavior + awareness lifecycle).
- **Safe stop:** yes — full live collaboration.

---

### M8 — Server-owned Recent versions
- **Goal:** bounded recovery history from durably committed state.
- **Product contract:** bounded Recent versions, no attribution, no restore (brief §History; arch §10).
- **Architecture sections:** §10 (versions), §7 (store).
- **Files touched:** version store, capture service; deletion hook **participates in the lifecycle store**.
- **Includes:** capture from **committed `sourceRevision`** · sequence ordering · dedup · injected-clock coalescing · **transactional hard bound** · a deletion hook that participates in the per-sheet lifecycle store — **but no claim that retention has yet deleted versions** (that proof is M10).
- **Removed:** none (client timeline already gone at M1c).
- **Dependencies:** **M2 + M5a.**
- **Non-goals:** no preview UI (M9); no diff; no named checkpoints; no retention-deletion proof (M10).
- **Acceptance / tests:** bound enforced transactionally · sequence ordering canonical · dedup · pending capture lost on restart is harmless · **no author/cursor/awareness data stored.**
- **Unit:** bound/sequence/dedup; coalescing under injected clock.
- **Integration:** capture across commits; restart behavior; eviction; no-attribution assertion.
- **Playwright:** none (UI is M9).
- **Manual QA:** drive captures via integration; inspect rows.
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: server-owned version capture (sourceRevision, sequence)`; `feat: coalescing + transactional hard bound`; each with tests.
- **Codex checkpoint:** **mandatory** (version capture/bound).
- **Safe stop:** yes — versions exist server-side, not surfaced.

---

### M9 — Local historical preview
- **Goal:** the approved read-only Recent-versions interaction, with a usable Versions surface.
- **Product contract:** local, read-only, non-disruptive preview; copy-not-restore (brief §History; arch §16, D-005).
- **Architecture sections:** §16 (hidden-inert live + preview), §10 (list/fetch).
- **Files touched:** version-preview controller, editor (hidden-inert live + separate read-only view), **Versions drawer + preview banner** (Paper), server list/fetch endpoints.
- **Includes:** **usable Versions surface** · loading state · version fetch · **hidden/inert live editor** · **separate read-only preview** · awareness-cursor suppression · Return-to-current · focus/scroll restoration · copy-preview-text · **no restore** · **no historical presence replay.**
- **Removed:** any residue of the prototype destroy/recreate preview (already gone).
- **Dependencies:** **M7 + M8** (preview needs live collaborator behavior, awareness suppression, two-client tests, and a durable version source).
- **Non-goals:** no restore; no diff.
- **Acceptance / tests:** collaborator edits continue during preview · live `Y.Doc` never mutates from preview · return shows latest text incl. edits made during preview · undo stack survives · focus/scroll restored · hidden editor excluded from the a11y tree · no cursor replay.
- **Unit:** preview controller lifecycle (single instance; cleanup on return).
- **Integration:** bounded list/fetch.
- **Playwright:** the acceptance list (two clients).
- **Manual QA:** two browsers; one previews while the other types; return picks up edits; copy from a version.
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: versions drawer + fetch`; `feat: hidden-inert live + read-only preview + copy`; `feat: return-to-current (focus/scroll restore)`; each with tests. **No selectable version merges before the non-mutating preview path is complete.**
- **Codex checkpoint:** **mandatory** (D-005 invariant; preview lifecycle).
- **Safe stop:** yes — recovery complete.

---

### M10 — Retention and final expiry
- **Goal:** lifecycle-correct retention and coherent deletion.
- **Product contract:** disclosed retention; no permanence (brief §Access and persistence; arch §11).
- **Architecture sections:** §11 (retention/active-room), §19 (residual limits).
- **Files touched:** retention service, room lifecycle (`closing`), sweep.
- **Retain only (per the corrected boundary):** retention window · startup sweep · `expiry-pending` · `closing` state · **serialized final deletion** (lifecycle-lock) · cleanup retry · **no queued-write resurrection** · **no reconnect after `closing` begins.**
- **Proves full expiry deletes:** current state · metadata · versions · retention metadata · **idempotency records** — coherently in one transaction.
- **Removed:** any permissive path-derived room-ID handling not already gone.
- **Dependencies:** **M3 + M5a + M8.**
- **Non-goals:** no auth/ownership/revocation; connection/payload limits already live in M3/M4/M7 (not re-owned here).
- **Acceptance / tests (race + retry live here):** active room not deleted · expiry only after final close · queued write cannot resurrect a reaped sheet · reconnect cannot enter after `closing` · failed cleanup retries safely · full expiry removes all five record kinds.
- **Unit:** retention math (fake clock, owned here); `closing` transitions.
- **Integration:** expiry-pending → final close; race rejection; failed-cleanup retry; five-record deletion.
- **Playwright:** unavailable link after expiry (fake-clock seam).
- **Manual QA:** exercise expiry + races via integration.
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: last-activity retention + sweeps (fake clock)`; `feat: serialized final-expiry + closing state`; `test: expiry races + coherent deletion`; each with tests.
- **Codex checkpoint:** **mandatory** (final deletion/races).
- **Safe stop:** yes — server lifecycle-correct.

---

### M11 — Final Paper convergence and accessibility
- **Goal:** converge the incrementally-built Paper UI and complete the accessibility audit. **No first-time behavioral UI** — every surface already exists from M1/M4/M5/M7/M9.
- **Product contract:** the full design brief on Paper.
- **Architecture sections:** consumes §2/§6 wording; §16 preview; §13 jump/Back.
- **Files touched:** Paper theme tokens, shell convergence, `codeMirrorTheme.ts` final, `tokens.css`/`global.css`.
- **Includes only:** final Paper convergence · **responsive behavior** · **keyboard audit** · **visible focus** · **live-region audit** · **reduced-motion** · **contrast + color-independent status meaning** · visual polish.
- **Non-goals:** **no Ink, no Graphite, no theme switcher**; no new behavior; no first-time UI.
- **Dependencies:** **M5b + M7 + M9 + M10.**
- **Acceptance / tests:** every design-brief screen renders on Paper; keyboard flow complete; focus visible; live regions match header words; reduced-motion honored; read-only semantics correct; status survives grayscale; responsive non-breaking.
- **Unit:** state-phrase + presence-chip rendering.
- **Playwright:** a11y/keyboard/reduced-motion/contrast pass.
- **Manual QA:** full design-brief screenshot walk (empty draft, shared two-cursor, Share confirmation, jump, versions closed, past preview, return).
- **Commands:** full set + `test:integration`.
- **Commits:** `feat: paper convergence (tokens, shell, theme)`; `test: a11y + keyboard + reduced-motion + contrast`; each with tests.
- **Codex checkpoint:** light–medium (visual/a11y; copy legality re-checked vs §6).
- **Safe stop:** yes — portfolio-ready.

---

### M12 — Final soak and documentation
- **Goal:** stabilize and package. **No deferred de-flaking** — every earlier milestone already left its tests reliable.
- **Product contract:** success criteria (brief §Success criteria).
- **Files touched:** docs only (README, demo script, reconstruction QA checklist), plus architecture-note updates **only if implementation truth changed**.
- **Includes:** final soak runs · **final QA checklist** · README · architecture notes if truth diverged · demo script · screenshots · portfolio packaging.
- **Non-goals:** no new features; no scope change; **no flaky-test debt to pay down** (it must not exist).
- **Dependencies:** all.
- **Acceptance:** full suite green and stable across repeated runs; docs reflect implementation truth; screenshot + demo plans exist.
- **Commands:** full set + `test:integration` (repeated for stability).
- **Commits:** `docs: reconstruction README + demo script`; `docs: reconstruction QA checklist`.
- **Codex checkpoint:** light.
- **Safe stop:** yes — done.

---

## 4. Per-milestone template (field legend)

Each milestone supplies: **Goal · Product contract · Architecture sections · Files touched · New modules · Files removed · Dependencies · Non-goals · Acceptance criteria · Unit / Integration / Playwright tests · Manual QA · Commands · Atomic commit sequence · Codex checkpoint · Safe stop.** Filenames are indicative; the seam is the contract.

---

## 5. Dependency graph (corrected)

```
M0a baseline ─────────────► M1 local draft ──► M1c client cleanup ──┐
                                                                    │
M0b sqlite/toolchain ─────► M2 persistence + lifecycle queue ──► M3 durable create API
                                                                    │
                                          M1c + M3 ─────────────────┴─► M4 complete Share handoff
                                                                          │
                                             M2 + M4 ───────────────────► M5a ack + state machines
                                                                          │
                                             M4 + M5a ──────────────────► M6 metadata sync + Download
                                                                          │
                                             M5a + M6 ──────────────────► M5b final legal state wording
                                                                          │
                                             M4 + M5a ──────────────────► M7 identity/presence/jump + multi-client undo
                                                                          │
                                             M2 + M5a ──────────────────► M8 server-owned versions
                                                                          │
                                             M7 + M8 ───────────────────► M9 local preview
                                                                          │
                                             M3 + M5a + M8 ─────────────► M10 retention/final expiry
                                                                          │
                                    M5b + M7 + M9 + M10 ────────────────► M11 Paper/a11y convergence
                                                                          │
                                             all ─────────────────────► M12 soak + docs
```

Explicit edges: `M0a→M1`, `M1→M1c`, `M0b→M2`, `M2→M3`, `M1c+M3→M4`, `M2+M4→M5a`, `M4+M5a→M6`, `M5a+M6→M5b`, `M4+M5a→M7`, `M2+M5a→M8`, `M7+M8→M9`, `M3+M5a+M8→M10`, `M5b+M7+M9+M10→M11`, `all→M12`.

**Clarifications:**
- **M3 and M4 are one release gate** — M3 merges server-only/UI-unexposed; the Share control appears only when the M4 gate is green.
- **M5a and M5b are separate by design** — `Shared · saved` waits for metadata coverage (M6) between them.
- **Minimum UI lands incrementally** (§12): M1, M4, M5, M7, M9.
- **Every milestone must be green independently** (builds + all tests pass at each merge).

**Safe parallelism (dependency-correct):**
- **M6, M7, and M8** may each proceed once **their own** dependencies are satisfied (M6: M4+M5a · M7: M4+M5a · M8: M2+M5a) — they touch mostly disjoint modules and can sit on separate branches.
- **M5b** waits for **M5a + M6**.
- **M9** cannot begin until **M7 + M8** are complete.
- **M10** cannot begin until **M3 + M5a + M8** are complete — it is **not** startable immediately after M5a (it needs the version store from M8 and the create API from M3).
- **M0b** can run in parallel with **M0a/M1**.
- Merge **M8 before M9**, and **M6 before M5b**.

---

## 6. UI-claim gates

No phrase renders before its proof exists.

| Phrase | Technical proof | Test | Earns it | Forbidden before |
|---|---|---|---|---|
| Local draft — not uploaded | no provider, no remote object | no-socket/no-sheet-before-Share | **M1** | M1 |
| Sharing… | idempotent create request in flight | create round-trip | **M4** | M4 |
| Connecting… | attach / sheet-validation, initial sync not complete | join-before-sync | **M4** | M4 |
| Shared · connected | valid lookup **+ completed initial sync**, state not yet durably covered | state-grammar map | **M5a** | M5a |
| Saving… | dirty: current vector not durably covered | dirty-after-edit | **M5a** | M5a |
| Reconnecting… | transport interrupted, durability unchanged | reconnect behavior | **M5a** | M5a |
| Not saved — storage failed | persistence-failed with live transport | injected persistence failure | **M5a** | M5a |
| connection failure (distinct) | transport failed | transport≠storage | **M5a** | M5a |
| This link is unavailable — *invalid lookup* | typed invalid/not-found lookup result | invalid-cause lookup test | **M5a** | M5a |
| This link is unavailable — *expired sheet* | retention expiry + unavailable lookup | expiry → unavailable test | **M10** | M10 |
| **Shared · saved** | committed vector subsumes current Yjs state **and** no pending metadata mutation + metadata revision covered | `saved`-never-early incl. pending-metadata block | **M5b** | **M5b** (never before) |
| Viewing version … — read-only | version served from durable store; live doc untouched | preview non-disruption | **M9** | M9 |

---

## 7. Removal / retirement schedule

| Item | Bypass (stop importing) | Delete | Notes |
|---|---|---|---|
| `editorSeed.ts` | M1 | **M1c** | Draft starts empty. |
| Hardcoded `demo` room | M1 | **M1** | Route resolver replaces it. |
| Module-level always-connected provider (`room.ts`) | M1 | **M4** | Factory finalized at attach. |
| Y.Array snapshot wiring + `snapshots.ts` | M1 | **M1c** | Forbidden permanent history. |
| `useSnapshots.ts` | M1 | **M1c** | Reads the retired Y.Array. |
| `timeline.ts` utilities | M1 | **M1c** | Marker math for the rail. |
| `TimelineScrubber.tsx` + rail/marker/drag | M1 | **M1c** | Permanent-timeline chrome. |
| Timeline + seed **e2e** tests | M1 | **M1c** | Behavior removed at M1. |
| `snapshots.test.ts`, `timeline.test.ts`, `TimelineScrubber.test.tsx`, `App.test.tsx` | M1 | **M1c** | Subjects removed. |
| **Server `STARTER_CODE`** | — | **M3** | Removed when durable create replaces it — **not** M1c. |
| Obsolete status wording (`connecting/live/offline`, `echo://`, Live pill) | M1 (bypassed) | **M5a** (logic) / **M11** (final visuals) | Replaced by the state grammar. |

**Rule:** dead, unreachable client code may exist **only** in the M1→M1c window; M1c closes it. Two active architectures never coexist.

---

## 8. Commit strategy

- **Behavior and its proving tests land in the same commit.** No trailing "add tests" commit for already-merged behavior.
- **Server / client / UI may be separate preparatory commits only when each commit builds and passes all tests.**
- **No visible Share control before the complete M4 gate.**
- **No legal state wording before its state-machine tests** (M5a/M5b).
- **No selectable version before the non-mutating preview path is complete** (M9).
- **Deletion commits may be separate** when the deleted source is already unreachable (M1c).
- **Docs commits only when implementation truth diverges** from the approved docs.
- **Agents must not commit automatically.**

Suggested messages are listed per milestone (§3).

---

## 9. Review strategy

Each milestone's **Codex checkpoint** field (§3) is authoritative; this is the consolidated view.

**Mandatory Codex review before committing** (architecture-sensitive):
- M0b — SQLite/toolchain decision (`docs/SQLITE_DECISION.md`)
- M2 — schema/persistence/write queue
- M3 — durable create API
- M4 — Share handoff (doc/awareness/undo continuity)
- M5a — durable acknowledgement + state machines
- M6 — metadata conflicts
- M5b — legal state wording (`Shared · saved` gate)
- M7 — tracked-origin behavior + awareness lifecycle (**any** tracked-origin change)
- M8 — version capture/bound
- M9 — preview invariant (D-005)
- M10 — final deletion/races

**Lighter review sufficient:**
- M0a — baseline probes
- M1c — deletion of already-unreachable source
- M1 — Paper shell (after behavior correctness is established)
- M11 — visual/a11y polish
- M12 — documentation/packaging

---

## 10. Validation commands

Every **code** milestone ends with:

```
npm run test
npx tsc --noEmit
npm run build
npm run test:e2e
git diff --check
```

**Integration command:** `npm run test:integration` **does not exist yet** — it is **created in M2 bootstrap** (package script + vitest include). From **M2 onward**, every server/persistence milestone (M2, M3, M4, M5a, M6, M5b, M7, M8, M9, M10, M11, M12) additionally runs `npm run test:integration`. It is not cited for M0a/M0b/M1/M1c because it does not exist during those milestones.

`npm run build` runs `tsc -b && vite build`; keep it green at every milestone.

---

## 11. Implementation risks

| # | Risk | Prevention | Detection | Test coverage | Rollback |
|---|---|---|---|---|---|
| R1 | Losing edits during Share | Same `Y.Doc`; vector reconcile after attach (§4.4) | submitted vs current vector diff | M4 | Revert M4; stay draft-only |
| R2 | False `saved` | Gate on content **and** metadata coverage (§6/§8/§12) | `saved` absent while dirty/pending-metadata | M5a/M5b/M6 | Revert M5b; cap at `connected` |
| R3 | Stale async writes | Per-sheet queue + monotonic revision (§7) | reject older-revision writes | M2 | Revert M2 queue |
| R4 | Metadata conflicts / silent drop | Revisioned machine; keep pending for reapply (§12) | stale-base surfaces authoritative | M6 | Revert M6; title/language read-only |
| R5 | Undoing remote edits | Client-owned manager, safe tracked-origins (§9) | A/B undo isolation | M1 + M7 | Revert to no-undo |
| R6 | Version growth | Transactional bound + dedup (§10) | row-count post-eviction | M8 | Revert M8 |
| R7 | Cleanup/write races | Serialized final-expiry; reject-after-`closing` (§11) | race integration tests | M10 | Revert M10 |
| R8 | Awareness duplication | One `Awareness` reused; broadcast after attach (§4.6) | same client-ID assertion | M4 | Revert M4 handoff |
| R9 | Flaky multi-client tests | Single-worker Playwright; deterministic IDs/clock; explicit sync waits | CI flake rate | M7/M9; **no debt carried to M12** | Quarantine spec; keep worker=1 |
| R10 | Retaining timeline behavior | Bypass M1, delete M1c; grep gate | no timeline testids/refs | M1/M1c | Re-delete; tag preserves history |
| **R-DEP1** | SQLite binding not chosen/installed | **M0b spike** before M2 | M2 blocked until resolved | n/a | Defer M2; M1/M1c ship regardless |
| **R-DEP2** | `@codemirror/search` not installed | Approve with the M1 slice | M1 Find absent until added | M1 Find test | Ship M1 without Find (weaker) or add the package |

---

## 12. First recommended coding slice

**Slice = M0a (baseline characterization) + M1 (local draft session)**, with **M0b (SQLite spike)** running in parallel as a decision artifact (no code).

Verified against the repo: `main.tsx → App → RoomPage roomId="demo"` connects on mount and the server seeds every room, so a local, unconnected draft at `/` is genuinely new, client-only, and self-contained. It is the smallest change that establishes the "local until shared" invariant and the correct `Y.Doc` / `Awareness` / `Y.UndoManager` ownership every later milestone depends on, and it leaves a shippable local scratch editor (with Find and undo) even if work paused there.

The slice must: render a visible **local draft at `/`**; use **one unconnected `Y.Doc`**, **one client-owned `Awareness`** (not broadcast), **one external `Y.UndoManager`** (safe origins; native history excluded); perform **no remote connection**; **bypass** (not delete) server seeding for the root draft (the draft never connects, so `STARTER_CODE` stays dormant); include tests proving **no upload and no WebSocket before Share** and that **Find/search works**; and **stop before** Share (M3/M4) and SQLite (M2). Deletion of the bypassed prototype code is the **separate M1c** commit.

Two dependency approvals accompany the slice: **R-DEP2** (`@codemirror/search`, for Find) with M1, and **R-DEP1** (SQLite binding) via the parallel M0b spike before M2.

---

## Non-goals

No code changes · no package changes · no dependency installation · no implementation · no auth · no AI · no chat · no file tree · no execution · no multi-room UI · no restore · no branching · no permanent timeline · no Point in v1 · no deployment plan · no repository rename · no Figma work. Tags `week1-demo` and `prototype-v1` are not touched.

---

*Planning only. This document creates no code, installs nothing, and changes no product scope or architecture decision. It sequences the approved `RECONSTRUCTION_ARCHITECTURE.md` into small, test-driven, atomically-committable milestones with UI claims gated by real technical guarantees. Implementation begins only when a slice is explicitly authorized.*
