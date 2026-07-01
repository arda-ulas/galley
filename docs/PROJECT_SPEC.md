# Echo/Rewind — Project Specification

## Identity

**Echo/Rewind** is a realtime collaborative code room where users edit code together, see multiplayer presence and cursors, and scrub a timeline to rewind the coding session to any past moment.

This is a flagship software engineering portfolio project. Every decision is optimized for two things only:

1. Employment value
2. Aesthetic pride

## Core Experience

Open `/r/demo` in two browser tabs. Type in one tab. The other updates in realtime. Presence avatars and remote cursors are visible. Timeline markers accumulate as you type. Drag the timeline scrubber backward. The editor enters a read-only past mode and shows the code as it was at that moment. A persistent pill reads "Viewing the past · 2 min ago". Click "Return to now". The live collaborative editor comes back.

## Week-1 Win Condition

> One room, two cursors, and a scrubber that reliably reconstructs the past.

The demo must be completable without explanation. Every UI element visible in the demo must be functional.

## Room

- Only one room exists: `/r/demo`
- Routing is client-side; the app is a single Vite SPA
- No room creation, no room list, no auth

## User Identity

- Each browser tab generates a unique session identity on first load
- Identity is stored in `sessionStorage` (tab-scoped; persists through refresh within the same tab and clears when the tab is closed)
- Identity includes: `id` (UUID), `name` (adjective + animal, e.g. "Swift Fox"), `color` (from a fixed palette)
- Two tabs in the same browser must read as two different users

## Collaborative Editor

- CodeMirror 6 as the editor component
- Yjs as the shared document model (CRDT)
- `y-websocket` for realtime sync transport
- `y-codemirror.next` for the Yjs ↔ CodeMirror binding
- JavaScript as the single supported language (syntax highlight only, no execution)
- Seeded with starter TypeScript code on first room load

## Presence

- Each connected user is shown in the header presence bar
- Each user has an avatar initial, color, and name tooltip
- Awareness state is broadcast via Yjs awareness protocol
- Remote cursors and selections are rendered inside the editor in live mode

## Timeline

- A horizontal scrubber lives in the footer
- Full-text snapshots are captured after edit pauses (idle debounce ~1.5 s)
- Each snapshot appears as a marker dot on the timeline
- The timeline uses a minimal amber rail with ticked event markers; marker color can reflect the author color; the right edge is now — it should feel like session memory, not a media player
- Hovering a marker shows a tooltip with the relative time ("3 min ago")

## Past Mode

Triggered by clicking or dragging the scrubber to a past snapshot.

- Editor content is replaced with the snapshot's text
- Editor becomes read-only
- Visual temperature shifts (cooler, darker background)
- A persistent pill appears: "Viewing the past · [time ago]"
- Remote cursors are hidden or ghosted
- A "Return to now" button is always visible in past mode
- Clicking "Return to now" restores the live Yjs-bound editor and hides the pill

## Explicit Non-Goals (Week 1)

Do not build any of the following:

- JavaScript execution / Run button / output console / output pane
- File tree or editor tabs
- Multiple rooms beyond `/r/demo`
- Multi-language selection UI
- Auth, user accounts, or persistent identity
- Database or durable persistence across server restart
- Landing page or onboarding
- Command palette
- AI features
- Chat or comments
- Settings panel
- Mobile layout
- Historical cursor replay or full deterministic replay
- Fork button (unless it actually works end-to-end)
