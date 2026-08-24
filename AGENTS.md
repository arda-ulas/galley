# Echo/Rewind — Codex Instructions

## Canonical source of truth

The active product definition is `docs/PRODUCT_BRIEF.md`.

**The timeline-first thesis is retired.** The prior framing — "A collaborative code room where the timeline is the interface" — described `prototype-v1` (tag `4147372`). It is a historical checkpoint, not the reconstruction target.

Before any product, design, or architecture decision: read `docs/PRODUCT_BRIEF.md`.

Do not begin implementation work without confirming an approved active task exists and the brief has been reviewed.

## Active product direction

**Category:** Real-time collaborative code sharing — differentiated through lifecycle, recovery, and interaction craft, not through the baseline of anonymous joining and shared cursors.

**Primary user:** A working developer already in a live call or chat with one trusted collaborator.

**Primary job:** Give both people independent eyes and hands on the same self-contained code excerpt within seconds, without sharing an entire project, installing software, or handing over control.

**Canonical artifact:** One shared code sheet.

**Creation lifecycle:**
- Root opens a local draft.
- Draft code is not uploaded before Share.
- Share creates the remote sheet and copies the edit link.
- Anyone with the edit link can read and change the sheet.
- Shared sheets are retained under a disclosed service policy.
- Permanence, privacy, ownership, and verified identity must never be promised.

See `docs/PRODUCT_BRIEF.md` for the full locked decisions, core loop, differentiators, and success criteria. If any summary in this file conflicts with `docs/PRODUCT_BRIEF.md`, the brief governs.

## Locked v1 scope

- Local draft open on root
- Share creates a remote sheet and copies the edit link
- One sheet, one language, document title
- Anonymous per-sheet/per-browser guest identity
- Presence, remote cursors, remote selections
- Jump to collaborator with explicit keyboard-accessible Back
- Truthful connection and saved-state — must distinguish connecting · shared-and-saved · reconnecting · unsynced · failed — never visually conflated
- Bounded Recent versions: automatic, hidden by default, local read-only preview, copy full text from a past version — no restore, no named checkpoints, no permanent timeline chrome
- Download/export with appropriate filename and extension
- Syntax-aware CodeMirror editing, Find/search, safe per-user undo/redo

## Experimental (prototype before including)

- Deliberate "Point here" selection-adjacent interaction
- Off-screen attention indicator
- Ping lifetime and repeated-ping behavior
- Reduced-motion treatment for Point

Validate all Point behavior before committing it to the product.

## Post-v1 (do not build now)

Restore from version · named checkpoints · local recents · read-only links · continuous follow mode · duplicate from version · mobile viewing polish.

## Explicit exclusions

Code execution · terminal · package installation · deployment · multiple files · file tree · comments · chat · accounts · AI · autocomplete · linting · automatic formatting · presenter mode · classroom-scale collaboration.

## Reconstruction status

**The branch has progressed well beyond the raw prototype.** As of commit `3214cef` on `reconstruction/collab-first`, the reconstruction has completed the **shared-draft adoption milestone** (Share handoff): a local draft at `/`, a one-gesture Share that creates a durable server-backed sheet and adopts the draft into it without remounting the editor, authoritative title/language reconciled from the server, and direct-load/join of `/{sheetId}`. See `docs/RECONSTRUCTION_STATUS.md` for the as-built record and `docs/IMPLEMENTATION_PLAN.md` (M0–M12) for the sequence.

Do **not** treat the retired `prototype-v1` code as the specification for reconstruction. The prototype's snapshot recorder, timeline, and `CollaborativeEditor`/`RoomPage` were removed earlier; **M4.5 T1 deleted the remaining dead island** — eleven unreachable files (`src/lib/room.ts`, the `usePresence` / `useProviderStatus` / `useSessionIdentity` hooks, `AppShell` / `PresenceBar` / `ConnectionStatus`, `components/ui/{button,badge}.tsx`, `lib/cn.ts`, `lib/codeMirrorTheme.ts`) plus the six npm dependencies that served only them (`framer-motion`, `class-variance-authority`, `lucide-react`, `@radix-ui/react-slot`, `clsx`, `tailwind-merge`).

`src/styles/tokens.css` was **deleted** in M4.5 T2 as part of DEF-1: it was still imported by `global.css` and leaked the amber accent into every non-CodeMirror selection, plus `color-scheme: dark` onto native controls in a warm-white sheet. Earlier guidance in this file said to leave it in place; that instruction is superseded and the file is gone.

**The invariant now holds and is enforced:** every non-test file under `src/` is reachable from `src/main.tsx`. `src/importGraph.test.ts` walks the import graph from the entry point and fails on any orphan, so a second dead island cannot accumulate silently.

The local-only historical-preview invariant (viewing history never mutates the live Y.Doc — D-005) remains an approved product property. Presence, Recent versions, durable `Shared · saved` state, and retention are sequenced but **not yet built** — do not assume they exist.

**Reconstruction stack:** Vite · React · TypeScript · CodeMirror 6 · Yjs · y-websocket · y-codemirror.next · y-protocols · `ws` · `node:sqlite` · Tailwind · Vitest · Playwright. (shadcn/ui and Framer Motion were **prototype-only** and left the tree with the dead island in M4.5 T1.)

## Visual direction

`docs/DESIGN_BRIEF.md` is the active design-direction document. **Paper** — a warm-white sheet with ink-first typography — is the current first-pass visual direction. The older dark/Amber timeline-first system is **historical and superseded**: do not apply amber tokens, amber metaphors, or "film strip / session afterglow" framing to reconstruction work.

Naming the design direction does **not** authorize a redesign here. Design audit and portfolio polish remain review work, not implementation scope in a documentation pass.

## Architecture status

`docs/ARCHITECTURE.md` describes `prototype-v1` (historical). The reconstruction technical design is `docs/RECONSTRUCTION_ARCHITECTURE.md`, and the as-built slice completed so far (shared-draft adoption) is recorded in `docs/RECONSTRUCTION_STATUS.md`.

The one architectural property confirmed to survive reconstruction: the **local-only preview invariant** — viewing history never mutates the live Y.Doc (D-005).

Do not speculatively refactor unshipped subsystems (storage/retention, room eviction) ahead of their milestone. `room.ts` is **not** a retained seam — it was deleted in M4.5 T1. The genuine retained-but-uncalled seams are `db.persistState`, `createWriteQueue`, and `db.getSheet`, consumed by M5/M10: they are not dead code and must not be deleted.

## Evaluation criteria

Only optimize for:
1. Employment value
2. Aesthetic pride

Do not optimize for: startup potential · monetization · market size · customer interviews · growth · fundraising · enterprise sales.

## Documentation rule

Before implementing with or changing third-party library APIs, use Context7 for current documentation. Do not rely only on memory for fast-moving APIs. Prioritize official docs for Vite, React, CodeMirror 6, Yjs, y-websocket, y-codemirror.next, Tailwind, Vitest, and Playwright.

## Workflow

**Before any meaningful code change:**
1. Validate current behavior — run tests; read the relevant code.
2. Review `docs/PRODUCT_BRIEF.md`.
3. Confirm an approved active task exists.
4. Use Context7 before touching third-party library APIs.
5. Issue a skeptical challenge to your own implementation plan before committing meaningful changes.

**Before editing a specific file:**
1. Restate the task.
2. Identify files to modify.
3. Explain the acceptance criteria.
4. Ask only if blocked.

**After editing:**
1. Run validation:
   - `npm run test`
   - `npm run test:integration`
   - `npx tsc --noEmit`
   - `npm run build`
   - `npm run test:e2e`
   - `git diff --check`
2. Summarize changed files.
3. State known limitations.
4. Suggest the next smallest task.

**Commit discipline:**
- Prefer small commits and narrow diffs.
- Never commit automatically unless explicitly authorized.
- Do not bundle unrelated changes.

## Checkpoint protection

- `week1-demo` (`ca8bb48`) — never move
- `prototype-v1` (`4147372`) — never move; stable historical collaboration prototype
- Reconstruction work stays on `reconstruction/collab-first` until explicitly changed
