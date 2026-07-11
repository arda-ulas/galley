# Echo/Rewind — Mobbin UI Reference Pass

> **Status: historical prototype-v1 document.**
>
> This file records design/product research for `prototype-v1` (`4147372`). It is preserved as historical evidence and is not active reconstruction guidance. See `docs/PRODUCT_BRIEF.md` for the canonical product definition.

> Raw Mobbin reference capture. Not all recommendations are approved for implementation.

Source: Mobbin UI reference findings, consolidated 2026-07-01.
Scope: visual reference only — no product features, no excluded systems (no auth, persistence, multi-room, AI, Run button, file tree, output pane, or dashboard).

---

## Reference observations

12 products observed, ranked by directness of analogy to Echo/Rewind surfaces.

### 1. WRITER past-mode bar

A full-width ~40px bar pinned below the document, above nothing. Contains past-date text left-aligned, "Restore" button right-aligned. The past-mode signal does not live in the header or toolbar — it lives adjacent to the content it describes, between the document and any chrome below it.

### 2. WRITER restore toast

After returning to the live state, a transient dark toast appears bottom-right. No full-page state change, no banner, no modal. The restoration is quiet. The live state simply resumes.

### 3. Sentry Replay rail

16–18px dark gray rail, 6–8px categorical colored dots as event markers, a white circle playhead handle at the current position, monospace `00:01 / 00:09` timecode. The rail lives in its own bounded dark background band, visually separated from the viewport above by a clear horizontal boundary. The handle is the only element that distinguishes "current position" from the filled or unfilled rail.

### 4. Sentry compact embed

The same Sentry rail at 12px height — just dots and a timestamp. At extreme compactness it still reads as "events in time." This validates that the marker-dot language scales down without losing meaning.

### 5. Frame.io scrub handle

12–14px white filled circle riding a 3–4px rail. The handle alone distinguishes the scrubber from a decorative bar. Without the handle, the rail is ambiguous; with it, the affordance is immediate.

### 6. Apollo player

Warm amber fill for the elapsed portion, near-zero additional chrome. Closest aesthetic analog to the Echo/Rewind principle of "editor owns the screen, timeline owns the identity." The timeline communicates elapsed state through color temperature, not density.

### 7. Circle "LIVE" badge

Solid red filled pill, positioned bottom-right of the canvas, not in the toolbar. Transient state badge — it appears when the session is live; it disappears or changes when not. The badge earns attention through fill color saturation, not animation or position.

### 8. Substack "LIVE" badge

Amber filled pill, ~24px tall, positioned near the content edge. White text on dark-amber. Readable at a glance without competing with surrounding text. The amber fill allows it to coexist with a warm-dark palette.

### 9. Figma version history

No canvas banner, no floating pill. Past state is silent — only the right panel signals it. This pattern is wrong for Echo/Rewind: without a persistent panel, the past-mode signal would disappear. The Figma pattern assumes the user is already oriented to a panel-first workflow.

### 10. Loom playback

3–4px rail, white handle on hover/drag, 36–40px chrome strip. Light review chrome sits below the video. Light-on-dark feels like a consumer media player, not a developer tool. This is the specific aesthetic to avoid.

### 11. Dropbox Paper cursors

Color-coded name chips adjacent to each cursor, rendered inline with the content. Presence is expressed as text chips, not avatar rings. The name chip anchors presence to a location in the document rather than floating in a toolbar.

### 12. Zoom whiteboard banner

Full-width session-state banner pinned above the canvas. A reference for canvas-adjacent mode signals — the pattern where the state is communicated at the boundary between the chrome and the content, rather than inside either one.

---

## Borrow / avoid

### Borrow

- **WRITER's bottom past-bar convention** — the past-mode signal lives between the document and the timeline, not in the header.
- **Sentry's bounded dark rail band** — the timeline has its own background zone, not the same surface as the editor.
- **Frame.io / Apollo's circle scrub handle** — a visible filled circle at the current position is the minimum affordance for a draggable timeline.
- **Circle's solid-filled LIVE badge** — saturated fill (not outline, not subtle dot) for the live state indicator.
- **Apollo's amber elapsed-rail fill** — temperature-based state communication along the rail.

### Avoid

- **Figma's silent canvas** — no useful signal without a panel. Echo/Rewind has no persistent panel.
- **Loom's light review chrome** — consumer video player aesthetics. Wrong register for a developer tool.
- **Modal / dialog version history** — breaks spatial continuity; the past should appear in context.
- **Thin 2–3px consumer video rails** — too fragile visually, too small to grab in a demo recording.

---

## Tiny polish candidates

Five surface changes grounded directly in Mobbin observations, in priority order:

| # | Change | Mobbin source |
|---|---|---|
| 1 | Move past-mode pill + "Return to now" into a compact bottom bar (36–40px) between the editor and the timeline — pill left-aligned, button right-aligned, appears only in past mode | WRITER |
| 2 | Add a 12px white filled circle scrub handle at the current position on the rail | Frame.io, Sentry |
| 3 | Give the timeline rail its own bounded dark background with a 1px top border at `#2A2318` | Sentry |
| 4 | Solid-filled Live chip with `#6FCF97` fill, dark text, and a subtle glow; amber `#F5A623` fill for the Connecting state | Circle, Substack |
| 5 | Cool-tinted past pill — `rgba(90,143,181,0.15)` background, `rgba(90,143,181,0.35)` border, white text | Every observed past-mode UI |

---

## Deferred ideas

None of the following are approved for week-1 implementation. Captured here so they do not become scope creep.

- Timeline zoom
- Marker hover tooltips
- Named / pinned snapshot versions
- Speed selector
- Comment markers on timeline
- Event log sidebar
- Marker density collapse / activity band clustering
- Keyboard timeline stepping
- Full-height playhead line extending into the editor area
- Animated pill pulse
- Branching / forking
- New replay transport controls
- Architecture changes

---

## Screenshot / video implications

The Mobbin observations reinforce and sharpen the screenshot guidance from `docs/design-research.md`:

- **Height distribution**: editor dominates (~85%), timeline strip (~12%), header (~3%). Never crop the timeline out of any screenshot or GIF frame.
- **Populate before shooting**: always have 5 or more amber marker dots on the rail before any screenshot. An empty or near-empty timeline reads as an unfinished prototype.
- **Past pill legibility**: the pill must show a meaningful elapsed time ("Viewing the past · 4m 12s ago"), not zero or a round number. Staged demos that show "0s ago" undermine credibility.
- **GIF crop**: browser viewport only — no OS window chrome, no dock, no toolbar.
- **Six-beat GIF structure**: (1) live active, both tabs visible; (2) scrub backward; (3) editor cools + pill appears; (4) hold 1s on past state; (5) click Return to now; (6) editor warms, live indicator re-glows. Target 10–12s loop.
- **Detail crop**: a secondary portfolio composition should be a 3:2 crop of the timeline strip alone — showing markers, the scrub handle, and the bounded rail — as a standalone screenshot asset.

---

## Final recommendation

The layout divergence between the current implementation and every directly comparable product is real and confirmed. The past-mode pill and "Return to now" currently live in the header; WRITER (the closest structural analogue) places the past-mode signal at the content boundary — between the document and the temporal UI below it. That one layout change would make Echo/Rewind's live-vs-past mode feel designed rather than assembled.

The other four polish items (scrub handle, rail banding, Live chip fill, past pill tint) improve screenshot legibility and visual coherence but do not change the conceptual architecture of the UI. They should be implemented after the structural question is resolved.

None of the deferred ideas should enter scope. The goal is to shoot the demo video — at that point packaging is sufficient to make the portfolio case.
