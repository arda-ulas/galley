# Echo/Rewind — Decision Log

Decisions are recorded here when they have a non-obvious rationale or when a reasonable alternative was considered and rejected.

---

## D-001 — No router library (week 1)

**Decision**: Hardcode `/r/demo` in `App.tsx`. No React Router, TanStack Router, or similar.

**Rejected alternatives**: React Router v7, TanStack Router.

**Reason**: There is only one meaningful route in week 1. Adding a router introduces config, lazy loading decisions, and loader patterns that add no value. If multiple rooms are added later, a router can be dropped in with one refactor.

---

## D-002 — sessionStorage for tab identity, not localStorage

**Decision**: Per-tab identity (UUID, name, color) is stored in `sessionStorage`.

**Rejected alternatives**: `localStorage`, server-assigned cookie, URL param.

**Reason**: `sessionStorage` is tab-scoped by the browser. Two tabs in the same browser get distinct sessions automatically. `localStorage` would share state between tabs, making two tabs appear as the same user. Server-assigned identity requires a round trip and storage. URL params would expose identity in the address bar and complicate the URL.

---

## D-003 — Snapshots stored in Y.Array on the shared Yjs doc

**Decision**: Snapshots are pushed into `doc.getArray('snapshots')` rather than a local React state array or a server-side store.

**Rejected alternatives**: React `useState`, server REST endpoint, IndexedDB.

**Reason**: Storing snapshots in Yjs means all connected tabs see the same timeline without extra sync logic. If Tab A takes a snapshot, Tab B's timeline updates automatically. `useState` would produce divergent timelines per tab. A server endpoint would require a backend. IndexedDB adds complexity and doesn't survive server restart anyway.

---

## D-004 — No database or durable persistence (week 1)

**Decision**: Restarting the y-websocket server clears all room state.

**Reason**: The demo is presented in a single sitting. Persistence adds infrastructure (Postgres, Redis, or SQLite). The week-1 win condition does not require state to survive a server restart. This can be added in week 2 with `y-leveldb` or a Postgres provider.

---

## D-005 — Past mode is local-only, does not affect other users

**Decision**: Entering past mode does not pause or rewind the shared Yjs document.

**Rejected alternative**: Broadcast a "viewing past" signal and lock the document for everyone.

**Reason**: Locking the document for all users is an extremely disruptive operation that would break other users' ability to type. Past mode is a personal, read-only view. The correct design is: the local editor is replaced with the snapshot text in read-only mode while the shared Yjs doc continues to accumulate changes in the background. Returning to "now" re-attaches the live editor.

---

## D-006 — Amber palette hardcoded as CSS custom properties

**Decision**: Colors defined as `--token` CSS custom properties in the global stylesheet, referenced via Tailwind arbitrary values `bg-[var(--token)]`.

**Rejected alternatives**: Tailwind config `theme.extend.colors`, CSS-in-JS, inline styles.

**Reason**: Tailwind v4 is CSS-variable-first. Custom property tokens work cleanly with Tailwind arbitrary values and are easy to override for past mode (swap `--editor-bg` to `--past-bg` with a single class toggle). Putting colors in `tailwind.config.ts` works too but requires more boilerplate and doesn't give the runtime flexibility needed for the live→past transition.

---

## D-007 — No shadcn component generator (week 1)

**Decision**: Use shadcn/ui primitives only when they add genuine value (e.g., Tooltip for timeline markers). Do not run the full shadcn init or generate a component library.

**Reason**: The Amber visual design diverges significantly from shadcn's default aesthetic. Running the generator creates files that all need to be overridden. It's faster to write focused primitives or use `@radix-ui` directly.

---

## D-008 — Snapshot debounce at 1500 ms

**Decision**: Wait 1500 ms of Y.Text inactivity before capturing a snapshot.

**Rejected alternatives**: 500 ms (too noisy), 3000 ms (too slow feedback on timeline), every N characters.

**Reason**: 1500 ms is long enough to skip mid-word snapshots but short enough that a user sees a marker appear within 2 seconds of pausing. Character-count triggers would snapshot mid-word during fast typing.

---

## D-009 — Seed starter code only on empty document

**Decision**: Insert the starter TypeScript snippet only when `doc.getText('content').toString() === ''`.

**Reason**: Prevents overwriting content when a second tab joins a room that already has text. The check must happen after the WebSocket provider syncs (after the `synced` event), not on initial mount.

---

## D-010 — No historical cursor replay

**Decision**: Snapshots store only the full document text, not cursor positions. Past mode shows old code but not where cursors were.

**Reason**: Replaying cursor history requires storing awareness state per snapshot, which multiplies storage significantly and complicates the replay logic. The week-1 win condition is code reconstruction, not cursor reconstruction. This can be added post-week-1 if desired.
