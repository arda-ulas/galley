# Echo/Rewind — Claude Code Instructions

## Project identity

Echo/Rewind is a flagship software engineering portfolio project.

Core idea:
A realtime collaborative code room where users can edit code together, see multiplayer presence/cursors, and scrub a timeline to rewind the coding session.

Week-1 win condition:
One room, two cursors, and a scrubber that reliably reconstructs the past.

Signature demo:
Open `/r/demo` in two browser tabs. Type in one tab. The other updates. Presence/cursors are visible. Timeline markers appear. Drag the timeline backward. The editor enters read-only past mode and shows older code. Click `Return to now`. The live collaborative editor returns.

## Evaluation criteria

Only optimize for:
1. Employment value
2. Aesthetic pride

Do not optimize for:
- startup potential
- monetization
- market size
- customer interviews
- growth
- fundraising
- enterprise sales

## Week-1 must-have

- `/r/demo`
- same room open in two browser tabs
- two visibly distinct tab identities using per-tab `sessionStorage`
- shared CodeMirror 6 editor state via Yjs
- awareness/presence with names, colors, connection state
- remote cursor/selection rendering in live mode
- full-text snapshots after edit pauses
- bottom timeline with markers
- click/drag timeline enters read-only past preview
- editor visibly reconstructs older code from snapshots
- live remote cursors hide or ghost in past mode
- persistent `Viewing the past · [time ago]` pill
- clear `Return to now` action
- returning to now restores the live Yjs-bound collaborative editor
- premium dark developer-tool shell

## Explicit non-goals for week 1

Do not build:
- JavaScript execution
- Run button
- output console
- output pane
- file tree
- editor tabs
- multiple rooms beyond `/r/demo`
- multi-language support
- auth
- database
- durable persistence across reload
- landing page
- onboarding
- command palette
- AI
- chat/comments
- settings
- mobile
- historical cursor replay
- full deterministic replay
- fork button unless it actually works

## Technical baseline

Use:
- Vite
- React
- TypeScript
- CodeMirror 6
- Yjs
- y-websocket
- y-codemirror.next
- Tailwind
- shadcn/ui primitives only when useful
- Framer Motion only for small, feasible UI polish
- Vitest
- Playwright

## Documentation rule

When implementing with third-party libraries, use Context7 for current documentation before coding. Prioritize official docs for Vite, React, CodeMirror 6, Yjs, y-websocket, y-codemirror.next, Tailwind, shadcn/ui, Vitest, and Playwright.

## Implementation behavior

Before using or changing third-party library APIs, check current docs through Context7. Do not rely only on memory for fast-moving APIs such as CodeMirror 6, Yjs, Tailwind v4, Vite, Playwright, or shadcn/ui.

## Visual direction

Name: Amber

The app should feel:
warm dark, temporal, calm, precise, premium, technical, restrained.

Metaphor:
A code room with memory. The timeline feels like a film strip or session afterglow.

Palette:
- Background: `#0D0B09`
- Surface: `#161310`
- Border: `#2A2318`
- Text: `#E8E0D0`
- Muted: `#7A6850`
- Accent amber: `#F5A623`
- User B teal: `#5BB8A0`
- Live green: `#6FCF97`
- Temporal blue: `#5A8FB5`
- Past background: `#08090F`

Avoid:
- generic Tailwind blue
- default shadcn look
- fake AI gradients
- heavy glassmorphism
- playful toy coding app
- busy IDE chrome
- Replit clone visuals
- CodeSandbox clone visuals
- overloaded dashboards

## Product rules

- The project is not a collaborative editor. The project is the timeline.
- Protect the rewind mechanic above everything else.
- Correctness of rewind beats beauty of rewind in week 1.
- Past mode must be unmistakable: read-only, visible mode pill, visual temperature shift, and `Return to now`.
- No dead buttons in the demo.
- No fake output panels.
- The editor owns the screen. The timeline owns the identity.
- Two tabs must read as two different users, not one duplicated user.

## Workflow

Before editing:
1. Restate the task.
2. Identify files to modify.
3. Explain the acceptance criteria.
4. Use Context7 before touching third-party library APIs.
5. Ask only if blocked.

After editing:
1. Run relevant tests/type checks.
2. Summarize changed files.
3. State known limitations.
4. Suggest the next smallest task.

Prefer small commits and narrow diffs.
