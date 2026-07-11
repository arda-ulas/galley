# Echo/Rewind — Design Audit

> **Status: historical prototype-v1 document.**
>
> This file records the design audit of `prototype-v1` (`4147372`). It is preserved as historical evidence and is not active reconstruction guidance. See `docs/PRODUCT_BRIEF.md` for the canonical product definition.

## Purpose

This audit translates two layers of design research — the Perplexity visual reference pass (`docs/design-research.md`) and the Mobbin direct product comparison (`docs/research/mobbin-ui-reference-pass.md`) — into a constrained, prioritized set of implementation candidates for the existing UI surfaces. It is scoped to visual polish and localized layout decisions on the surfaces that already exist. It does not introduce new product features, new routes, or new architecture.

Audience: the next Claude Code session that will execute one or more of the approved candidates.

---

## Current thesis

Echo/Rewind is not a collaborative editor. It is a timeline. The editor is the canvas; the timeline is the identity. Every UI decision should make that legible at first glance — a reviewer who has never seen the product should understand within five seconds that the temporal mechanic, not the sync, is the point.

---

## What the UI already does well

- **Temperature as state machine.** The warm-dark live palette (`--editor-bg: #0F0D0B`) shifts to cool-dark past palette (`--past-bg: #08090F`) on past-mode entry. This is the right idea and it is already implemented. No learned convention required — pre-attentive perception communicates the mode.
- **Read-only enforcement.** CodeMirror's `readOnly` facet blocks accidental edits in past mode. The past preview never mutates `Y.Text`. Returning to now reattaches the live Yjs-bound editor without a reload. The mechanical contract is correct.
- **Remote cursor ghosting.** Awareness cursors clear on past-mode entry (`cursor: null`). A cursor is a coordinate in the present document; it has no meaning in a past one. The semantics are right.
- **Snapshot deduplication.** Snapshots are deduplicated against the last capture and triggered only by local idle, so two concurrent tabs do not double-record. The timeline markers represent real distinct states.
- **Amber marker dots.** The 7px rounded dots on the timeline rail are legible in screenshots at the current size. They read as "a recorded state exists here" without requiring a legend.
- **Three-row grid.** The `grid-rows-[36px_1fr_52px]` layout correctly allocates the majority of height to the editor with the timeline permanently visible at the bottom. The timeline is never hidden or scrolled off-screen.
- **Monospace elapsed time.** Timestamps on the timeline use `ui-monospace` — this prevents layout shift as elapsed values change.

---

## What is not reading fast enough

**1. Past-mode signal is in the wrong zone.**
The "Viewing the past" pill and "Return to now" button currently live in the header — the same horizontal band as the room name and presence bar. Every directly comparable product (WRITER most explicitly) places the past-mode signal at the boundary between the content and the temporal UI, not above it. The current placement creates a mismatch: the temporal mode signal is in the header, but the temporal UI is at the bottom. A reviewer's eye has to travel the full vertical height of the interface to connect the cause (dragging the timeline) with the effect (the pill in the header).

**2. The scrub handle is not visually distinct.**
The timeline rail responds to pointer events and the current position is tracked, but there is no visible handle shape at the current position. In a screenshot or GIF at portfolio resolution, the "current moment" on the timeline is not immediately legible. The Sentry and Frame.io patterns both confirm that a filled circle (12–14px) at the current position is the minimum affordance.

**3. The timeline rail lacks a bounded zone.**
The timeline strip shares visual surface with the surrounding layout. Sentry's rail has its own distinct dark background band, bounded by a 1px top border. Without that boundary, the timeline reads as a footer decoration rather than a distinct temporal surface with its own identity. At screenshot resolution this registers as "some dots at the bottom" rather than "the timeline is the interface."

**4. The Live chip reads as a label, not a state badge.**
The current connection status renders as a text pill (outline or lightly filled). Circle and Substack both confirm that a live indicator earns its meaning through a solid filled color — not an outline, not a subtle dot. A solid `#6FCF97` fill communicates "actively live" as a pre-attentive signal. The current treatment requires reading the text to confirm the state.

**5. The past pill may use amber.**
If the past pill carries any amber tint, it signals "attention/warning" rather than "temporal shift." Every observed past-mode UI uses a cool-neutral palette for the mode indicator. The pill should use a cool-tinted background and border at the `--past` blue (`#5A8FB5`) rather than any warm-spectrum color.

---

## Evidence from research

All findings below are grounded in at least two independent sources.

| Finding | Perplexity source | Mobbin source |
|---|---|---|
| Past-mode signal belongs adjacent to the temporal UI | Brightcove/Clarity DVR live-edge convention; Notion page history | WRITER past-mode bar; Zoom whiteboard banner |
| Visible scrub handle required at current position | CapCut playhead; DVR live-terminus indicator | Sentry white circle handle; Frame.io circle scrub handle |
| Timeline rail needs its own bounded background zone | Sentry / PostHog dark chrome band | Sentry Replay rail; Sentry compact embed |
| Live chip should use solid fill | Brightcove LIVE indicator glow | Circle solid-filled badge; Substack amber pill |
| Past pill should use cool-neutral palette, not warm | Research consensus on mode-change signals | Every observed past-mode UI in Mobbin pass |
| Screenshot must never crop the timeline | Portfolio GIF composition research | Height distribution observation (85/12/3) |
| Timeline needs 5+ markers before any screenshot | Screenshot composition research | Mobbin screenshot rule |

---

## Design audit findings

### Finding 1 — Status control placement diverges from the temporal UI

The "Viewing the past" pill and "Return to now" button are in the header. The timeline is at the bottom. The user's interaction (dragging the timeline) and the feedback (the mode pill) are maximally separated vertically. In WRITER, the past-mode bar sits immediately above the temporal control zone. In Zoom whiteboard, the state banner is pinned at the content boundary. The pattern is consistent: the mode signal belongs where the user is already looking when they trigger the mode change.

**Impact**: high — this is the conceptual layout issue, not a visual polish issue.

**Proposed fix**: move the past-mode pill and "Return to now" into a compact bottom bar (36–40px) between the editor area and the timeline rail. The bar appears only in past mode; it is absent in live mode. Pill is left-aligned; button is right-aligned.

**Constraint**: this is a localized layout change confined to the AppShell / TimelineScrubber zone. It should not require changes to the three-row grid structure, only the addition of a conditionally rendered row or band within the existing footer area.

### Finding 2 — Scrub handle is invisible in screenshots

The timeline communicates the current position only through internal state, not through a visible affordance. A white filled circle (12px) at the current position would resolve this with a single CSS/SVG addition. Without it, the "current moment" in the timeline is invisible in any screenshot or recording.

### Finding 3 — Timeline rail is not a bounded surface

The rail merges visually with the footer. A 1px top border at `--border: #2A2318` and a distinct background value for the timeline band would give the rail its own zone. This is a 2-line CSS change.

### Finding 4 — Live chip does not carry its weight as a state badge

The current pill treatment reads as a text label. A solid fill (`#6FCF97` for Live, `#F5A623` for Connecting) with dark text on top communicates state as a pre-attentive signal. The fill treatment also photographs better than an outline pill at portfolio resolution.

### Finding 5 — Past pill temperature may conflict with live-mode palette

If the past pill uses any warm color, it conflicts with the temperature-shift signal (warm = live, cool = past). The pill must use the `--past` blue palette: `rgba(90,143,181,0.15)` background, `rgba(90,143,181,0.35)` border, `--text` white for the label text.

---

## Approved implementation candidates

In priority order. No more than five.

1. **[Approved if implementation is small and does not disrupt tests or layout] Move the past-mode status + "Return to now" into a compact bottom bar adjacent to the timeline.** A 36–40px bar that appears only in past mode, positioned between the editor and the timeline rail. Pill left-aligned ("Viewing the past · N ago"), button right-aligned ("Return to now"). This is the strongest conceptual recommendation from the Mobbin evidence — it makes the timeline feel like the interface. It is a localized layout change, not a visual color patch. Classify as approved only if the implementation does not add a new grid row to the root layout, does not break the `data-testid="return-to-now"` selector, and does not shift the timeline rail's vertical position. If the implementation requires more than ~30 lines of JSX/CSS change, defer and do the other four first.

2. **Add a visible scrub handle (12px white filled circle) at the current position on the timeline rail.** This is a self-contained visual addition to the TimelineScrubber component. It directly solves the "current position is invisible in screenshots" problem and matches the Sentry/Frame.io pattern. Lowest risk of the five candidates.

3. **Give the timeline rail a clearly bounded dark surface and a 1px top border.** The timeline band should have `background: var(--timeline-bg)` and `border-top: 1px solid var(--border)` to separate it from the editor surface above. This is a CSS-only change to the timeline wrapper.

4. **Make the Live chip stateful and screenshot-legible.** Replace the current outline-pill treatment with a solid filled chip: `#6FCF97` fill + dark text for the Live state; `#F5A623` fill + dark text for Connecting; muted/outline treatment for Offline. The chip should not animate aggressively — a subtle 2s pulse on the dot is the maximum motion.

5. **Strengthen the cool-neutral past pill treatment.** Whether the pill stays in the header or moves to the bottom bar (candidate 1), apply: `background: rgba(90,143,181,0.15)`, `border: 1px solid rgba(90,143,181,0.35)`, text in `--text` (#E8E0D0). Remove any amber or warm tint from the past pill. The pill reads in a completely different chromatic register from the amber markers on the timeline — this is the intended contrast.

---

## Needs caution

- **Moving status controls from header to bottom bar could affect layout grid and E2E selectors.** The Playwright tests use `data-testid="return-to-now"` and assert the Live indicator in the header. Any move must preserve the `data-testid` attribute value and verify that no test asserts the button's position relative to the header. Confirm selector survival before committing the layout change.

- **A full bottom bar could become too heavy or make the UI feel like a video player rather than a developer tool.** The bar should be 36–40px maximum, no rounded corners on the bar itself, no icons beyond what is already in the pill and button. If it starts to look like a media player transport, it is wrong.

- **Live chip color changes should not make connection state visually compete with temporal mode.** The live indicator is secondary to the past-mode pill. If both are visible simultaneously, the past-mode pill must read as the primary signal. Keep the Live chip on the right side of the header; keep the past pill in its own zone (bottom bar or header left). Never let them share a row at equal visual weight.

- **The scrub handle should not imply continuous video playback.** Snapshots are discrete states, not a continuous stream. The handle should snap to marker positions; it should not drift freely like a video playhead. If the handle is added, make sure the drag behavior still snaps to the nearest snapshot marker rather than landing between them at a meaningless position.

---

## Deferred ideas

Do not implement any of the following. Captured to prevent scope creep.

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

## Screenshot/video recipe

Derived from Mobbin findings and Perplexity composition research.

**Height distribution — never violate this:**
Editor dominates height (~85%), timeline strip (~12%), header (~3%). Never crop the timeline out of any screenshot or GIF frame. If a screenshot doesn't show the full timeline, it is the wrong crop.

**Populate before shooting:**
Always populate 5 or more amber marker dots on the timeline before any screenshot. An empty or near-empty timeline reads as an unfinished prototype. Type real code — not placeholder text — so the markers represent real sessions.

**Past pill legibility:**
The pill must show a meaningful elapsed time ("Viewing the past · 4m 12s ago"), not zero and not a round number. A pill showing "0s ago" or "5m ago" exactly undermines credibility. Stage the session to land at a natural non-round elapsed value.

**GIF / video crop:**
Browser viewport only — no OS window chrome, no dock, no menu bar. Crop to the browser tab edge.

**Six-beat GIF structure:**
1. Live active — both tabs visible, live chip glowing, 5+ markers on rail.
2. Scrub backward — drag the playhead leftward across 3–4 markers.
3. Editor cools + pill appears — hold on the past state; pill shows elapsed time.
4. Hold 1s — let the viewer read the pill and register the cooler temperature.
5. Click Return to now — transition back to live state.
6. Editor warms — live indicator re-glows, cursor returns to active, warm palette restores.

Target loop length: 10–12 seconds. Do not pad to fill the loop — let it cut cleanly.

**Secondary composition — timeline strip detail:**
Produce a standalone 3:2 aspect crop of the timeline strip alone: markers, scrub handle at current position, bounded rail with top border. This is a second portfolio asset for case-study body sections where a full-viewport screenshot is too large.

---

## Implementation prompt

The following is a ready-to-paste Claude Code prompt for a future visual polish session. It is scoped to the approved candidates above and should not be executed now.

```
Task: Visual polish pass on Echo/Rewind per the approved candidates in docs/design-audit.md.

Context:
- Echo/Rewind is a collaborative code room where the timeline is the interface.
- The design audit at docs/design-audit.md lists 5 approved implementation candidates in priority order.
- Do not add product features. Do not introduce new routes, auth, persistence, file tree, Run button, output pane, settings, dashboard, multi-room, branching, historical cursor replay, or architecture changes.

Before touching any component:
1. Read src/components/ in full. Identify the AppShell, TimelineScrubber, ConnectionStatus, and PastModePill (or equivalent) components.
2. Read docs/design-audit.md — Approved implementation candidates section — and confirm you understand all five items.
3. Read docs/research/mobbin-ui-reference-pass.md — Borrow / avoid section.

Implementation order (do these one at a time, run tests after each):

Candidate 2 first (lowest risk):
- Add a 12px white filled circle scrub handle at the current position on the timeline rail inside TimelineScrubber.
- The handle must snap to marker positions, not land between them.
- Run: npx vitest run && npx playwright test

Candidate 3 next:
- Add background: var(--timeline-bg) and border-top: 1px solid var(--border) to the timeline wrapper element.
- This is CSS only — no JSX structural changes.
- Run: npx vitest run && npx playwright test

Candidate 5 next:
- Apply cool-neutral past pill treatment: rgba(90,143,181,0.15) background, rgba(90,143,181,0.35) border, #E8E0D0 text.
- Remove any amber or warm tint from the past pill.
- Run: npx vitest run && npx playwright test

Candidate 4 next:
- Replace the connection status pill with a solid-filled chip: #6FCF97 fill + dark text for Live; #F5A623 fill + dark text for Connecting; muted/outline for Offline.
- Maximum motion: a 2s subtle pulse on the dot only. No other animation.
- Run: npx vitest run && npx playwright test

Candidate 1 last (layout change — proceed only if the above four are clean):
- Move the past-mode pill and "Return to now" into a compact bottom bar (36–40px) between the editor and the timeline rail.
- The bar appears only in past mode. Pill left-aligned. Button right-aligned.
- Do NOT move the Return to now button unless the layout change is confirmed small (no new root grid row, no shift in timeline vertical position, no more than ~30 lines of JSX/CSS).
- Do NOT break the data-testid="return-to-now" selector. Verify with grep before and after.
- Run: npx vitest run && npx playwright test

After all candidates:
- Run: npx vitest run && npx playwright test
- Run: git diff --check
- Do NOT commit. Stop and report:
  - Which candidates were implemented.
  - Which (if any) were skipped and why.
  - Whether all tests pass.
  - Any known visual regressions or concerns.

Constraints:
- No dead buttons.
- No new product features.
- data-testid="return-to-now" must survive any layout change.
- The past-mode temperature shift (warm live → cool past) must remain unmistakable.
- The editor must still own the screen. The timeline must still own the identity.
```
