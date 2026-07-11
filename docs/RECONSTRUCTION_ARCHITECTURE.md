# Reconstruction Architecture — Galley (working name)

> **Status: proposed (revision 2). Not yet approved. No implementation authorized by this document.**
>
> - `docs/PRODUCT_BRIEF.md` is the canonical **product** contract.
> - `docs/DESIGN_BRIEF.md` is the canonical **visual/interaction** contract; it governs final UI copy. This document defines which state **claims are technically legal**.
> - `docs/ARCHITECTURE.md` describes `prototype-v1` only and is **historical**.
> - Revision 2 resolves the Codex review. Every UI-state claim below maps to a concrete durable proof; where the strongest honest claim depends on a not-yet-built mechanism, that is stated, not assumed.
> - **Working name** "Galley" is **provisional** (legal clearance incomplete). Proposed UI copy uses product-neutral wording ("the sheet").
>
> **Last updated:** 2026-07-11.

---

## 0. Current-implementation inspection and subsystem classification

Assessed against the code on `reconstruction/collab-first`, and — for the undo claims — against the installed `node_modules/y-codemirror.next/src/*` and `node_modules/yjs/src/utils/UndoManager.js` sources.

| Subsystem | Current state (inspected) | Classification |
|---|---|---|
| Yjs two-step sync protocol handling (server + client) | `y-protocols/sync`; standard | **Reusable** |
| Awareness relay + cleanup-on-close **concept** | `y-protocols/awareness`; `removeAwarenessStates` on socket close | **Reusable** (concept; wiring restructured) |
| CodeMirror ↔ Yjs binding (`yCollab`) | `y-codemirror.next` with `{ undoManager: false }` (undo fully disabled) | **Reusable with modification** |
| Local-only past-preview **invariant** (D-005) | Live `Y.Doc` never mutated during preview | **Reusable (invariant only)** |
| Past-preview **mechanism** (destroy/recreate view) | Full editor teardown per switch | **Replace** (superseded by the hidden-inert live editor + separate preview; decided in §16) |
| Snapshot recorder (`src/lib/snapshots.ts`) | 1500 ms client debounce → **unbounded** shared `Y.Array` | **Replace** |
| Timeline scrubber + `src/lib/timeline.ts` | Permanent rail, drag scrub, markers | **Replace → historical reference only** |
| Room routing (`App.tsx`, `room.ts`) | Hardcoded `roomId="demo"`; connects on mount | **Replace** |
| Server-side seeding (`STARTER_CODE`) | Seeded into every room at creation | **Replace → historical reference only** |
| `sessionStorage` per-tab identity | Per-tab; name+color; name not editable | **Replace** (per-sheet `localStorage`; editable name; see §15) |
| Server **room lifecycle / composition** (monolithic `rooms` Map, path-derived IDs, no persistence hook, no heartbeat, no limits, no error codes, no durable ack, `/__test/reset` coupling) | `server/index.mjs` | **Replace / restructure** (see §20) |
| Local draft phase | — | **Missing** |
| Share (create remote sheet + copy link) | Only copies `window.location.href` | **Missing** |
| Durable persistence / retention | In-memory Map; wiped on restart and `/__test/reset` | **Missing** |
| Sheet identity | Hardcoded `demo` | **Missing** |
| Safe per-user undo/redo | Disabled; no native history either | **Missing** |
| Truthful multi-state grammar | `connecting / live / offline` only | **Missing** |

**Summary of what the reconstruction must build (revision-1 count wording removed):**
- **Missing subsystems** (do not exist today): local draft phase · Share (create remote sheet + copy link) · durable persistence / retention · sheet identity · safe per-user undo/redo · truthful multi-state grammar.
- **Replace subsystems:** snapshot recorder · timeline scrubber (→ historical reference only) · room routing · server-side seeding (→ historical reference only).
- **Identity is replaced** (per-tab `sessionStorage` → per-sheet `localStorage`, editable name; §15).
- **Server room lifecycle / composition is replaced or substantially restructured** (§20), on top of a small reusable protocol kernel.

No single numeric total is given, because the rows above are drawn from the same inventory table and grouping them into one count would misrepresent it.

**Server reclassification (do not call the current server broadly reusable):** only the Yjs sync/awareness **protocol handling** is reusable. Room lifecycle, routing, persistence, acknowledgements, validation, heartbeat, and error handling are replaced or substantially restructured (§20).

---

## 1. System overview

- **Browser client** — Vite/React SPA. Hosts the CodeMirror editor, the local draft (unconnected local `Y.Doc`), the shared doc after Share, awareness/presence, the client-owned `Y.UndoManager`, the local-only past preview, jump/Back, and the truthful-state UI. Owns no durable data except the anonymous guest identity in browser storage.
- **Collaboration server** — a **protocol kernel** (reused: Yjs sync + awareness relay) wrapped in a **replaced composition layer**: sheet lifecycle, SQLite persistence, durable acknowledgements, validation, heartbeat, and typed errors.
- **Persistence boundary** — one embedded durable store (SQLite; §7). Everything the product promises to *keep* lives behind it; everything ephemeral stays in front and is never claimed durable.
- **Sheet identity** — server-minted URL-safe non-sequential id, at Share (§5, §4).
- **Guest identity** — anonymous, generated, editable, per-sheet, browser-stored, unverified (§15).
- **Recent versions** — server-owned, bounded, retained-with-the-sheet, read-only-previewed locally, copy-not-restore (§10, §16).
- **Export/download** — pure client serialize-to-file with a sanitized language-appropriate name (§12). No server involvement.
- **Local historical preview** — client-only, read-only, non-mutating to the live `Y.Doc` (D-005; §16).

---

## 2. Product-facing lifecycle states

The product surface shows the design brief's phrases. These are the **projection** of the three internal machines in §6; here is the user-visible summary, with the durable proof each phrase requires.

| Product state | Requires (proof) | Data-loss risk |
|---|---|---|
| Local draft | none — no remote object exists | High on reload; **not promised to survive** |
| Sharing… | idempotent create in flight (§4) | Draft intact; no remote object yet if it fails |
| Shared · connected | valid sheet + initial sync complete, current local state not yet durably covered | Edits at risk until covered |
| Saving… | dirty: current local vector not subsumed by committed durable vector | Edits at risk until committed |
| Shared · saved | committed durable vector **subsumes** current local Yjs state **and** metadata revision (§6, §8) | None for the covered state |
| Reconnecting… | transport interrupted (durability state unchanged) | Buffered edits lost only if the tab closes before reconnect |
| Not saved — storage failed | persistence-failed **with live transport** (§6) | Real: unpersisted edits |
| (connection failure) | transport failed (distinct from storage) | Real if dirty |
| This link is unavailable | sheet lookup miss (never-existed or expired) | N/A |
| Viewing version … — read-only | version served from durable store; live doc untouched | None (D-005) |

---

## 3. Local draft before Share

- **Where draft text lives:** client memory only — CodeMirror state backed by an **unconnected local `Y.Doc`** (no provider). Using a real `Y.Doc` from the first keystroke lets Share hand the *exact* existing state to the server with no text round-trip and **no doc swap** (§4).
- **Local structures:** `Y.Text("content")`; draft title/language held as client state (and mirrored into the metadata contract at Share, §12); **one client-owned `Awareness` instance bound to the draft `Y.Doc`**, created before Share and reused for the whole session (§4.6) — not broadcast until a provider attaches.
- **Creation token:** a stable UUID for the pending Share attempt, stored in `sessionStorage` under a draft-scoped key (§4). Lifetime: created lazily on first Share intent (or first draft edit), reused across retries, cleared on successful commit and on starting a brand-new draft. `sessionStorage` (tab-scoped) is correct because a draft is a single-tab, pre-shared artifact.
- **Survives reload?** **No — by design.** The product brief does not promise unsynced/local work survives reload. Reloading `/` yields a fresh empty draft. **This document adds no draft persistence** (no localStorage/IndexedDB autosave). A future "restore last draft" is a product decision requiring a brief amendment; explicitly not adopted.
- **Remote object during draft:** none — no id, no row, no socket to a sheet.
- **If Share fails before commit:** draft stays intact and editable; state returns to "Local draft" with a non-destructive note; no addressable remote object exists. (If it failed *after* commit but the response was lost, the committed sheet is recovered by the token — §4; this is not an orphan-free claim.)
- **Not guaranteed:** draft survival across reload/navigation/crash; any pre-Share remote backup.

---

## 4. Share handoff algorithm (local draft → shared sheet)

**Invariant:** one user gesture, **no page reload**, and continuity of: the same local `Y.Doc`, the same editor instance where feasible, current text, **edits made while Share is in flight**, current selection and scroll, and the client-owned `Y.UndoManager` (§9).

### 4.1 Before Share (client state)
1. An unconnected local `Y.Doc` with `Y.Text("content")`; draft title + language in client state; schema version constant.
2. A **creation token** (UUID) in `sessionStorage` (draft-scoped key), created on first Share intent and reused on retry.

### 4.2 Share request (client → server)
The client captures a **submission snapshot**: `submittedUpdate = Y.encodeStateAsUpdate(doc)` and `submittedStateVector = Y.encodeStateVector(doc)` taken at request time, and sends:
- `creationToken`
- `submittedUpdate` (encoded Yjs update/state)
- `submittedStateVector`
- `title`
- `language`
- `schemaVersion`

Editing continues locally during the request; edits after the snapshot accumulate in the local `Y.Doc` and are reconciled in 4.4.

### 4.3 Server handling (atomic, idempotent)
1. **Validate** payload limits and schema (§19). Reject with a typed error on violation.
2. Open a **single SQLite transaction**.
3. **Look up** the `creationToken` in the idempotency table.
   - **Hit:** return the already-committed sheet (id, `serverRevision`, `committedStateVector`, metadata revision) — no second sheet.
   - **Miss:** mint a sheet id; reconstruct a server `Y.Doc` by applying `submittedUpdate`; encode its state blob and `committedStateVector`; set `serverRevision = 1`; write, **in the same transaction**: the sheet row (id, title, language, schemaVersion, timestamps, retention metadata), the current-state blob + revision + vector, the metadata record + `metadataRevision = 1`, and the idempotency record keyed by `creationToken`.
4. **Commit.** Only after commit does the server return `{ sheetId, serverRevision, committedStateVector, committedMetadataRevision, committedAt }` (the durable acknowledgement shape, §8).

### 4.4 After the creation response (client)
1. Update the URL to `/{sheetId}` via `history.pushState` (or `replaceState`) — **no reload**.
2. **Preserve the local `Y.Doc`** (do not discard/re-create). Attach it to a provider pointed at `{sheetId}`.
3. **Reconcile** by state vector: the client computes the diff between its **current** local vector and the server's `committedStateVector` and syncs the delta — this delivers any edits made after 4.2 to the server.
4. Keep the same editor instance and the same `Y.UndoManager`; selection, scroll, focus, and undo history are unaffected because neither the `Y.Doc` nor the editor is torn down.
5. **Do not claim "saved"** until a durable acknowledgement covers the client's **current** local vector **and** the current metadata revision (§6, §8). Between attach and that ack, the state is "Saving…".

### 4.5 Failure cases (no false orphan-free claim)

| Case | Outcome |
|---|---|
| Request fails **before** commit | No sheet exists; draft intact; retry with same token. |
| Server commits but **response is lost** | **A committed sheet exists.** This is a legitimate orphan-until-recovered; the client retries with the same token and the idempotency lookup returns it. Not an orphan-free design — recovery is by token. |
| Browser refresh while request is indeterminate | Draft text is lost (§3), but the `creationToken` persisted in `sessionStorage` survives the refresh within the tab; a subsequent Share reuses it and recovers a committed sheet if one exists. If the tab itself closed, an inactive committed sheet is reaped by retention (§11). |
| Duplicate Share click | Button disabled after first click; token idempotency collapses duplicates to one sheet regardless. |
| Clipboard write fails after creation | Sheet creation is **unaffected** — clipboard is a separate outcome (§5); show the URL with a manual Copy-link fallback. |
| Navigation while Share pending | If committed, the sheet exists and is token-recoverable; if not, nothing was created. |
| Connection fails after sheet creation | Sheet exists and is durable; the client shows "Reconnecting…" and reconciles on reconnect; "saved" only returns once the durable vector re-covers current state. |

### 4.6 Awareness continuity through Share (locked)

- The client creates **one `Awareness` instance bound to the local draft `Y.Doc` before Share**, and uses **that same `Awareness` instance for the entire sheet session**.
- **Before Share, local awareness is broadcast nowhere** — there is no provider and no socket; the awareness state (name, color, cursor) exists only in memory.
- **On Share success, the provider is attached to the same `Y.Doc` and the same `Awareness` instance.** After attachment, the **existing** local awareness state is broadcast; no second `Awareness` instance is created during the handoff.
- The handoff preserves the **same editor, the same external `Y.UndoManager`, selection, scroll, and awareness identity**; **no `Y.Doc`, editor, or `Awareness` teardown is allowed.** Provider attachment may require a small adapter or a construction path that accepts a pre-existing doc + awareness, but it must not reconstruct either.
- **Awareness client identity remains per connection/tab** (§15) — the identity broadcast after attachment is the tab's identity, unchanged by the transition.
- This continuity is covered by a **Share-transition awareness test** (§21): the same awareness client ID and identity survive the draft→shared handoff, and the local cursor is broadcast only after attachment.

---

## 5. Sheet creation vs clipboard confirmation

One gesture, but **four independent technical outcomes**, tracked separately:

1. **Sheet creation** succeeded (durable commit).
2. **Remote connection** succeeded (provider attached + initial reconcile).
3. **Durable state** confirmed (ack subsumes current vector + metadata).
4. **Clipboard copy** succeeded or failed.

Truthful UI outcomes:

| Situation | UI |
|---|---|
| creation ✓ + copy ✓ | "Shared · link copied" → settles to the durability phrase (§6) |
| creation ✓ + copy ✗ | "Shared" + **visible URL** + manual "Copy link" control; never claims the link is on the clipboard |
| creation ✗ | "Couldn't share — your draft is safe here"; remain in draft |
| sheet exists + connection/sync pending | "Connecting…" (never `Shared · connected` until sync completes, §6/§8) |
| sheet exists + persistence later fails | "Not saved — storage failed" (§6), distinct from any transport phrase |

**Clipboard feasibility caveat:** `navigator.clipboard.writeText` requires transient user activation, which an `await` across the Share round-trip may have consumed. The clipboard write may therefore **fail after the network round trip**, and the architecture treats that as an expected outcome, not an error in creation. There is **no pre-copy and no optimistic/invented URL** — the URL does not exist until the server returns the real `sheetId`. When copy fails, the product **always shows the final URL and provides a manual "Copy link" fallback**. **Real-browser clipboard behavior under this activation timing is a prototype/test requirement** (§21), not an assumed capability. Creation and clipboard outcomes remain separate (above).

---

## 6. Internal state machines and legal wording

Three **independent** machines. The legal UI phrase is a function of their combination.

### 6.1 Transport
`disconnected → connecting → connected → (reconnecting ⇄ connected) → failed`

### 6.2 Sheet validation / initial sync
`unresolved → valid/loading → (invalid-or-expired | sync-pending → sync-complete)`

### 6.3 Durability
`clean-at-vector → dirty → persisting → committed-at-vector → (persistence-failed)`

### 6.4 What each event proves

| Event | Proves | Does **not** prove |
|---|---|---|
| WebSocket open | transport rung 1 | any sheet or document fact |
| Sheet lookup valid | the id resolves to a live sheet | content synced |
| Initial Yjs sync complete (`provider.synced`) | client and **in-memory** server doc exchanged state | durability; standing sync (it can go stale on the next edit) |
| Update received by server | bytes arrived | applied or durable |
| Update applied to server `Y.Doc` | in-memory convergence | durable |
| **SQLite transaction committed** | **durability at a specific `serverRevision`/vector** | that it covers the client's *current* state |
| Committed vector broadcast (ack) | the durable vector is known to the client | client currency (client may have newer edits) |
| Client confirms committed vector **subsumes** current local state | current content is durable | metadata durability |
| Metadata revision committed | title/language durable at a revision | content durability |

### 6.5 Strongest legal phrase per meaningful combination

| Transport | Sheet/sync | Durability vs current | Legal phrase |
|---|---|---|---|
| connecting | unresolved **or** sync-pending | — | `Connecting…` |
| connected | valid, sync-pending | — | `Connecting…` |
| connected | sync-complete | clean baseline, not yet durably covered | `Shared · connected` |
| connected | sync-complete | dirty (content and/or metadata pending) | `Saving…` |
| connected | sync-complete | content covered, metadata pending | `Saving…` (metadata not yet durable) |
| connected | sync-complete | covered (content **and** metadata) | `Shared · saved` |
| reconnecting | any | any | `Reconnecting…` |
| connected | sync-complete | **persistence-failed** | `Not saved — storage failed` |
| failed | any | any | transport-failure wording (distinct) |
| any | invalid-or-expired | — | `This link is unavailable` |

**Required conclusions (locked):**
- `provider.synced` is **not** a standing "saved" or "synced" guarantee — it is a point-in-time initial-sync fact and does not survive the next keystroke.
- While sheet validation **or** initial sync is still pending, the only legal phrase is **`Connecting…`** — never `Shared · connected`.
- `Shared · connected` is legal **only after** the sheet is valid **and** initial sync is complete **and** the current (clean-baseline) state is not yet durably covered.
- **`Saving…`** whenever the current local vector is not durably covered (including metadata).
- **`Shared · saved`** only when the committed durable vector **subsumes** the client's current Yjs state **and** no newer metadata revision is pending.
- **Persistence failure is a distinct state** from transport failure and must never be shown as "Reconnecting."

---

## 7. Persistence representation (approved: SQLite)

**Decision:** SQLite — the smallest credible store that makes durable "saved," bounded retained versions, and retention metadata + cleanup all true in one file with no service. Representation:

- **One full encoded Yjs state blob per sheet** (not an update log in v1).
- **One current metadata record** per sheet (title, language, schemaVersion, `metadataRevision`).
- **Monotonic `serverRevision`** per sheet, incremented on each committed current-state write.
- **`committedStateVector`** stored alongside the blob.
- **Bounded text-only version rows** (§10).
- **No update log in v1.**

**Durability / engine settings (single-node local portfolio server):**
- Journal mode **WAL**; **`PRAGMA synchronous = FULL`**. Rationale: expected write volume is low (two-person, debounced), so throughput is not the constraint; truthfulness and crash durability are. `Shared · saved` should correspond to the strongest practical embedded-store guarantee this project can reasonably provide, and `FULL` gives crash-durability at each commit under WAL.
- **The "saved" durability envelope (precise):** `Shared · saved` means the SQLite transaction has **committed under the configured durability settings (WAL + `synchronous = FULL`)** *and* the committed state vector and metadata revision **cover the client's current state** (§8, §12). It does **not** claim immunity from arbitrary disk corruption, hardware failure, or filesystem failure. This is **durable application state, not a backup guarantee.**
- **Parameterized statements only** (no string interpolation) — SQL-injection safe (§19).
- A **`schema_version` table** and forward-only migrations.
- **Per-sheet serialized write queue (mutex)**: all writes for a sheet run in revision order through one queue, so a slow/stale async write can **never** overwrite a newer committed state. A write whose base `serverRevision` is older than the committed revision is rejected/superseded.
- **Startup reconstruction:** on first access after boot, load the sheet's blob and `Y.applyUpdate` it into an in-memory server `Y.Doc`; serve from memory thereafter; persist on debounce.
- **Corrupt-state handling:** if a blob fails to decode, mark the sheet unavailable rather than crashing the server; log for observability; never surface partial/garbage content.
- **Integration tests** use a **file-backed** temporary database (real durability across a simulated restart), not `:memory:` for restart tests (§21).
- **Limits (values configurable, §19):** max encoded-state size; max visible document text size; max title size; max language token size.
- **Metadata is committed under the same logical durability contract** as content (§8, §12) — the "saved" claim covers both.
- **Retention and version writes are ordered transactionally** with the current-state commit they depend on (§10, §11).

**Alternatives (deferred):** an **update log** (append every update; periodic compaction) minimizes write size but adds compaction, ordering, and replay complexity and a larger corruption surface — deferred; not needed for two-person sheets. **Snapshot + log** (periodic blobs plus a tail log) is a scaling optimization with the same added complexity — deferred. A **full-blob-per-sheet** write is the smallest correct representation at this scale and is chosen for v1.

---

## 8. Durable acknowledgement

**Payload (conceptual), emitted only after the SQLite transaction commits:**
`{ sheetId, serverRevision, committedStateVector, committedMetadataRevision, committedAt }`

**Client logic:**
1. Compare `committedStateVector` with the current local state vector.
2. Compare `committedMetadataRevision` with the current local metadata revision.
3. If local content **or** metadata is newer than what the ack covers → remain **dirty/`Saving…`**.
4. Enter **`Shared · saved`** only when **both** content and metadata are durably covered.

**Write ordering (locked):**
- Per-sheet **monotonic `serverRevision`**.
- **Serialized writes** through the per-sheet queue (§7).
- An older write may **never** replace a newer committed state; superseded writes are dropped, and their acks (if any) are not allowed to regress the client's durability view.

---

## 9. Safe per-user undo/redo (verified against installed source)

**Verified behavior** (`node_modules/y-codemirror.next/src/*`, `node_modules/yjs/src/utils/UndoManager.js`):
- Local CM edits are applied to Yjs with the **binding-specific `YSyncConfig` object** as the transaction origin (`ytext.doc.transact(fn, this.conf)` in `y-sync.js`). A new `YSyncConfig` is created by **every** `yCollab()` call.
- The undo plugin registers that binding origin on the provided `UndoManager` on **mount** (`addTrackedOrigin(this.syncConf)`) and **removes** it on **destroy** (`removeTrackedOrigin(this.syncConf)`) — `y-undomanager.js`.
- `yCollab(ytext, awareness, { undoManager })` **accepts an external `Y.UndoManager`**; the default constructs a fresh one per call (which would lose history across any reconfigure).
- A default `new Y.UndoManager(ytext)` tracks `new Set([null])` — it would capture **null-origin** programmatic mutations (e.g., seeds, non-annotated inserts). Remote provider updates carry the provider as origin (not null, not tracked) and are already safe.

**Specification:**
- **One client-owned `Y.UndoManager` per active sheet**, constructed with **`trackedOrigins: new Set()`** (empty) so null-origin changes are **not** captured; only the active binding's `YSyncConfig` (added by y-codemirror on mount) is tracked. Result: only genuine local editor edits are undoable; remote edits never are — satisfying the per-user requirement by construction.
- **Lifetime longer than any `EditorView`**: the manager is owned by the sheet session, not the editor. It is **passed into every `yCollab()` call** so it survives editor reconfiguration.
- **Survives** (same manager, same local `Y.Doc`/`Y.Text`, so relative positions still resolve): the Share transition (§4), reconnect, and entry/exit of historical preview (§16). Across each, the old binding origin is removed and the new one added, but existing stack items remain valid because the `Y.Text` identity is preserved.
- **Resets** (new manager): full page reload, opening a **different** sheet, and starting a **new** local draft.
- **Keymap ordering:** `yUndoManagerKeymap` must be registered **before** any generic CodeMirror `history` keymap so `Mod-z`/`Mod-y`/`Mod-Shift-z` bind to the Yjs manager; native `history()` is **not** included.
- **Pre-Share edits remain undoable after Share:** yes — because §4 preserves the same `Y.Doc`/`Y.Text` and the same `UndoManager`; the origin swap at Share does not clear existing stack items. This is the technical reason Share must not tear down the doc or the manager.

**Required tests (§21):** A types / B types / A-undo removes only A's eligible change; interleaved insert/delete; undo across reconnect; undo across preview entry/exit; undo across the Share transition (pre-Share edit still undoable); reload resets the stack. **No restore, no historical branching** — this is live-editing undo, fully separate from Recent versions.

---

## 10. Recent versions — transactional specification

Server-owned, retained. Derived **only from authoritative, durably committed server state**.

- **Source:** capture reads the server `Y.Doc` state that corresponds to a **committed `serverRevision`** — never uncommitted or client-submitted state.
- **Row shape:** `{ versionId, sheetId, sequenceNumber, sourceRevision, text, createdAt }`.
- **Ordering:** `sequenceNumber` (monotonic per sheet) is the **canonical order and tie-breaker**; `createdAt` wall-clock is **display metadata only** (immune to clock skew).
- **Dedup:** skip capture if `text` equals the most recent version's text.
- **Cadence/coalescing:** debounced idle capture using an **injected clock** (§21); within the coalescing window, replace rather than append.
- **Restart behavior (corrected — no across-restart determinism claim):**
  - Inserted version rows remain **deterministically ordered by `sequenceNumber`**, and stored rows + their `sourceRevision` **survive restart**.
  - A pending debounce/coalescing **window is not persisted**.
  - A pending (not-yet-inserted) capture **may be lost on crash or restart without violating the product contract**.
  - After restart, the **next qualifying committed revision starts a new coalescing window**; no attempt is made to reconstruct an in-memory pending timer.
  - Recent versions is thus a bounded **best-effort recovery surface, not an audit log** — dedup, sequence ordering, and the bound all still hold.

**Insertion transaction choice (decided):** version insertion occurs in a **later transaction tied to an already-committed `sourceRevision`**, *not* in the same transaction as the current-state commit. **Justification:** capture is debounced/coalesced and must reference *durable* state; binding it to the current-state commit would force a version on every persist (defeating coalescing and the bound) and would couple two different cadences. Referencing a committed `sourceRevision` keeps captures durable, coalesced, and independently paced, and makes "lose a pending capture on crash" harmless.

- **Hard bound:** enforced **transactionally** — each insert, in one transaction, adds the new row and deletes the oldest rows beyond the configured bound.
- **No** author, identity, cursor, selection, or awareness data is ever stored on a version.
- **Retention expiry** deletes current sheet data **and** all its versions coherently (§11).

**Retired completely:** `Y.Array` snapshots, the client snapshot recorder, `src/lib/timeline.ts` marker utilities, the timeline scrubber, and all permanent-history chrome.

---

## 11. Retention and active-room expiry

**Policy shape (configurable, v1):** **last-activity-based** expiry.
- **`lastActivityAt` is updated by edits only** (committed current-state writes). **Reads do not extend retention** — otherwise a bot polling a link keeps a sheet alive forever. Edits extend it.
- **`retentionExpiresAt = lastActivityAt + retentionWindow`** (window value open, §23).
- **Cleanup interval:** a periodic sweep (interval configurable) plus a **startup sweep**. Both are idempotent.
- **Fake-clock seam:** the sweep and all expiry math take an **injected clock** (§21).

**Active-room contract (decided, simplest correct):**
- **Never delete an actively connected sheet.** If a connected sheet reaches expiry, mark it **`expiry-pending`**.
- **Final expiry only after the last connection closes**, and only if interim activity did not renew `retentionExpiresAt`.
- Retention cleanup runs through the **same per-sheet lifecycle queue/mutex** as current-state persistence, metadata writes, and version inserts — so cleanup can never interleave with a live write for that sheet.

**Final-expiry sequence (serialized through the per-sheet lifecycle lock):**
1. Acquire the per-sheet lifecycle lock.
2. Mark the room **`closing`**.
3. Reject new writes and new joins for this sheet.
4. Cancel or drain pending debounce work (persistence and version-capture timers).
5. Ensure no older queued write can commit afterward (the write queue is empty/superseded).
6. Delete current state, metadata, versions, retention data, **and** the idempotency record in **one SQLite transaction**.
7. Commit the deletion.
8. Remove the in-memory room.
9. Release resources / the lock.

**Race and failure handling:**
- A **reconnect or new join cannot race in after `closing` begins** — step 3 rejects it; such a client sees the sheet as unavailable and must treat it as a fresh lookup.
- If cleanup **fails** (e.g., the delete transaction errors), the room is left **unavailable for new joins** and the cleanup is **retried safely** on the next sweep; partial deletion cannot occur because step 6 is a single transaction.
- Deleting the idempotency record in the same transaction guarantees a stale `creationToken` cannot resurrect a reaped sheet.

**Internal cause differentiation (kept distinct even if public copy merges some):**

| Internal cause | Meaning | Public messaging |
|---|---|---|
| `invalid-id` | id never existed / failed the parser | may merge with expired → "unavailable" |
| `expired` | existed, retention elapsed | may merge with invalid → "unavailable" |
| `malformed-request` | bad payload/protocol | typed error; not "unavailable" |
| `server-unavailable` | transport/outage | **distinct** connection-failure wording (never "unavailable") |

Public copy may combine **never-existed** and **expired**; **transport outage must remain distinct**.

---

## 12. Metadata synchronization and persistence (title, language)

Title and language are product-contract data.

**Representation (decided): separate revisioned metadata, not Yjs shared types.** Title and language are low-frequency, single-authoritative fields; modeling them as CRDT text invites cursor/merge machinery they don't need and complicates the durability contract. Title and language live in the **server metadata record** with a **monotonic `metadataRevision`**.

**Metadata state machine (explicit).** Client fields:
- `serverMetadataRevision` — the latest revision the client has seen the server confirm.
- `localMetadataRevision` — the client's local revision counter.
- `pendingMetadataMutation` — the outstanding local change (value + base revision), or none.
- current local `title` / `language`.

Rules:
1. A local metadata edit **increments `localMetadataRevision`** and **creates or replaces `pendingMetadataMutation`** (base = the client's `serverMetadataRevision`).
2. Metadata edits made **while Share is in flight** are held and **sent after the creation response** (§4), against the sheet's initial `metadataRevision`.
3. **Disconnected** metadata edits **remain pending locally** and are sent on reconnect.
4. The server **accepts a mutation only when its base revision matches the current server `metadataRevision`**. On success it increments `metadataRevision`, **commits it durably** under the same contract as content (§7/§8), **broadcasts** the authoritative value + revision, and **includes `committedMetadataRevision` in the durable acknowledgement** (§8).
5. On **stale-base rejection**, the server returns the **current authoritative value + revision**.
6. **Conflict rule (decided — no blind auto-replay):** on rejection or a conflicting broadcast, the client **surfaces the authoritative remote value** and updates `serverMetadataRevision`, **but keeps the local pending value available for explicit reapply**. The client **must not silently drop** the local pending value, and **must not auto-replay it blindly** over the authoritative value.
7. **`Shared · saved` is legal for metadata only when there is no `pendingMetadataMutation` and the committed `metadataRevision` covers the current local metadata state** (folds into the durability leg of §6/§8).

- **Reload restore:** metadata loads from the record alongside the doc blob.
- **Language allowlist:** language must be a member of a server-side **allowlist** (the supported syntax set); non-allowlisted values are rejected (§19).
- **Export filename:** derived from the (sanitized) title + the allowlisted language's canonical extension. Sanitization strips path separators, control chars, and leading dots; empty/invalid titles fall back to a safe default (e.g., `untitled`). **No path-derived filesystem access** anywhere (§19).

---

## 13. Jump-to-collaborator and Back

Required product behavior (design brief §9).

- **Awareness payload** already carries `{ user, cursor }`; `cursor` must include **anchor and head** relative positions (the binding produces relative positions; resolve to absolute on read).
- **Jump target resolves from current awareness state only** — never from history (no cursor replay, D-010).
- **Before jumping, the client stores** a return record: current scroll position, current selection, and editor focus state.
- **Jump** scrolls to and briefly emphasizes the collaborator's **current** caret/selection (design brief arrival cue), resolved from their live awareness `cursor`.
- **Back** restores the saved scroll + selection + focus.
- **Stack rule (decided, simplest):** a single **replace** slot — a subsequent jump overwrites the prior return target (no growing stack). Back always returns to the position held just before the most recent jump.
- **Disconnect during jump:** if the collaborator's awareness is gone (or the target position no longer resolves), the jump is a **no-op with a quiet notice**; Back remains available from any stored return record.
- **Collaborator moves after jump:** the jump is a one-shot to their position at jump time; it does **not** track subsequent movement (**no persistent follow mode**).
- **Keyboard/accessibility:** jump is invocable from the collaborator chip **and** a keyboard collaborator list (Enter to jump); Back is a keyboard-reachable control; both announce via live region; arrival cue honors reduced-motion (static form).

---

## 14. Collaborator joining before initial sync

Explicit states so no collaborator is shown as "current" before the client holds a valid synchronized document:

1. **Socket connected, sheet unresolved** — no presence claims; UI "Connecting…".
2. **Sheet valid, initial sync pending** — awareness may arrive, but the document is not yet trustworthy; presence is **held**, not rendered as live editors.
3. **Awareness received before content sync** — buffered; not promoted to a live collaborator.
4. **Collaborator ready/live** — only after **initial content sync completes** (`sync-complete`, §6.2). Only then are cursors/selections resolved against a valid `Y.Text` and the collaborator rendered as present and jump-eligible.

Rationale: awareness positions are **relative to the `Y.Text`**; resolving them before content sync yields wrong or null positions. Presence must lag content sync, never lead it.

---

## 15. Identity and 3+ participant behavior

- **Identity persistence:** per **sheet + browser** in `localStorage` (keyed by sheet id) — so the same browser rejoining the same sheet keeps its name/color; "may be restored while browser storage remains available."
- **Awareness instance is per connection/tab:** identity (display) may be shared across a browser's tabs, but each tab is a **distinct awareness/connection instance** with its own awareness client ID.
- **Jump targets are awareness client IDs, not deduplicated identity IDs** — so two tabs of the same person are independently jump-addressable.
- **New identity** on cleared storage or a different browser (unverified).
- **Names are editable and unverified.**
- **Color collisions are acceptable only** when paired with the **written name** and an additional **stable distinguishing treatment** (e.g., a deterministic secondary mark derived from the awareness client ID) so two same-color participants remain distinguishable without color alone.
- **All accepted participants** keep receiving and rendering cursors up to the **connection cap** (§19); the product does not silently drop a connected participant's cursor.
- **Header overflow** may **compress** the presence display (e.g., "+N") but may **not hide collaboration entirely**; the keyboard collaborator list remains **complete and deterministic**.
- **No group dashboard, no avatar pile.**
- **Proportional abuse cap:** a per-sheet **connection cap** (§19) bounds memory/relay without redesigning the two-person product into group collaboration — set high enough never to affect real use, low enough to bound abuse.

---

## 16. Past-preview mechanism (decided)

**Re-evaluated** three options against: preserving the live Yjs binding, the `Y.UndoManager`, local selection, scroll, collaborator editing, current awareness truth, focus restoration, and accessibility.

| Option | Live binding kept | Undo kept | Selection/scroll kept | Verdict |
|---|---|---|---|---|
| Destroy/recreate live editor (current) | No (torn down) | Only if manager is external (§9); view state lost | No | Rejected — loses editor state; heaviest |
| Reconfigure one editor to read-only + back | Binding must be suspended; risk of write leakage | Fragile | Partial | Rejected — invariant harder to guarantee |
| **Keep live editor mounted but hidden/inert; mount a separate read-only preview view** | **Yes** | **Yes** | **Yes** | **Chosen** |

**Chosen mechanism:**
- The **live editor stays mounted** (binding intact, `Y.Doc` live, collaborator edits continue) but is **hidden and made inert** (not editable, not focusable).
- A **separate read-only preview view** is mounted with the selected version's text and **no `yCollab` binding** — so it structurally cannot mutate the live doc (D-005 preserved).
- **Suppress this client's awareness cursor** while previewing (set `cursor` field to null), so collaborators don't see a stale caret — keeping awareness truthful.
- **Exclude the hidden live editor from accessibility navigation** (e.g., `inert`/`aria-hidden`) so focus and screen-reader order live in the preview only.
- **On return:** unmount the preview, restore the live editor's focus and the **current** live viewport/selection, and re-enable awareness cursor broadcasting. Because the live view was never destroyed, its scroll/selection and the `Y.UndoManager` are intact.
- **Memory/lifecycle:** the preview view is created on entry and **destroyed on return** (no accumulation across repeated previews); only one preview view exists at a time; the version text is fetched on demand and not retained after return.

---

## 17. Shared-state wording contract (corrects the revision-1 "synced" approval)

Revision 1's approval of **`Shared · synced`** as a standing phrase is **withdrawn**. The legal contract:

- Before validation/sync → **`Connecting…`**
- Valid sheet + initial sync complete, current state **not** durably covered → **`Shared · connected`** (if clean baseline) or **`Saving…`** (if dirty)
- Durable commit covers current Yjs state **and** metadata → **`Shared · saved`**
- Transport interruption → **`Reconnecting…`**
- Persistence failure with live transport → **`Not saved — storage failed`** (architecture-neutral; exact copy per design brief)
- Transport failure → distinct connection-failure wording

Exact final copy is governed by `DESIGN_BRIEF.md`; this section defines **which claims are technically legal**. There is no standing "synced" claim, because `provider.synced` does not survive the next edit (§6.4).

---

## 18. Data model

**Durable (SQLite):**

| Record | Fields (conceptual) | Notes |
|---|---|---|
| Sheet | `id`, `schemaVersion`, `createdAt`, `lastActivityAt`, `retentionExpiresAt` | activity = edits only (§11) |
| CurrentState | `sheetId`, `encodedState` (blob ≤ max, §19), `serverRevision`, `committedStateVector`, `updatedAt` | one per sheet |
| Metadata | `sheetId`, `title`, `language`, `metadataRevision`, `updatedAt` | revisioned LWW (§12) |
| Version | `versionId`, `sheetId`, `sequenceNumber`, `sourceRevision`, `text`, `createdAt` | bounded (§10) |
| Idempotency | `creationToken` (unique), `sheetId`, `createdAt` | Share recovery (§4); deleted with the sheet (§11) |
| SchemaVersion | migration bookkeeping | §7 |

**Ephemeral (never durable):** awareness (cursor/selection/name/color/status), provider/connection state, the local draft (client memory), and the guest identity (browser `localStorage`, never server-stored). The server durably stores document text, metadata, and versions — but **never who wrote anything**.

---

## 19. Security and abuse limits (proportional to a portfolio project)

**Enforcement points and configurable limits:**

| Boundary | Enforcement |
|---|---|
| Sheet-ID entropy | minimum entropy floor (non-sequential, ~12–16 URL-safe chars) |
| Sheet-ID parsing | strict regex/parser; reject anything else (no path-derived IDs) |
| Create request body | max size |
| Encoded Yjs update/message | max size; reject oversized frames |
| Awareness message | max size + **update rate limit** |
| Visible document text | max length |
| Encoded document state | max blob size (§7) |
| Title | max length; sanitized |
| Guest name | max length; sanitized for display |
| Language | server-side **allowlist** only |
| Concurrent sockets per sheet / per IP | connection cap (portfolio scope) |
| Share creation rate | rate limit per IP/token |
| Malformed decoder input | caught; typed error; connection dropped, server survives |
| Heartbeat | server ping/expected pong; **heartbeat timeout** closes half-open sockets and clears their awareness |
| SQL | **parameterized statements only** |
| Export filename | sanitized (§12); no path traversal |
| Filesystem | **no path-derived filesystem access** from any user input |

**Corrected PII claim (revision-1 "No PII at rest" was false):**
- **True claim:** the server stores **no verified identity and no authorship record** — it never durably associates content with a person.
- **Caveat:** arbitrary **user-provided sheet content and titles may contain personal information**; the store therefore may contain user-authored PII in free text. This is inherent to a text tool and is bounded only by retention (§11) and size limits — not by any claim that the store is PII-free.

No authentication, ownership, permissions, or revocation are introduced. The link is the access model, stated honestly ("anyone with this link can read and change this sheet"; never "private"/"secure").

---

## 20. Server migration classification (corrected)

**Reuse:**
- Yjs sync protocol knowledge (two-step sync encoding/decoding).
- Awareness forwarding **concept**.
- Awareness cleanup **concept** (remove states on disconnect).

**Replace / restructure:**
- The monolithic in-memory `rooms` Map **lifecycle**.
- Starter-code seeding.
- Permissive **path-derived room IDs**.
- Absent **persistence hook**.
- Absent **heartbeat**.
- Absent **payload limits**.
- Absent **explicit lookup/error codes**.
- Absent **durable acknowledgements**.
- **Test-reset coupling** (`/__test/reset` clearing the live Map).

The current server is **not** broadly reusable; it is a small reusable protocol kernel inside a composition layer that is replaced.

---

## 21. Test strategy and deterministic seams

**Injectable seams (required):**
- Temporary **file-backed SQLite path** (per test; real restart durability).
- **Fake clock** (retention, version cadence/coalescing).
- **Deterministic ID generator** (sheet IDs).
- **Deterministic creation-token generator** (tests only).
- **Server start/stop/restart** control.
- **Controlled WebSocket interruption** (drop/restore).
- **Persistence-failure injection** (force a commit to fail with transport still live).
- **Clipboard-failure stub** (assert the manual-fallback path).
- **Test-only reset route** enabled **only** under `TEST_MODE`; reset clears **both** in-memory rooms **and** the durable test database; **no reset capability in normal mode**.

**Required tests (map to Codex concerns):**
no remote object before Share · duplicate Share · lost creation response + retry · browser refresh with pending token · edits made during Share (in-flight edits reconciled) · **awareness continuity through Share (same `Awareness` instance + client ID + identity survive the handoff; local cursor broadcast only after attachment)** · clipboard failure after creation · no-reload route transition · state-vector durable acknowledgement · metadata durability · **metadata state machine (stale-base rejection surfaces authoritative value, keeps local pending for explicit reapply, no blind auto-replay)** · persistence failure while socket stays connected · file-backed restart reopen · corrupt stored state · reconnect convergence · safe per-user undo (A/B interleave; undo across reconnect/preview/Share; reload reset) · version sequence + hard bound · **pending version capture lost on restart (no timer reconstruction; next committed revision starts a new window)** · retention cleanup · connected-sheet expiry (expiry-pending → final close; reconnect cannot race in after `closing`) · invalid vs unavailable internal causes · preview focus/scroll/undo preservation · stale awareness cleanup (close + heartbeat timeout) · third-participant behavior (still rendered; keyboard list complete) · navigation away while dirty.

**Test layers:** unit (vitest) for pure logic (token identity, undo origin scoping, vector-subsumption, sanitizers, sequence/bound math, filename derivation); integration (node) for server + file-backed SQLite (create/reopen/restart/retention/persistence-failure/corrupt-state); Playwright for the full flows (draft→Share→saved ladder, preview preservation, jump/Back, presence); server-level ws harness for protocol/heartbeat/limits.

**Prototype tests:** keep sync/awareness/cursor/past-mode-local-only; **remove** all timeline-scrubber and server-seed tests.

---

## 22. Persistence alternatives (brief, updated)

In-memory-only → **rejected** (makes "saved" and same-link reopen impossible; fails the contract). `y-leveldb` KV → durable doc, but versions/retention/observability hand-rolled → **rejected** for this scope. External DB (Postgres/Redis) → operational overkill for a single-node two-person tool → **rejected**. `y-websocket` server binary → imposes its lifecycle/room assumptions → **rejected** in favor of the reused protocol kernel + owned composition. **SQLite, full-blob-per-sheet, no update log → chosen** (§7).

---

## 23. Final architecture recommendation

**Locked decisions:**
- **Hand-rolled protocol kernel: retained** (Yjs sync + awareness concepts).
- **Server lifecycle/composition: replaced** (§20).
- **SQLite: approved** with the §7 conditions (WAL + `synchronous = FULL`, parameterized SQL, schema/migration table, per-sheet serialized write queue, startup reconstruction, corrupt-state handling, file-backed integration tests, size limits, metadata under the same durability contract, transactional retention/version ordering). The "saved" envelope is durable application state, not a backup guarantee (§7).
- **Persistence representation: selected** — one full encoded Yjs blob per sheet + current metadata + monotonic revision + committed vector + bounded text-only versions; **no update log** in v1.
- **Share algorithm: selected** (§4) — idempotent token, atomic commit, preserve local `Y.Doc`/editor/edits/selection/scroll/undo, `history.pushState`, no reload; orphan-recoverable-by-token (not orphan-free).
- **Durable acknowledgement: selected** (§8) — content + metadata vector/revision, emitted post-commit, serialized monotonic writes.
- **Server-owned versions: selected** (§10) — later transaction tied to a committed `sourceRevision`; sequence-ordered; transactional hard bound; no attribution.
- **UndoManager lifecycle/origin strategy: selected** (§9) — one client-owned manager per sheet, empty tracked-origins set, passed into every `yCollab`, survives Share/reconnect/preview, resets on reload/new-sheet/new-draft; keymap before native history; native history excluded.
- **Identity model: selected** (§15) — per-sheet `localStorage` identity, per-connection awareness, jump by awareness client ID, editable/unverified, color-collision safeguards.
- **Additional-participant minimum behavior: selected** (§15) — all connected participants rendered up to the connection cap; header may compress but not hide; keyboard list complete; no dashboard/pile.
- **Preview mechanism: selected** (§16) — hidden-inert live editor + separate read-only preview + suppressed awareness + focus/viewport restoration + single-preview lifecycle.
- **Legal shared-state phrases: selected** (§17) — no standing "synced"; "saved" only on durable subsumption of content + metadata; persistence failure distinct from transport failure.

**Remaining open values only (not blockers):**
- exact **retention duration** and its disclosure copy;
- **version cadence** and **hard bound** (N);
- **numeric abuse limits** (sizes, rates, connection cap);
- **final visual copy** within the legal state meanings (governed by `DESIGN_BRIEF.md`).

---

## Non-goals

No implementation · no package changes · no auth · no ownership or revocation · no deployment plan · no multi-room UI · no file tree · no execution · no AI · no chat · no restore · no branching · no audit log · no historical cursor replay · no permanent timeline · no Point in v1 · no repository rename · no Figma work.

---

*Documentation only. No code, dependencies, or product scope changed. Approval of the §23 open values is a prerequisite to any build work.*
