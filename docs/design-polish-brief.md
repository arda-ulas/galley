# Echo/Rewind — Claude Design Polish Brief

## Purpose

This brief packages the outputs of `docs/design-audit.md`, `docs/design-research.md`, and `docs/research/mobbin-ui-reference-pass.md` into a single handoff document for a Claude Design `/design-sync` session. The goal is a focused visual polish pass — no new features, no architecture changes, no new dependencies — that makes the existing UI read as designed rather than assembled, specifically in time for recording the portfolio demo video.

---

## Product thesis

Echo/Rewind is not a collaborative editor. It is a timeline. The editor is the canvas; the timeline is the interface. A reviewer who has never seen the product should understand within five seconds that the temporal mechanic — dragging backward and watching code un-write itself — is the point, not the sync.

**Working one-liner:** Multiplayer code editing you can rewind.

**Mode duality is the core design contract.** Live mode is warm dark (amber, presence, cursors active). Past mode is cool dark (read-only, pill visible, cursors ghosted). These two states must be unmistakable from each other. Every visual decision serves this distinction or gets deferred.

---

## Current visual direction

Name: **Amber.**

Aesthetic target: warm dark, temporal, calm, precise, premium, technical, restrained. The metaphor is a code room with memory — the timeline feels like a film strip or session afterglow. Past mode is a cooler, quieter world; the present is warm.

Avoid at all costs: generic Tailwind blue, default shadcn look, fake AI gradients, heavy glassmorphism, playful toy coding app energy, busy IDE chrome, Replit/CodeSandbox clone visuals, overloaded dashboards, consumer video player aesthetics (round play buttons, volume sliders).

Reference products (ranked by directness of analogy):
- WRITER past-mode bar — mode signal at the content boundary, not in the header
- Sentry Replay rail — bounded dark band, dot markers, white circle scrub handle
- Frame.io / Apollo — circle scrub handle at current position, amber elapsed fill
- Brightcove / Cloudflare Stream DVR — glowing LIVE indicator at the live terminus
- Circle / Substack — solid-filled state badges, not outline pills

---

## Existing palette / tokens

Extracted from `/Users/ardaulasozdemir/Projects/echo-rewind/src/styles/tokens.css` exactly as defined. No values invented.

```css
/* Page */
--bg: #0D0B09;          /* Root page background */
--panel: #161310;       /* Editor container, header, footer, timeline wrapper */
--panel-strong: #1E1A14; /* Header and elevated inner surfaces */
--border: #2A2318;      /* Primary borders, timeline tick marks, rail line */
--border-subtle: #1F1B14; /* Dividers, subtle separators */

/* Text */
--text: #E8E0D0;        /* Primary readable text */
--muted: #7A6850;       /* Labels, line numbers, secondary text, "now" label */

/* Accent */
--accent: #F5A623;      /* Amber — snapshot markers (even-index), logo arrow, elapsed rail, now dot */
--presence-teal: #5BB8A0; /* User B / second presence color, odd-index markers */

/* State */
--success: #6FCF97;     /* Live green — connection dot and text, now marker glow */
--past: #5A8FB5;        /* Temporal blue — past pill label, selected marker outline */
--past-bg: #08090F;     /* Editor background in past mode (cool near-black) */
--danger: #F87171;      /* Offline state indicator */

/* Editor */
--editor-bg: #0F0D0B;   /* Editor background in live mode (warm near-black) */
--editor-text: #D4C9B4; /* Editor code text */
--editor-line: #3A3020; /* Line number text */

/* Timeline */
--timeline-bg: #0E0C0A; /* Timeline track background (distinct from --panel) */
```

User presence colors rotate through: `#F5A623` (amber), `#5BB8A0` (teal), `#A78BFA` (violet), `#F87171` (rose), `#34D399` (emerald). These are hardcoded in the presence hook, not CSS variables.

---

## Current UI surfaces

### Header / status area
Source: `src/components/AppShell.tsx` (line 42–57), `src/components/ConnectionStatus.tsx`, `src/components/PresenceBar.tsx`

A `<header>` element at `h-[36px]`, `bg-[var(--panel)]` (#161310), `border-b border-[var(--border)]`. Layout is flex with space-between.

- **Left:** Mono logotype — `↻` arrow in `--accent`, then `echo / {roomId}` in `--muted`. `font-mono text-xs tracking-wide`.
- **Right (left to right):** `ConnectionStatus` → `PresenceBar` → Share button.
- **ConnectionStatus** (live state): inline dot (`size-1.5 rounded-full bg-[var(--success)]`) + "Live" text in `--success`. No background fill, no border pill. Just colored dot + text.
- **ConnectionStatus** (connecting): outline dot (`border border-[var(--muted)]`) + "Connecting" text in `--muted`.
- **ConnectionStatus** (offline): solid dot in `--danger` + "Offline" text in `--danger`.
- **PresenceBar:** `-space-x-2` stacked `size-7 rounded-full` avatar circles with colored initials. Local user border: `--accent`. Remote user border: `--panel`. No presence count label.
- **Share button:** `rounded border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--muted)]`, hover changes to `--accent`.

No past-mode pill or Return to now in this zone.

### Editor surface
Source: `src/components/AppShell.tsx` (line 59–65), `src/components/CollaborativeEditor.tsx`

A `<section>` element filling the middle row (`1fr`). `min-h-0 overflow-hidden`. Background transitions: live mode uses `bg-[var(--editor-bg)]` (#0F0D0B warm near-black), past mode uses `bg-[var(--past-bg)]` (#08090F cool near-black). Transition: `transition-colors duration-700`. The temperature shift already works.

`CollaborativeEditor` mounts a CodeMirror 6 view at full height, no outer padding, no filename tab, no output pane. Live mode: `yCollab` extension bound to the shared `Y.Text`. Past mode: `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)`, content set from the snapshot text string.

### Past-mode state
Source: `src/pages/RoomPage.tsx` (line 74–101)

The pill and Return to now button live inside a `relative h-full` wrapper around the editor content section — not inside the `<header>`. The pill is positioned `absolute top-3 left-1/2 z-10 -translate-x-1/2` — top-center of the editor area, 12px below the header's bottom edge.

Current pill styling:
- Outer: `rounded-full border bg-[var(--panel)] px-4 py-1.5 font-mono text-[11px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]`
- Background: `var(--panel)` = `#161310` (warm dark — not cool-tinted)
- Border: class `border-[var(--border)]` overridden by inline `style={{ borderColor: "rgba(90,143,181,0.35)" }}` — so the border IS already cool-tinted
- "Viewing the past" label: `text-[var(--past)]` (#5A8FB5 cool blue) ✓
- Elapsed time: `text-[var(--muted)]` (#7A6850 warm amber-muted) — warm in a cool signal
- "Return to now" button: `text-[var(--text)]` (#E8E0D0), underline on hover, `data-testid="return-to-now"`

Pill enters/exits with Framer Motion `opacity`/`y` fade (`duration: 0.18, ease: easeOut`).

### Timeline rail
Source: `src/components/TimelineScrubber.tsx`, `src/components/AppShell.tsx` (line 67–69)

Footer element: `h-[52px]`, `border-t border-[var(--border)]`, `bg-[var(--panel)]`. TimelineScrubber overrides with `bg-[var(--timeline-bg)]` (#0E0C0A) at the outermost div — so the background is distinct from `--panel`. The `border-t` is on the AppShell footer, which provides a visible horizontal separator.

Rail element: `relative flex-1 h-8` with `data-testid="timeline-rail"`. Contains:
- Full-width thin line: `h-px bg-[var(--border)]` at vertical center
- Amber elapsed rail: `h-px bg-[var(--accent)]` at opacity 0.3, hardcoded to 84% width (not dynamic)
- 9 tick marks at evenly spaced positions, `h: 10px` for endpoints, `6px` for interior ticks, `bg-[var(--border)]`
- **No visible scrub handle or playhead circle at the current position**

Right side: a separate flex column outside the rail with a `size-2 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]` "now" dot and "now" label in `font-mono text-[10px] text-[var(--muted)]`.

### Snapshot markers
Source: `src/components/TimelineScrubber.tsx` (line 105–143)

Each marker is a `motion.button` hit-target of `size-6` (24px) centered on the rail, rendering a `size-[7px] rounded-full` dot as the visible mark.

- Color: even-index markers use `var(--accent)` (#F5A623), odd-index use `var(--presence-teal)` (#5BB8A0)
- Normal state glow: `box-shadow: 0 0 6px {color}`
- Selected state: `scale: 1.5`, `outline: 2px solid var(--past)`, `outlineOffset: 2px`, `box-shadow: 0 0 12px {color}`
- Entry animation: `opacity 0 → 1, duration 0.2`

Marker position is `left: {marker.position}%` where `position` is a percentage across the rail. Title tooltip shows relative elapsed time.

### Return to now control
Source: `src/pages/RoomPage.tsx` (line 91–98)

Rendered inline inside the past-mode pill (described above). It is a `<button>` with `data-testid="return-to-now"`. Styled as an inline text link — no background, no border, no contained shape. Underline appears on hover only. Shares the pill's position: top-center of the editor area, ~48px below the top of the viewport.

### Presence / cursors
Source: `src/components/PresenceBar.tsx`, `src/components/CollaborativeEditor.tsx`

Presence avatars: `PresenceBar` renders stacked colored initial circles in the header (described above). Remote cursor/selection rendering inside the editor is handled by `yCollab` from `y-codemirror.next`. On past-mode entry, `provider.awareness.setLocalStateField("cursor", null)` clears the local cursor — remote cursors disappear because the awareness state is nulled and the `yCollab` extension is not mounted in past mode (a fresh read-only `EditorView` is created from the snapshot text).

---

## Current design problem

Two problems confirmed by research and Mobbin reference pass:

**Primary — past-mode signal is vertically displaced from the temporal control.** The "Viewing the past" pill appears at the top of the editor area (12px from the top of the screen). The timeline the user just interacted with is at the bottom of the screen, 52px above the viewport floor. A user drags an element at the bottom and must look to the top to confirm the mode change. Every directly comparable product (WRITER, Zoom whiteboard, Brightcove DVR live-edge) places the mode signal at the boundary between the content and the temporal control — adjacent to where the user's hand and eye already are. The current placement creates maximum vertical travel between cause and effect.

**Secondary — temporal UI pieces lack portfolio legibility.** In a GIF or screenshot at reduced resolution: (1) there is no visible scrub handle marking the current position on the timeline — "where is the playhead?" is unanswerable from a screenshot; (2) the connection status reads as text label rather than a state badge at small sizes; (3) the past pill background is warm-neutral (`--panel` #161310) rather than cool-tinted, so the temperature contrast between the pill and the live-mode palette is weaker than intended.

---

## Proposed polish changes

In priority order per `docs/design-audit.md`.

**1. Compact bottom past-mode bar**

Move the past-mode pill and "Return to now" button out of the top-center editor overlay and into a compact 36–40px bar positioned between the editor area and the timeline rail. The bar is conditionally rendered: present only in past mode, absent in live mode. Pill is left-aligned ("Viewing the past · N ago"). "Return to now" is right-aligned. The bar shares the same horizontal band as the timeline — where the user's eye already is after scrubbing. Source reference: WRITER past-mode bar (Mobbin). Implementation boundary: a conditional row or band within the existing footer zone — no new root grid row, no timeline vertical position shift, `data-testid="return-to-now"` must survive on the button.

**2. Scrub / current-position handle**

Add a visible 12px white filled circle at the current position on the timeline rail — the position of the selected marker when in past mode, or at the "now" terminus when live. This is a self-contained visual addition inside `TimelineScrubber`. Without it, the "current moment" on the timeline is invisible in any screenshot or GIF recording. Source reference: Frame.io scrub handle, Sentry Replay white circle playhead. The handle should visually sit on the rail, snapping to marker positions rather than drifting between them.

**3. Bounded timeline surface**

Give the timeline rail a clearly bounded dark zone with an explicit own-background treatment. Currently the `TimelineScrubber` outermost div carries `bg-[var(--timeline-bg)]` (#0E0C0A) and the AppShell footer has `border-t border-[var(--border)]`. Visually this may not read as a fully bounded temporal surface in screenshots depending on how much the #0E0C0A vs #161310 contrast registers. The fix is to confirm (and if needed strengthen) that the rail band has its own distinct background value and the 1px top border at `var(--border)` (#2A2318) is visually visible. This is a CSS-only verification/tweak, potentially as simple as confirming the existing values are sufficient at portfolio resolution or slightly deepening the band's own-background to make the zone unmistakable. Source reference: Sentry Replay rail, Sentry compact embed.

**4. Cool-neutral past pill**

Apply the full cool-neutral treatment to the past-mode pill background. Currently: border is already `rgba(90,143,181,0.35)` (cool, correct). Background is `var(--panel)` (#161310, warm). Change background to `rgba(90,143,181,0.15)` to match the cool-tinted reference from the design audit. This eliminates the warm-background / cool-border mismatch. The elapsed time in `--muted` (#7A6850) should also shift to `--text` (#E8E0D0) or `--past` (#5A8FB5) so the pill reads in a single cool register. Source reference: every observed past-mode UI in the Mobbin reference pass.

**5. Live chip evaluation**

Evaluate replacing the current connection-status treatment (colored dot + text, no fill) with a solid-filled state badge: `#6FCF97` fill + dark text on a shaped pill for the Live state; `#F5A623` fill + dark text for Connecting; muted outline for Offline. The design audit classifies this as a "state badge" vs "text label" distinction. The solid fill earns meaning pre-attentively without requiring the reviewer to read the text. This is a change to `ConnectionStatus.tsx` only. Caution: if both the past-mode pill and the Live chip are simultaneously visible, the Live chip must not compete visually with the past pill. The chip should remain right-aligned in the header; its visual weight must stay secondary to the past-mode signal. This is listed as an evaluation candidate — implement only if the approach does not make the header feel heavier or more video-player-like than the current treatment.

---

## Non-goals

The following are explicitly out of scope for this polish pass. Do not design, propose, or prototype any of these.

- JavaScript execution, Run button, output console
- File tree, editor tabs, multiple rooms beyond `/r/demo`
- Multi-language support, auth, database, durable persistence
- Landing page, onboarding, command palette, AI, chat/comments, settings
- Mobile layout
- Historical cursor replay or full deterministic replay
- Fork button, branching
- Timeline zoom, marker hover tooltips, named/pinned snapshot versions
- Speed selector, comment markers, event log sidebar
- Marker density collapse / activity band clustering
- Keyboard timeline stepping
- Full-height playhead line extending into the editor
- Animated pill pulse
- New replay transport controls (play/pause/rewind buttons)
- Any architecture change to the Yjs CRDT + full-text snapshot model
- Any new dependency

---

## Visual acceptance criteria

1. In past mode, the "Viewing the past" pill and "Return to now" control are visible without any vertical eye travel to the top of the screen — they are adjacent to (or within) the timeline zone.
2. The current position on the timeline is legible in a static screenshot — a visible handle shape is present, not just marker dots.
3. The timeline rail reads as its own bounded zone with a distinct background value, not as a footer decoration.
4. The past-mode pill background is cool-tinted (`rgba(90,143,181,0.15)` or equivalent), not warm-neutral.
5. The past pill uses only cool-spectrum colors — no amber, no warm-muted values.
6. The Live connection state is legible in a screenshot at 50% scale without reading the text.
7. The warm-to-cool temperature shift (live → past) remains unmistakable. If the background transition becomes less visible after any pill changes, that is a regression.
8. No controls are present in the demo that do not work.
9. The editor dominates screen height. The timeline strip is permanently visible. Neither is cropped by any UI addition.
10. `data-testid="return-to-now"` remains on the Return to now button after any layout change.

---

## Screenshot / video acceptance criteria

These criteria define "portfolio-ready" for the demo recording.

1. **Full viewport visible.** Editor ~85% of height, timeline strip ~12%, header ~3%. Timeline never cropped.
2. **5 or more amber marker dots visible on the rail** before any screenshot. An empty timeline reads as an unfinished prototype.
3. **Scrub handle visible at a mid-rail position.** The handle should not be at the extreme left or right end — position it at the 40–60% mark.
4. **Past pill shows a meaningful elapsed time.** Not "just now", not "0s ago", not a round number. Staged to land at a natural elapsed value ("Viewing the past · 4m 17s ago").
5. **Both the pill and Return to now are fully visible** in any screenshot taken in past mode. Neither is cropped.
6. **GIF / video is browser-viewport only.** No OS chrome, no dock, no menu bar, no desktop background.
7. **Six-beat GIF structure:** (1) live active — both tabs visible, Live chip legible, 5+ markers on rail; (2) scrub backward across 3–4 markers; (3) editor cools + pill appears; (4) hold ~1s on past state; (5) click Return to now; (6) editor warms, Live chip re-glows. Target loop: 10–12 seconds.
8. **Secondary crop:** a standalone 3:2 crop of the timeline strip alone — markers, scrub handle at current position, bounded rail — suitable for portfolio case-study body sections.

---

## Questions for Claude Design

1. Should the past-mode status move into a bottom bar adjacent to the timeline?
2. Is 36–40px too heavy for the bar? What height feels right?
3. Should Return to now be right-aligned in the bar or positioned closer to the pill?
4. Should the scrub handle be white, near-white, or amber? What reads as "position" vs "snapshot"?
5. Should the Live chip change to a solid-filled state badge, or stay as a lightweight indicator?
6. What is the minimum change set before recording?
7. What specific choices would make this feel overdesigned or like a video player?

---

## Draft implementation boundary

Maximum 3–4 small, localized JSX/CSS changes. No architecture changes. No new dependencies. No product behavior changes.

**Allowed changes (in implementation order, per design audit):**

1. `src/components/TimelineScrubber.tsx` — add a 12px white filled circle at the selected marker's position (or at the rightmost position when live). Pure JSX/CSS addition inside the rail element.
2. `src/styles/tokens.css` or `src/components/TimelineScrubber.tsx` — verify or strengthen `--timeline-bg` visual contrast on the rail band. CSS-only.
3. `src/pages/RoomPage.tsx` — change past pill background from `bg-[var(--panel)]` to `bg-[rgba(90,143,181,0.15)]` and update elapsed text color from `text-[var(--muted)]` to `text-[var(--past)]` or `text-[var(--text)]`. Inline style or Tailwind utility change only.
4. `src/pages/RoomPage.tsx` or `src/components/AppShell.tsx` — optionally relocate the past pill + Return to now into a compact bar between editor and timeline (candidate 1). Only if the implementation stays under ~30 lines of JSX/CSS and does not shift the timeline vertical position or break `data-testid="return-to-now"`.
5. `src/components/ConnectionStatus.tsx` — optionally replace dot+text with solid-filled pill for Live state. Only implement if it does not create visual competition with the past pill.

**Not allowed in this session:** new root layout grid rows, new component files unless trivially small, any new `import` statement for a new package, any change to snapshot capture logic, Yjs sync, room routing, or test files unless a selector changes.

After any layout change: run `npx vitest run && npx playwright test` and `git diff --check` before reporting done.
