# Echo/Rewind — Agent Collaboration Guide

This document defines how AI agents (Claude Code and subagents) should operate in this repository.

---

## Guiding Principles

1. **Small diffs.** Each implementation step produces a narrow, reviewable diff. Do not bundle multiple steps into one commit.
2. **Leave the app runnable.** Every step must keep `npm run dev` working. Never commit a broken build.
3. **Docs before code.** When adding a third-party library integration, read Context7 docs first. Do not rely on training-data memory for fast-moving APIs (CodeMirror 6, Yjs, Tailwind v4, Playwright).
4. **No dead code.** Do not add stubs, feature flags, or commented-out sections. If a feature is not being built in this step, do not add its scaffolding.
5. **No unauthorized side effects.** Do not modify `package.json` versions, do not install new packages, do not push to remote — unless the task explicitly requires it.

---

## Step Handoff Protocol

Before starting a step:
1. Restate the task in one sentence.
2. List the files to be modified.
3. State the acceptance criteria.
4. Identify any third-party APIs that need Context7 verification.

After completing a step:
1. Run type check: `npx tsc --noEmit`
2. Run unit tests: `npm run test`
3. List changed files with a one-line summary per file.
4. State known limitations.
5. Suggest the next smallest task from `docs/TASKS.md`.

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
- Add database migrations or ORM configuration
- Add multiple room support beyond `/r/demo`
- Add mobile-specific breakpoints or responsive layout (desktop only for week 1)

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
| `src/lib/room.ts` | Core — do not fragment | Single Yjs doc + provider singleton |
| `src/lib/snapshots.ts` | Core | Debounced observer, shared with all tabs |
| `src/components/CollaborativeEditor.tsx` | Core | CodeMirror view + Yjs binding |
| `server/index.ts` | Core | y-websocket server — minimal, do not extend |
| `docs/` | Documentation | Agent-maintained, human-reviewed |
| `e2e/` | Tests | Must pass before any step is marked done |
| `src/styles/` | Design | Amber tokens — do not add new color tokens without design review |

---

## Commit Message Format

```
<type>(<scope>): <imperative summary>

Types: feat, fix, refactor, test, docs, chore
Scope: shell, identity, presence, editor, sync, timeline, rewind, server, e2e, docs
```

Examples:
```
feat(identity): add per-tab session identity via sessionStorage
feat(sync): wire CodeMirror to Yjs shared text
feat(rewind): implement past preview mode with read-only editor
test(e2e): add two-tab sync and scrubber Playwright test
docs: add ARCHITECTURE and DECISIONS files
```
