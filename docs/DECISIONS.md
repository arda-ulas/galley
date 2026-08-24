# Galley — Decision Log

Decisions are recorded here when they have a non-obvious rationale or when a reasonable alternative was considered and rejected.

> **Status legend** — each decision below carries one status relative to the canonical `docs/PRODUCT_BRIEF.md`:
>
> - **Active** — still holds for reconstruction.
> - **Superseded** — replaced by a product-brief decision; the original rationale was correct for `prototype-v1`.
> - **Historical** — a `prototype-v1` implementation choice; not a reconstruction mandate.
> - **Under review** — carried forward as an open detail; cadence/bounds/mechanism not yet settled.

---

## D-001 — No router library (week 1)

**Status**: Superseded — the reconstruction creation model (local draft → Share creates a remote sheet) replaces the single hardcoded `/r/demo` route; routing is an unresolved architecture decision.

**Decision**: Hardcode `/r/demo` in `App.tsx`. No React Router, TanStack Router, or similar.

**Rejected alternatives**: React Router v7, TanStack Router.

**Reason**: There is only one meaningful route in week 1. Adding a router introduces config, lazy loading decisions, and loader patterns that add no value. If multiple rooms are added later, a router can be dropped in with one refactor.

---

## D-002 — sessionStorage for tab identity, not localStorage

**Status**: Superseded — reconstruction uses anonymous per-sheet/per-browser guest identity; per-tab `sessionStorage` identity was correct for the two-tabs-one-browser prototype demo only.

**Decision**: Per-tab identity (UUID, name, color) is stored in `sessionStorage`.

**Rejected alternatives**: `localStorage`, server-assigned cookie, URL param.

**Reason**: `sessionStorage` is tab-scoped by the browser. Two tabs in the same browser get distinct sessions automatically. `localStorage` would share state between tabs, making two tabs appear as the same user. Server-assigned identity requires a round trip and storage. URL params would expose identity in the address bar and complicate the URL.

---

## D-003 — Snapshots stored in Y.Array on the shared Yjs doc

**Status**: Under review — Recent versions storage is an unresolved architecture decision; the Y.Array mechanism may or may not carry forward.

**Decision**: Snapshots are pushed into `doc.getArray('snapshots')` rather than a local React state array or a server-side store.

**Rejected alternatives**: React `useState`, server REST endpoint, IndexedDB.

**Reason**: Storing snapshots in Yjs means all connected tabs see the same timeline without extra sync logic. If Tab A takes a snapshot, Tab B's timeline updates automatically. `useState` would produce divergent timelines per tab. A server endpoint would require a backend. IndexedDB adds complexity and doesn't survive server restart anyway.

---

## D-004 — No database or durable persistence (week 1)

**Status**: Superseded — reconstruction retains shared sheets under a disclosed service policy; in-memory-only state was a week-1 scope choice, not a reconstruction rule.

**Decision**: Restarting the y-websocket server clears all room state.

**Reason**: The demo is presented in a single sitting. Persistence adds infrastructure (Postgres, Redis, or SQLite). The week-1 win condition does not require state to survive a server restart. This can be added in week 2 with `y-leveldb` or a Postgres provider.

---

## D-005 — Past mode is local-only, does not affect other users

**Status**: Active — the local-only historical-preview invariant is an approved reconstruction product property. Only the invariant itself remains active: viewing a historical version must not mutate the live collaborative document. The prototype's timeline UI, "Return to now" interaction, and specific Y.Doc/editor swap mechanism remain historical implementation details.

**Decision**: Entering past mode does not pause or rewind the shared Yjs document.

**Rejected alternative**: Broadcast a "viewing past" signal and lock the document for everyone.

**Reason**: Locking the document for all users is an extremely disruptive operation that would break other users' ability to type. Past mode is a personal, read-only view. The correct design is: the local editor is replaced with the snapshot text in read-only mode while the shared Yjs doc continues to accumulate changes in the background. Returning to "now" re-attaches the live editor.

---

## D-006 — Amber palette hardcoded as CSS custom properties

**Status**: Historical — Amber is the `prototype-v1` visual system, now superseded. The current design direction is `docs/DESIGN_BRIEF.md` (Paper, first-pass). The CSS-custom-property token *technique* may still be reused; the Amber *palette* is not active.

**Decision**: Colors defined as `--token` CSS custom properties in the global stylesheet, referenced via Tailwind arbitrary values `bg-[var(--token)]`.

**Rejected alternatives**: Tailwind config `theme.extend.colors`, CSS-in-JS, inline styles.

**Reason**: Tailwind v4 is CSS-variable-first. Custom property tokens work cleanly with Tailwind arbitrary values and are easy to override for past mode (swap `--editor-bg` to `--past-bg` with a single class toggle). Putting colors in `tailwind.config.ts` works too but requires more boilerplate and doesn't give the runtime flexibility needed for the live→past transition.

---

## D-007 — No shadcn component generator (week 1)

**Status**: Active — only the selective use of focused UI primitives remains active. The timeline-marker example, Amber-based rationale, and prototype-specific component choices below are historical context, not reconstruction requirements.

**Decision**: Use shadcn/ui primitives only when they add genuine value (e.g., Tooltip for timeline markers). Do not run the full shadcn init or generate a component library.

**Reason**: The Amber visual design diverges significantly from shadcn's default aesthetic. Running the generator creates files that all need to be overridden. It's faster to write focused primitives or use `@radix-ui` directly.

---

## D-008 — Snapshot debounce at 1500 ms

**Status**: Under review — Recent versions capture cadence and bound are open design details in the product brief; 1500 ms is not yet a settled reconstruction value.

**Decision**: Wait 1500 ms of Y.Text inactivity before capturing a snapshot.

**Rejected alternatives**: 500 ms (too noisy), 3000 ms (too slow feedback on timeline), every N characters.

**Reason**: 1500 ms is long enough to skip mid-word snapshots but short enough that a user sees a marker appear within 2 seconds of pausing. Character-count triggers would snapshot mid-word during fast typing.

---

## D-009 — Seed starter code server-side at room creation time

**Status**: Historical — the reconstruction creation model opens a local draft and creates the remote sheet on Share. The race-safety reasoning remains historical engineering evidence; no replacement seeding mechanism is approved.

**Decision**: The starter TypeScript snippet is inserted into `Y.Text("content")` by the server (`server/index.mjs`) inside `getRoom()`, atomically when the room is first created. No client-side seeding.

**Rejected alternative**: Client-side seeding after the `synced` event — the first tab to connect checks `doc.getText('content').toString() === ''` and inserts the seed. This is a race: two tabs opening simultaneously can both observe an empty `Y.Text` before either has applied its insert, causing the seed to appear twice.

**Reason**: Node.js is single-threaded. `getRoom()` is called synchronously on each WebSocket connection. The first call creates the room and applies the seed; every subsequent call returns the already-seeded room. No two concurrent connections can both observe an empty room. This guarantees exactly one insertion regardless of how many tabs open simultaneously.

**Canonical source**: `src/lib/editorSeed.ts` exports the `STARTER_CODE` constant. `server/index.mjs` imports and seeds it at room creation time. These two must be kept in sync.

---

## D-010 — No historical cursor replay

**Status**: Active — historical preview shows text only; cursor replay remains out of scope. The prototype-era suggestion that cursor replay could be added "post-week-1" is historical commentary and does not authorize it for post-v1. Historical cursor replay remains excluded unless the canonical product brief is explicitly changed.

**Decision**: Snapshots store only the full document text, not cursor positions. Past mode shows old code but not where cursors were.

**Reason**: Replaying cursor history requires storing awareness state per snapshot, which multiplies storage significantly and complicates the replay logic. The week-1 win condition is code reconstruction, not cursor reconstruction. This can be added post-week-1 if desired.

---

# Reconstruction decisions

Durable decisions taken during the reconstruction (`reconstruction/collab-first`). Unless noted, these are **Active (reconstruction, as-built at `3214cef`)** — they hold for the current implementation and reflect shipped behaviour, not just intent. Product-scope authority still rests with `docs/PRODUCT_BRIEF.md`; the technical design contract is `docs/RECONSTRUCTION_ARCHITECTURE.md`.

---

## D-011 — Share adopts the draft without remounting the editor

**Status**: Active (reconstruction) — shared-draft adoption milestone.

**Decision**: On Share, the collaboration provider attaches to the draft's **existing** `Y.Doc`, `Awareness`, and `Y.UndoManager`; no collaboration primitive and no `EditorView` is reconstructed.

**Reason**: Reusing the exact primitives is the only way to preserve selection, scroll, in-flight edits, and — critically — the undo stack across the handoff, so a pre-Share edit stays undoable after Share. Tearing down and rebinding would drop editor state and undo history and risk a visible remount.

---

## D-012 — Durable create is idempotent by a per-draft creation token

**Status**: Active (reconstruction).

**Decision**: `POST /api/sheets` is keyed by a per-draft creation token (a UUID). A retried or lost-response create collapses onto the same sheet; a stale token can recover an already-created sheet rather than minting a second one.

**Reason**: Share crosses a network boundary where a response can be lost after the server has already committed. Token idempotency makes the create safely retryable and recoverable without orphaning or duplicating sheets.

---

## D-013 — Authoritative metadata comes from bootstrap after adoption

**Status**: Active (reconstruction).

**Decision**: After adoption, title and language are reconciled from the server's `GET /api/sheets/{id}` bootstrap response and shown read-only.

**Reason**: A stale-token recovery (D-012) can return an existing sheet whose title/language differ from the fresh local draft. The durable sheet's values are authoritative; presenting the fresh local values as if they were the sheet's would be untruthful.

---

## D-014 — Local metadata must not flash while reconciliation is pending

**Status**: Active (reconstruction).

**Decision**: While the authoritative bootstrap (D-013) is still in flight, the locked shared view shows neutral placeholder metadata — never the fresh local title/language.

**Reason**: Ownership has transferred at adoption, so the local values are no longer authoritative. Showing them transiently, even for one frame, would briefly assert something untrue about the durable sheet.

---

## D-015 — Shared-sheet sessions use generation-safe, single-shot lifecycle ownership

**Status**: Active (reconstruction).

**Decision**: Every shared-sheet open is tagged with a generation id and an AbortController. Stale-generation results/callbacks are ignored (and any READY controller they carry is disposed); the open lifecycle is totalized (never rejects unexpectedly); cleanup latches the outcome before disposing, so a terminal emitted during disposal cannot recurse or change the outcome, and the controller is disposed exactly once.

**Reason**: React StrictMode double-invocation, route changes, and provider terminal callbacks can otherwise publish stale sessions into a newer one, double-dispose controllers, or reorder the outcome. Generation identity plus an outcome latch makes the async lifecycle deterministic and leak-free.

---

## D-016 — Reset and shutdown settle barrier-held creates before clearing/closing storage

**Status**: Active (reconstruction).

**Decision**: The test reset endpoint settles and **awaits the currently barrier-held create, if any**, before disposing rooms and clearing persisted rows. Server shutdown settles barrier-held work, then drains and closes the HTTP/server resources before closing SQLite. This does **not** claim that reset independently tracks every arbitrary normal create request; only the test create barrier gives it a create to await.

**Invariant**: test-held work cannot resume and write **after reset returns**, and held work cannot resume against **closed storage during shutdown**.

**Reason**: Clearing or closing storage under a resumed create is a data race that can corrupt state or crash the resumed request. Settling the held create (and, for shutdown, draining server resources) first makes reset/shutdown ordering deterministic and safe.

---

## D-017 — Deterministic Share tests use a test-only, generation-scoped create barrier

**Status**: Active (reconstruction) — test infrastructure; **absent in production**.

**Decision**: Under the server test flag only, a create barrier can hold a create, expose a server-reached acknowledgement (`GET /__test/hold-create/reached?holdId=…`), and be released by `holdId`. Re-arming while a create is entered and active returns **HTTP 409**; a stale/unknown `holdId` is inert. The barrier is never constructed in normal mode.

**Reason**: Proving "an edit made while Share is in flight survives" requires deterministically parking the create at the server without sleeps or timing assumptions. Generation-scoping (`holdId`) and the 409 guard keep the barrier from cross-acknowledging or blocking a later generation.

---

## D-018 — Stable historical tags are never moved

**Status**: Active — carried forward from prototype governance.

**Decision**: `week1-demo` (`ca8bb48`) and `prototype-v1` (`4147372`) are immutable checkpoints; reconstruction work never moves or recreates them.

**Reason**: They preserve the earlier timeline-first prototype as verifiable historical evidence. Moving them would destroy that record. See `AGENTS.md` / `CLAUDE.md` checkpoint protection.
