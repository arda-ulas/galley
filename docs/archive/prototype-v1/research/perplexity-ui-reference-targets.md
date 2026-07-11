# Echo/Rewind — UI Reference Target List

> **Status: historical prototype-v1 document.**
>
> This file records design/product research for `prototype-v1` (`4147372`). It is preserved as historical evidence and is not active reconstruction guidance. See `docs/PRODUCT_BRIEF.md` for the canonical product definition.

> Raw research capture. Not all recommendations are approved for implementation.

Source: Perplexity research, saved 2026-07-01.

Everything below is scoped to visual reference and portfolio packaging only. No product features, no excluded systems.

## Master Reference Table

| Category | Product / Reference | Exact screen or flow to inspect | Search terms (Mobbin / screenshot tools) | Borrow visually | Avoid copying | Best use |
|---|---|---|---|---|---|---|
| 1. Timeline/scrubber controls | **CapCut** | Main edit view — bottom scrubber with playhead, zoomable track ruler, snap points | "CapCut editor timeline", "video timeline scrubber" | Playhead precision, tick-mark ruler density, drag-to-scrub friction, snap feedback | Clip-stacking multi-track clutter, colored clip blocks | App UI, GIF |
| 1. Timeline/scrubber controls | **Video player chapter markers** (YouTube / Mux Player) | Hover-scrub with thumbnail preview + chapter segment dividers | "video player chapter markers", "scrubber hover preview" | Segment dividers as discrete "snapshot" markers, hover preview affordance | Ad markers, engagement heatmap overlay | App UI, GIF |
| 2. Session replay / event playback | **Sentry Replay** | Replay detail view — bottom playback bar with event/error markers on the timeline | "Sentry session replay", "replay timeline errors" | Event dots pinned to a slim timeline, muted dark chrome, calm density | Console/network waterfall panels, breadcrumb spam | App UI, screenshots |
| 2. Session replay / event playback | **PostHog recordings** | Recording player — timeline with activity segments + speed controls | "PostHog session replay", "recording player timeline" | Activity-density shading along the bar, minimal transport controls | Left event list, filters sidebar | App UI, screenshots |
| 2. Session replay / event playback | **OpenReplay** | Player view — scrub bar with event pins, clean playback header | "OpenReplay player", "open source session replay" | Open, uncluttered player frame; restrained marker styling | Dev tools tabs, multi-pane inspector | Screenshots |
| 2. Session replay / event playback | **Microsoft Clarity** | Recording playback — simple bottom transport, low-chrome | "Microsoft Clarity recording", "clarity session playback" | How little chrome is needed; quiet neutral palette | Heatmap toggles, dashboard framing | Screenshots |
| 3. Media editing timelines | **Descript** | Editor — timeline synced to transcript, scene markers | "Descript editor timeline", "Descript editing" | Timeline-as-primary-navigation concept; premium calm dark theme | Transcript panel, word-level editing | App UI, case-study |
| 3. Media editing timelines | **DaVinci Resolve** | Edit page timeline — precise ruler, playhead, zoom controls | "DaVinci Resolve timeline", "Resolve edit page" | Pro-grade precision language, dark neutral surfaces, ruler typography | Multi-track density, node/scopes complexity | Screenshots |
| 3. Media editing timelines | **Final Cut Pro** | Magnetic timeline + skimming preview | "Final Cut Pro timeline", "magnetic timeline" | Skim-to-preview interaction, smooth playhead motion | Magnetic clip layout, inspector panels | GIF |
| 3. Media editing timelines | **Runway** | Editor timeline / frame scrubber | "Runway ML editor", "Runway timeline" | Modern minimal dark editor chrome, generous spacing | Generative panels, model UI | Screenshots, case-study |
| 4. Developer tools — premium dark | **Linear** | Any core view — issue detail, command menu | "Linear app dark", "Linear UI" | Restraint, typographic hierarchy, subtle borders, warm-neutral dark | Sidebar nav, issue lists | App UI, case-study |
| 4. Developer tools — premium dark | **Raycast** | Command palette + detail panels | "Raycast UI", "Raycast command palette" | Focused single-surface calm, keyboard-first minimalism | Extension grid, launcher metaphor | App UI |
| 4. Developer tools — premium dark | **Vercel** | Dashboard / deployment detail (dark) | "Vercel dashboard dark", "Vercel UI" | Monochrome discipline, precise spacing, premium restraint | Charts, deployment lists | Screenshots, case-study |
| 4. Developer tools — premium dark | **Warp** | Terminal blocks + command input | "Warp terminal", "Warp app UI" | Warm dark surface, block segmentation, editor-owns-screen feel | Block actions, AI panel | App UI |
| 4. Developer tools — premium dark | **GitHub Codespaces** | In-browser editor chrome (VS Code dark) | "GitHub Codespaces", "VS Code dark editor" | Editor-primary layout, unobtrusive chrome around code | File tree, tabs, panels (excluded) | Screenshots |
| 5. Version / state-history | **Figma version history** | Version history panel — chronological entries, restore preview | "Figma version history", "version history panel" | Time-anchored entries, "return to current" affordance, snapshot list metaphor | Right-panel list format, naming/edit UI | App UI, case-study |
| 5. Version / state-history | **GitHub file history / blame** | Commit history + blame timeline for a file | "GitHub file history", "GitHub blame view" | State-over-time framing, per-change markers | Diff gutters, commit metadata density | Screenshots |
| 5. Version / state-history | **Notion page history** | Page history modal — timeline of versions, read-only preview | "Notion page history", "Notion version history" | Read-only past preview + explicit exit-back-to-now pattern | Modal framing, restore buttons | App UI |
| 5. Version / state-history | **Google Docs version history** | Named-versions sidebar + read-only historical view | "Google Docs version history", "doc version timeline" | Vertical time list, dimmed read-only past state | Sidebar list layout, edit tracking colors | Screenshots |
| 6. Mode change: live ↔ past/readonly | **Notion page history (read-only state)** | The moment a past version loads read-only vs. live editing | "Notion read only version", "version preview mode" | Visual signaling that "you are in the past" — dimming, banner, cooler tone | Restore CTA, modal chrome | GIF, case-study |
| 6. Mode change: live ↔ past/readonly | **Figma "view version" → "back to current"** | Transition into a version and returning to live | "Figma view version", "restore version" | The round-trip: enter past → clear return path; mode-distinct chrome | Version naming flow | GIF |
| 6. Mode change: live ↔ past/readonly | **Loom viewer vs. recorder** | Playback (past/replay) vs. active record states | "Loom video player", "Loom playback UI" | Distinct visual register between "live" and "reviewing" | Comments, reactions, CTAs | GIF |
| 6. Mode change: live ↔ past/readonly | **Screen Studio** | Editing/preview vs. playback states, clean transport | "Screen Studio editor", "Screen Studio timeline" | Premium calm mode distinction; cooler review palette | Zoom/cursor effects, export UI | GIF, case-study |
| 7. Portfolio case studies (GIF/video) | **Mobbin "Flows"** (any dev/editor app) | Multi-frame flow sequences showing state transitions | "Mobbin flows", "app flow screenshots" | How to sequence frames to tell a state-change story | — | Case-study |
| 7. Portfolio case studies (GIF/video) | **Screen Studio landing / examples** | Hero GIFs showing product-in-motion loops | "Screen Studio examples", "product demo gif" | Loop length, smooth cursor, framing of a single interaction | Over-produced zoom effects | GIF, case-study |
| 7. Portfolio case studies (GIF/video) | **Linear / Vercel changelog & landing** | How they present a single feature with one tight GIF | "Linear changelog", "Vercel product page" | One idea per GIF, captioned, dark-framed | Marketing copy density | Case-study |

## Top 10 Mobbin Search Queries

1. video timeline scrubber
2. session replay player
3. version history panel
4. Descript editor timeline
5. Linear app dark
6. Notion page history
7. Figma version history
8. video player chapter markers
9. developer tool dark UI
10. read only preview mode

## Top 10 Non-Mobbin Web / Image Search Queries

1. `Sentry session replay timeline screenshot`
2. `PostHog session recording player UI`
3. `DaVinci Resolve timeline ruler dark`
4. `CapCut editor timeline playhead`
5. `Google Docs version history read only`
6. `Warp terminal warm dark UI`
7. `Screen Studio timeline editor screenshot`
8. `Figma view version back to current`
9. `GitHub file blame history UI`
10. `product demo gif portfolio case study dark`

## Reference Priorities — What to Inspect First

1. **Figma version history + Notion page history** — closest analogues to the core "click into a read-only past, then return to now" loop. Study the mode signaling and the return-to-live path first; this is the identity of Echo/Rewind.
2. **Sentry Replay + PostHog recordings** — the cleanest models for event markers pinned to a slim, calm timeline.
3. **CapCut + video player chapter markers** — for the scrubber mechanics: playhead precision, snap-to-marker, hover preview.
4. **Linear + Warp + Vercel** — set the premium warm-dark tone and typographic restraint so the editor owns the screen quietly.
5. **Screen Studio + Loom** — for how the "past/replay" register should feel cooler and quieter, and for packaging the whole thing as a tight, looping portfolio GIF.
