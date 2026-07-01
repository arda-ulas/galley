# Echo/Rewind — Design Research Notes

Sources: three Perplexity research outputs saved under `docs/research/`. Consolidated 2026-07-01.

## Research question

How should Echo/Rewind look, feel, and be presented in a portfolio so that the timeline — not the editor — reads as the product's identity?

> This document synthesizes research guidance — not an implementation plan. Observations, principles, and references here describe what the research suggests, not what is approved to build. Only items listed under "Approved tiny polish candidates" have been filtered for this phase.

---

## Useful references

Ranked by how directly they map to Echo/Rewind's surfaces:

1. **Figma version history / Notion page history** — closest analogues: read-only past view with a clear "back to now" path. Study their mode signaling and exit affordance specifically.
2. **Sentry Replay / PostHog recording player** — slim dark timelines with calm marker dots; defines how snapshot markers should read on the rail.
3. **CapCut editor** — scrubber playhead precision, tick-mark ruler, drag-to-scrub friction.
4. **Brightcove / Cloudflare Stream DVR** — glowing LIVE indicator at the live edge; muted/clickable when behind live edge. Directly analogous to Echo/Rewind's live vs. past pill.
5. **Linear / Raycast / Warp** — premium warm-dark surfaces, restrained accent usage, typographic hierarchy through color not weight.
6. **Screen Studio / Loom** — cooler, quieter "review" register vs. "live" register; also reference for portfolio GIF composition.

---

## Visual principles

Distilled from the visual design research (see `docs/research/perplexity-visual-design-research.md`):

**Temperature is the primary state signal.** Live mode uses warm dark (HSL ~30–40°, low saturation). Past mode shifts to cool dark (HSL ~200–220°). No learned convention required — pre-attentive perception does the work. This is more sophisticated than a blue overlay.

**Surface elevation, not pure black.** The three surfaces in Echo/Rewind should be distinct luminance values: root background (~#0D0B09) → editor surface (~#161310) → timeline panel (slightly recessed or distinct). Elevated elements (pill, button, tooltips) get a 1px `rgba(255,255,255,0.08)` border.

**Accent color rationed.** Total accent surface area under 10% of any view. Each semantic role has its own chromatic assignment: amber for snapshot markers / live glow, teal for user B presence, cool-neutral for the past pill.

**Motion: 150–200ms ease-in-out, no springs.** Spring physics register as playful and elastic — wrong for a temporal precision tool. The return-to-now playhead travel can be 300ms max.

**Monospace for temporal metadata.** Any timestamp or elapsed-time label on the timeline should use a monospace face. This prevents layout jumping as values change.

---

## Timeline/scrubber lessons

- The timeline lane needs a clearly bounded zone with its own background value — it is not the same surface as the editor above it.
- Markers (currently `7px` rounded dots with amber/teal glow) are read clearly. The research suggests diamonds/lozenges as the canonical shape for "a recorded state exists here" — this is a reference, not a requirement; the current dots already work.
- A visible grabble handle at the current position would clarify scrub affordance. The existing rail responds to pointer events correctly; adding a handle shape at the rightmost active marker (or at a "now" indicator) is the low-effort improvement.
- The "now" dot at the right end is correct placement for a live terminus indicator. Making it glow (`box-shadow`) matches DVR LIVE-edge convention.
- Marker density collapse (activity band treatment): deferred — current cap of 30 markers means this is not yet a real problem.

---

## Past mode lessons

**The mode change must be total, not partial.** Research validates the existing direction: read-only is already enforced via CodeMirror's `readOnly` facet. What remains optional:

- A subtle cool-tinted overlay on the editor (`rgba(100,120,160,0.05–0.07)`) to communicate "filter placed over reality, not editor broken." This is a CSS addition to the editor wrapper in past mode.
- The past pill's current amber tint may be too warm. Research says the pill should use cool-neutral palette (white text, dark cool-tinted background). **Candidate for design audit.**
- The text caret disappearing in past mode is already handled by `readOnly`. No additional action needed.
- Remote cursors already clear on past mode entry (awareness `cursor: null`). Correct.

**"Return to now" placement.** Research consensus: position the button near the live terminus of the timeline (right edge), not in a header or toolbar. The current implementation places it in the header area — this is a meaningful divergence from the DVR convention. **Candidate for design audit.**

---

## Screenshot / video lessons

From `docs/research/perplexity-case-study-framework.md` and `perplexity-visual-design-research.md`:

**Static screenshot composition rules:**
- Always show the timeline fully visible in the lower portion — never crop it.
- Position the playhead in the middle-to-left third of the timeline, not at zero or far right.
- Populate the timeline with 5–8 visible markers.
- If showing past mode: capture with the "Viewing the past" pill visible and the Return to now button visible.
- 16:9 for full viewport; 3:2 for tight timeline crops.
- Dark neutral desktop background behind the browser window.

**Demo GIF / video rules:**
- 8–12s max for the hero loop (portfolio hero), 3–4s for inline feature demos.
- Signature gesture: scrub backward → editor cools + pill appears → hold 1s → scrub forward → Return to now → editor warms → live indicator re-glows.
- Use `<video muted autoplay loop playsinline>` not a GIF. MP4 (H.264 or AV1) at 1080p is <2MB vs. 30–50MB for equivalent GIF.
- Record at 2x (Retina) and downsample.
- Crop browser chrome unless unavoidable.

**Portfolio case study structure** (from case-study framework):
1. Above-the-fold: demo video + one-line thesis + stack tags + live demo link + GitHub link.
2. Problem statement (one paragraph).
3. Technical insight (the core architectural idea in plain language — one sentence).
4. Architecture deep dive.
5. Decisions and tradeoffs (2–3 with what was chosen and what was given up).
6. Scope and deliberate constraints (framed as decisions, not failures).
7. Credibility layer (tests + named edge cases).
8. Honest reflection.

---

## What to avoid

From both research sources, directly applicable:

- **Heavy color overlay on the editor in past mode.** A `rgba(0,0,60,0.4)` tint makes code illegible. The shift should be temperature, not opacity.
- **The past pill styled in a warning color.** Red or amber registers as "you did something wrong." Cool-neutral only.
- **Spring physics on the timeline.** Cubic-bezier ease-in-out only.
- **Pure black (`#000000`) as any surface.** Collapses depth. All darks are warm near-black.
- **Thin un-grabbable scrubber.** The rail is 32px tall with pointer events — this is fine. Do not reduce it.
- **Hiding the timeline below the fold.** Timeline must be permanently visible.
- **Generic video-player aesthetics.** Round play buttons, volume sliders. Reference NLE/dev-tool, not YouTube.
- **Startup hype language in the case study.** No "reimagined," "seamless," "innovative," "powerful," "leveraged."
- **Architecture diagrams that invent non-existent patterns.** Echo/Rewind uses Yjs CRDT for live sync and full-text snapshots for rewind — it is not event-log replay, OT, or LWW.

---

## Approved tiny polish candidates

Candidates for design audit — not final approved implementation:

1. Strengthen the cool-neutral "Viewing the past" pill contrast/readability.
2. Make "Return to now" read more clearly as the live-edge escape hatch.
3. Make the selected timeline marker / scrub state more visible in screenshots.
4. Slightly strengthen the warm-live to cool-past temperature shift.
5. Improve screenshot/video composition guidance around the scrub moment.

---

## Deferred ideas

Do not implement in week 1. Captured here so they do not get forgotten but do not become scope creep:

- **Diamond/lozenge marker shape.** Current rounded dots work. A shape change is a visual refactor with no functional benefit right now.
- **Full-height playhead line into editor.** A vertical line spanning editor + timeline is a premium detail but requires careful z-index and layout work.
- **Marker density collapse / activity band clustering.** Only relevant when a session exceeds ~30 markers. The cap handles this.
- **Keyboard timeline stepping** (arrow keys step through snapshots). Premium signal; not in scope for week 1.
- **Timeline zoom / horizontal scale.** Not needed for a single-rail, capped-30-marker timeline.
- **Hover preview popovers** (mini code peek on marker hover). Interesting but requires a popover with text rendering.
- **Animated pill pulse.** The research suggests a subtle pulse every 4–6s to remind the user they are in past mode. Polish; not a blocker.
- **Branching / forking.** Explicitly excluded from week 1 scope.
- **New replay controls.** Any transport controls beyond the existing scrub handle are out of scope.
- **Moving/relocating major UI elements before a design audit.** Structural layout changes should wait until after a focused design audit.
- **Architecture changes.** The Yjs CRDT + full-text snapshot model is settled. No sync or storage architecture changes in week 1.
