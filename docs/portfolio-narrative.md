# Echo/Rewind — Portfolio Narrative

Working thesis, everywhere, always: **the timeline is the interface.** Every artifact below is built to make a reviewer feel one moment — dragging the playhead and watching code un-write itself — and to make the engineering behind that moment legible.

---

## 1. Strongest one-liner

**Primary (repo header, portfolio card, verbal):**

> Multiplayer code editing you can rewind.

Five words, concrete, and the name pays it off. Reviewers skim; abstract taglines lose them, this one makes them picture it.

**Expanded (case study opener, link previews):**

> Echo/Rewind is a realtime collaborative code room where the timeline is the interface — two people type together live, then drag backward and the room reconstructs its past.

**Resume bullet form:**

> Built Echo/Rewind, a realtime collaborative code editor (React, CodeMirror 6, Yjs CRDT) with a scrubbable session timeline that reconstructs past document states in a read-only preview — without interrupting live collaboration.

---

## 2. Case-study intro (3 paragraphs)

Every collaborative editor treats history the same way: a log you consult when something goes wrong. Version history lives behind a menu, three clicks from the work. Echo/Rewind starts from the opposite premise — in a room where two people are writing code together, the session's past is part of the room. The timeline isn't a feature under the editor; it's the interface. Everything else in the app exists to make one gesture trustworthy: drag backward, and the room shows you exactly what it looked like then.

In practice: open `/r/demo` in two tabs and you're two users — distinct names, colors, live cursors — editing a shared CodeMirror 6 document synced over a Yjs CRDT. As you work, the room captures a snapshot whenever typing pauses and pins it to a timeline along the bottom of the screen, like frames on a film strip. Drag the playhead back and the editor slips into past mode: read-only, cooler in temperature, a persistent "Viewing the past" pill, remote cursors ghosted out. What's on screen is an exact reconstruction of that moment. One click on "Return to now" and the live, collaborative present resumes — no reload, nothing lost.

The engineering interest is in the boundary between those two states. The live editor is bound to shared CRDT state; the past view is deliberately inert — a local read-only preview that never mutates the shared document, so one user can wander through history while the other keeps typing in the present. Even the room's memory is shared state: snapshots live in a Yjs array synced by the same CRDT as the code, so both users see the same timeline. I chose full-text snapshots over event replay on purpose — reconstruction at any marker is exact and instant regardless of session length. The same bias toward trust shapes the surface: past mode is unmistakable rather than subtle, every visible control works, and the scope is small enough that nothing in the demo is fake.

---

## 3. Demo narration script (~90 seconds)

Setup before recording: both tabs open at `/r/demo`, both showing **Live**, a few lines of real code already written so the timeline has 4–6 markers. Type real code during the demo, never `asdf`.

1. **[Two tabs side by side]** "This is Echo/Rewind — a collaborative code room. Same room, two tabs, two different users. Each tab gets its own identity — name, color, cursor."
2. **[Type a line in the left tab]** "Anything I type lands in the other tab instantly. Under the editor is a Yjs CRDT, so concurrent edits merge instead of conflicting."
3. **[Move cursor / select in the right tab]** "Presence is live too — that's the other user's cursor and selection, rendered in their color."
4. **[Stop typing; point at the timeline as a marker appears]** "When the room goes quiet for a moment, it takes a snapshot. Each marker on this timeline is a moment the room remembers — and the timeline itself is shared state, so both users see the same memory."
5. **[Begin dragging the playhead backward]** "Here's the point of the project. I drag the timeline back—"
6. **[In past mode]** "—and the room reconstructs its past. The editor goes read-only, the light gets cooler, and this pill tells me exactly how far back I am. The other user's cursor ghosts out — presence belongs to the present."
7. **[Scrub across several markers]** "I can scrub anywhere. Every frame is an exact reconstruction of the document at that moment, not an animation."
8. **[Optional — verify it's solid in your build first: type in the right tab while the left views the past]** "Meanwhile the other user is still live. My trip into history is local — it never touches the shared document."
9. **[Click Return to now]** "One click and I'm back in the live room — collaboration, cursors, everything, no reload."
10. **[Hold on the full shell]** "That's the thesis: the timeline isn't a history menu, it's the interface. A code room with memory."

Beats 5–7 are the payload. Slow down there; let the un-writing be visible. Everything before it is setup, everything after is landing.

---

## 4. What to emphasize technically

Ordered by seniority signal — lead with the boundary, not the sync.

- **The live/past boundary.** The differentiated engineering is not making two editors converge (Yjs does that); it's entering history without contaminating it. The past preview is pure local state that never mutates `Y.Text`, and returning to now restores the live binding without a reload. Say it as: "The hard part wasn't sync — it was making time travel side-effect-free."
- **History as shared state.** Snapshots live in a `Y.Array` on the same document, synced by the same CRDT as the code — one source of truth, both users see identical timelines. Capture is debounced on idle, triggered only by local transactions, and deduped against the last snapshot so two peers don't double-record.
- **Presence semantics.** Awareness carries name, color, cursor, connection state. Two design decisions worth saying out loud: per-tab identity via `sessionStorage` (with `localStorage`, two tabs would collapse into one user), and ghosting remote cursors in past mode (a cursor is a coordinate in the present document; it has no meaning in a past one).
- **Testing multiplayer for real.** 13 Playwright tests across two browser contexts assert convergence, awareness cleanup when a tab closes, drag-scrub via pointer events, and a genuine race — starter code seeding exactly once when two tabs open concurrently. Plus 42 unit tests on snapshot/timeline logic. Testing distributed behavior, not just components, is the senior tell.
- **The snapshot tradeoff, framed as judgment.** Full-text snapshots make reconstruction exact and O(doc), independent of session length — correctness first, storage elegance later. State it as a decision, not a limitation.
- **Scope as a skill.** What was cut (and that it was cut on purpose) demonstrates engineering judgment as much as what was built.

---

## 5. What to emphasize emotionally / design-wise

- **The temperature shift is the state machine made visible.** Present is warm amber; past is cooler and darker. You feel *when* you are before you read any label. This is the design idea worth explaining to reviewers — mode communicated through light, not chrome.
- **Mode clarity as kindness.** Read-only editor + persistent pill + ghosted cursors: nobody ever edits the past by accident, and nobody is ever unsure which world they're in. Frame ambiguity as the thing the design refuses to allow.
- **The scrub is the emotional payload.** Watching code un-write itself is quietly uncanny. Every demo, GIF, and screenshot should be built around that moment; protect its smoothness above all else.
- **Restraint reads as premium.** The editor owns the screen; the timeline owns the identity. No panels, no chrome, no toy energy — a serious dark instrument, not an IDE cosplay.
- **Honesty as an aesthetic.** No dead buttons, no fake output panes — everything visible works. Say this sentence to reviewers; hiring managers notice it because most portfolio demos violate it.
- **Metaphor budget: one per artifact.** "A code room with memory" / the film-strip timeline. Used once, it's evocative; repeated, it's marketing.

---

## 6. What NOT to mention unless asked (with answers ready)

- **In-memory only, nothing survives a server restart.** If asked: "Deliberate — persistence is a storage problem, not an interface problem, and week one was about proving the interface."
- **Full-text snapshots rather than deltas.** Don't volunteer the internals as a caveat. If asked: "Chosen for exactness — every marker reconstructs perfectly with zero replay drift. Delta encoding is an optimization that doesn't change the UI contract."
- **One hardcoded room.** If asked: "Scope — multi-room is plumbing, and week one went to the mechanic, not the plumbing." (Don't claim it's already parameterized; the provider in `room.ts` is a deliberate week-one singleton.)
- **No historical cursor replay.** If asked, it's a design position: "The past shows the document, not the people. Presence is a property of now." (Note this genuinely sounds considered — because it is.)
- **How long it took.** "Built in a week" invites the prototype discount. Let the scope read as intentional; share the timeline only if asked directly.
- **AI-assisted workflow.** `CLAUDE.md` is in the repo, so never deny it — but don't lead with it either. If asked: "Yes — spec'd and directed with AI in the loop; the architecture decisions, scope cuts, and taste are mine, and I can defend any line of it."
- **Competitor names.** Never say Replit, CodeSandbox, or VS Code Live Share first. If a reviewer raises them: "Those are environments. This is one mechanic, done properly."
- **Bundle size.** If asked, quote minified+gzip (the meaningful number), not the 846 kB unminified figure.
- **Any roadmap.** A finished small thing beats a promising big one. Resist "next I'll add…" entirely.

---

## 7. README copy improvements

The current README is honest and complete — good bones. Three problems: it leads with an inventory instead of the mechanic, the reader can't *see* anything, and "Known limitations" apologizes for decisions the project should own.

**Fix 1 — the first screenful must show the scrub.** Add a looping GIF/video of beats 5–9 of the demo script directly under the tagline. A reviewer should see code un-write itself within five seconds of landing, before any prose. This is the single highest-leverage change. (`docs/demo.gif` doesn't exist yet — recording it is the one asset this plan depends on.)

**Fix 2 — replace the "Features" checklist with the mechanic.** A feature list reads as inventory and buries the thesis (realtime editing is currently listed first, but the project is the timeline). Lead with two short paragraphs: what the room does, then how rewind works.

**Fix 3 — rename "Known limitations" to "Deliberate scope."** Same facts, opposite frame: "in-memory only," "one room," "no auth/persistence" are week-one decisions, not defects. Keep genuine limitations (the seed duplication note) separate and brief. Drop the unminified bundle number; report gzip or nothing.

**Fix 4 — make the demo path a numbered ritual ending at the payoff.** The "both tabs must show Live" note is great — fold it into the steps rather than a floating caveat.

Ready-to-paste top half:

```markdown
# Echo/Rewind

**Multiplayer code editing you can rewind.**

A collaborative code room where the timeline is the interface. Two people edit
one document live — presence, cursors, CRDT sync — and the room remembers:
whenever typing pauses, it snapshots the document onto a shared timeline.
Drag the timeline backward and the editor reconstructs that exact moment in a
read-only past preview, cooler in tone and clearly labeled, while the live
session keeps flowing underneath. One click returns you to now.

![Scrubbing the timeline into past mode](docs/demo.gif)

## Try it in 60 seconds

1. `npm run server` — in-memory y-websocket room server
2. `npm run dev` — Vite dev server
3. Open `http://127.0.0.1:5173/r/demo` in **two tabs**; wait for both to show **Live**
4. Type in one tab, watch the other. Pause — a marker lands on the timeline.
5. Drag the timeline backward. Then click **Return to now**.

## How rewind works

Snapshots are full-text captures taken after a 1.5s typing pause, deduplicated,
and stored in a `Y.Array` on the same Yjs document as the code — the room's
memory is shared state, so every user sees the same timeline. Scrubbing renders
a snapshot in a local read-only preview that never mutates the shared `Y.Text`;
your trip into the past is invisible to collaborators. Full-text snapshots were
a deliberate choice: reconstruction at any marker is exact and instant,
independent of session length.

## Deliberate scope (week 1)

One room (`/r/demo`), in-memory server, no auth, no persistence across restart.
The week-one bet was the interface: prove that rewind can be trusted before
making it durable.
```

Keep the existing Tech stack line and Testing section as-is — but in Testing, add one sentence above the commands: *"The Playwright suite runs two real browser contexts and asserts sync convergence, awareness cleanup on tab close, drag-scrub via pointer events, and race-safe seeding when two tabs open at once."* That sentence does more hiring work than the commands do.

---

## 8. LinkedIn / GitHub post draft

> I built a code editor where you can rewind the room.
>
> Echo/Rewind is a realtime collaborative code room — two people, one document, live cursors — with one unusual property: the session's history is draggable. When typing pauses, the room snapshots the document onto a timeline. Scrub it backward and you get a read-only reconstruction of any moment, clearly marked as the past; one click returns you to the live present.
>
> The premise: collaborative editors bury history behind a menu. I wanted it under your hand — the timeline as the interface, not a feature.
>
> The hard part wasn't sync (Yjs + CodeMirror 6 are excellent). It was the boundary: entering history without leaking a single edit into the shared document, and returning without a reload. Even the timeline itself is CRDT-synced state — both users see the same memory.
>
> React · TypeScript · CodeMirror 6 · Yjs · Playwright-tested across two browser contexts.
>
> Demo + code: [link]

No hashtags, or at most `#frontend #crdt`. Attach the scrub GIF — the post exists to deliver that ten seconds of video.

**GitHub repo "About" field:**

> Multiplayer code editing you can rewind — a collaborative code room (Yjs + CodeMirror 6) where the timeline is the interface.
