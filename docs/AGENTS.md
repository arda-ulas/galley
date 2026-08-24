# Galley — Agent Collaboration Guide

> **Status: superseded / historical.** Active agent instructions live in the root `AGENTS.md` and `CLAUDE.md`; `docs/PRODUCT_BRIEF.md` is the canonical product source and `docs/RECONSTRUCTION_STATUS.md` records the as-built milestone. This guide is preserved as **earlier workflow context** only — do not use it as active implementation authority. Some of its file, architecture, server-ownership, and visual-direction references predate the reconstruction and are stale (for example it names since-removed files and a never-created `docs/DESIGN_DIRECTION.md`). Where anything here conflicts with the root files or the brief, those govern.

---

## Guiding Principles

1. **Small diffs.** Each implementation step produces a narrow, reviewable diff. Do not bundle multiple steps into one commit.
2. **Leave the app runnable.** Every step must keep `npm run dev` working. Never commit a broken build.
3. **Docs before code.** When adding a third-party library integration, read Context7 docs first. Do not rely on training-data memory for fast-moving APIs (CodeMirror 6, Yjs, Tailwind v4, Playwright).
4. **No dead code.** Do not add stubs, feature flags, or commented-out sections. If a feature is not being built in this step, do not add its scaffolding.
5. **No unauthorized side effects.** Do not modify `package.json` versions, do not install new packages, do not push to remote — unless the task explicitly requires it.
6. **No unauthorized commits.** Never create a commit unless explicitly authorized.

---

## Step Handoff Protocol

Before starting a step:
1. Restate the task in one sentence.
2. List the files to be modified.
3. State the acceptance criteria.
4. Identify any third-party APIs that need Context7 verification.

After completing a step:
1. Run the full validation suite before any meaningful code-change commit:
   - `npm run test`
   - `npx tsc --noEmit`
   - `npm run build`
   - `npm run test:e2e`
   - `git diff --check`

   Relevant subsets may be used while iterating; all five are required before committing.
2. List changed files with a one-line summary per file.
3. State known limitations.
4. Suggest the next smallest task. No active reconstruction task tracker exists yet. Work only from an explicitly approved task until a new `docs/TASKS.md` is created.

---

## When to Use Context7

Always use Context7 (`mcp__claude_ai_Context7__resolve-library-id` then `mcp__claude_ai_Context7__query-docs`) before writing code that calls:

- `@codemirror/*` APIs
- `yjs` APIs (`Y.Doc`, `Y.Text`, `Y.Array`, awareness)
- `y-websocket` server or provider
- `y-codemirror.next` extension APIs
- Tailwind v4 config or arbitrary value syntax
- `@playwright/test` APIs

Do not use Context7 for:
- React hooks (stable API)
- TypeScript (stable)
- Vite config basics (stable)
- `framer-motion` basic animate/transition props

---

## Scope Guards

An agent working on this repo must not:

- Add a new npm dependency without explicit user approval
- Modify `package.json` `"version"` field
- Add a landing page, auth flow, settings panel, or command palette
- Add a Run button, output pane, or file tree
- Create a fork button that does not actually work
- Add fake loading states or disabled buttons that are never enabled

The following three guards are **prototype-only** — they reflect `prototype-v1` scope, not active reconstruction rules. The brief supersedes them (retention/persistence is now a disclosed policy; the sheet lifecycle replaces the single hardcoded room). Do not treat them as active mandates:

- ~~Add database migrations or ORM configuration~~ (prototype-only — persistence/retention is now in scope; storage mechanism unresolved)
- ~~Add multiple room support beyond `/r/demo`~~ (prototype-only — reconstruction creates a remote sheet per Share)
- ~~Add mobile-specific breakpoints or responsive layout (desktop only for week 1)~~ (prototype-only — desktop-first still holds, but "week 1" framing is historical; mobile viewing polish is post-v1)

Removing these prototype prohibitions does not authorize persistence, routing, mobile, or other reconstruction work without an explicitly approved task and architecture where required.

---

## Parallelization Policy

Independent subtasks within a step may be parallelized. However:

- Do not parallelize steps that depend on each other's file output (e.g., write a hook, then wire it into a component — sequential).
- Parallel tool calls: Read operations and Context7 lookups can always be parallelized.
- Do not spawn a subagent for a task that fits in the main conversation context.

---

## File Ownership

| File/Directory | Owner | Notes |
|---|---|---|
| `src/lib/room.ts` | Core | Prototype-only implementation path: module-level Y.Doc + WebSocket provider singleton. Reconstruction responsibilities and boundaries remain unresolved; do not refactor without an approved architecture task. |
| `src/lib/snapshots.ts` | Core | Prototype-only implementation path: debounced snapshot observer, snapshots shared via Y.Array. Reconstruction responsibilities and boundaries remain unresolved; do not refactor without an approved architecture task. |
| `src/components/CollaborativeEditor.tsx` | Core | Prototype-only implementation path: current CodeMirror view, Yjs binding, and past-preview integration. Only the local-only preview invariant from D-005 survives as an approved product property; reconstruction responsibilities and component boundaries remain unresolved. |
| `server/index.mjs` | Core | Prototype-only implementation path: custom y-protocols WebSocket server, single hardcoded room. Reconstruction responsibilities and boundaries remain unresolved; do not refactor without an approved architecture task. |
| `docs/` | Documentation | Agent-maintained, human-reviewed |
| `e2e/` | Tests | Must pass before any step is marked done |
| `src/styles/` | Design | Prototype-only: holds the historical Amber tokens. Amber is not the active visual system (see root `CLAUDE.md` / `AGENTS.md`); the reconstruction visual direction is undecided until `docs/DESIGN_DIRECTION.md` exists. |

---

## Commit Message Format

```
<type>(<scope>): <imperative summary>

Types: feat, fix, refactor, test, docs, chore
Scope: sheet, identity, presence, editor, sync, history, server, e2e, docs
```

Examples:
```
feat(sheet): add local draft and Share lifecycle
feat(identity): add per-sheet guest identity
feat(presence): wire remote cursors and selections
feat(history): add bounded Recent versions list
fix(history): preserve local preview while live editing continues
test(e2e): cover two-client sheet synchronization
docs: clarify Recent versions behavior
```
