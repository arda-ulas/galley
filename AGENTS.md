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

## Current prototype baseline

**Status: historical implementation — not approved reconstruction architecture.**

The code on this branch reflects the `prototype-v1` implementation. It is useful technical foundation but is not the approved reconstruction target. Do not treat prototype code as the specification for reconstruction.

Notable prototype patterns and their reconstruction status:

- `src/lib/room.ts` — module-level Y.Doc singleton, no teardown. **Under review.**
- `server/index.mjs` — custom y-protocols WS server, single `/r/demo` room, server-side seeding. **Under review.**
- `src/lib/snapshots.ts` — 1500ms idle-debounce snapshot recorder. **Under review** (cadence and bound are open details).
- `src/components/CollaborativeEditor.tsx` — local-only past-preview pattern. **Preserved** — the local-only preview invariant (D-005) survives reconstruction.
- `src/styles/tokens.css` — Amber token set. **Historical** — visual direction is undecided.

Persistence, sheet identity, routing, guest identity migration, and Recent versions storage remain open architecture decisions. Do not speculatively refactor before architecture approval.

**Prototype stack:** Vite · React · TypeScript · CodeMirror 6 · Yjs · y-websocket · y-codemirror.next · Tailwind · shadcn/ui · Framer Motion · Vitest · Playwright

## Visual direction

**Status: undecided.**

"Amber" is the prototype visual system. It is historical design, not the active visual direction for reconstruction.

Future design research will determine the visual direction. No visual system is active until `docs/DESIGN_DIRECTION.md` exists and is committed.

Do not apply amber tokens, amber metaphors, or "film strip / session afterglow" framing to reconstruction work.

## Architecture status

`docs/ARCHITECTURE.md` describes `prototype-v1`. Reconstruction architecture is not yet approved.

The one architectural property confirmed to survive reconstruction: the **local-only preview invariant** — viewing history never mutates the live Y.Doc (D-005).

Do not speculatively refactor `room.ts`, the server, snapshot storage, or routing before architecture is approved.

## Evaluation criteria

Only optimize for:
1. Employment value
2. Aesthetic pride

Do not optimize for: startup potential · monetization · market size · customer interviews · growth · fundraising · enterprise sales.

## Documentation rule

Before implementing with or changing third-party library APIs, use Context7 for current documentation. Do not rely only on memory for fast-moving APIs. Prioritize official docs for Vite, React, CodeMirror 6, Yjs, y-websocket, y-codemirror.next, Tailwind, shadcn/ui, Vitest, and Playwright.

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
