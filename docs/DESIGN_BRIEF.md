# Design Brief — Galley (working name)

**Status:** canonical final design direction for the reconstruction.
**Scope authority:** `docs/PRODUCT_BRIEF.md` remains the canonical product definition. This brief defines *how the product looks, speaks, and behaves visually* — it does not add, remove, or alter product scope.
**Supersedes:** the Amber visual system (`prototype-v1`, historical) and all interim Figma Make exploration passes.
**Evidence base (complete):** the design-research program (`docs/DESIGN_RESEARCH_PLAN.md`), the competitor audit (`docs/research/COMPETITOR_AUDIT.md`), the combined Pinterest-board synthesis, the targeted evidence pass (light-code legibility, collaboration, history, truthful state, jump/follow), the Mobbin recalibration pass, and the final Figma Make direction — including the completed six lifecycle-state validation, the Paper / Ink / Graphite theme comparison, the resolved Paper shared-state screen, and the resolved Paper past-preview screen. The research and Figma exploration phases are closed; this brief consolidates their resolved output and does not reopen them.
**Last updated:** 2026-07-11.

---

## 1. Product and brand framing

- **Working name: Galley.** A galley is the typeset proof sheet handed to one trusted reader before publication — the product's lifecycle as a noun: composed locally, deliberately shared, never claimed as the published permanent artifact.
- **Positioning (one sentence):** *Paste code into a local draft, share one link, and think it through together — with live cursors, honest sync state, and quiet Recent versions when recovery is needed.*
- **Name ↔ lifecycle:** local draft = the galley being set · Share = handing the proof to one trusted reader · edit link = possession of the proof · Recent versions = earlier pulls of the same proof · export = taking the text back to the real print run (the user's own environment).
- **Legal status:** the name is **provisional**. Trademark screening, domain, npm/GitHub, and crowding verification are **not complete**. No repository rename, wordmark lock, or public use until clearance passes. All UI copy in this brief uses product-neutral wording ("this sheet") except where the name is explicitly illustrative.

## 2. Visual thesis

A **live collaborative code document**: the shared clarity of Google Docs, the operational credibility of a focused code editor, and restrained character drawn from classic software economy and old-web directness.

- It is **not a writing app**: real code anatomy (gutter, line numbers, Ln/Col, language control, find) is always present.
- It is **not an IDE**: no tabs, panels, file tree, terminal, run affordances, or density norms.
- It is **not a timeline product**: history is a quiet, bounded, secondary surface entered deliberately; no scrubbers, strips, or playback metaphors anywhere.
- Internal shorthand (never public copy): **"Google Docs for one code file, printed well."**

Balance target: **40% collaborative document · 35% code editor · 25% distinctive character.**

## 3. Theme system

Three themes, one grammar. Every theme uses identical layout, spacing, type scale, state wording, and severity ladder; themes vary only in surface tokens and syntax palette. A component that needs redesign per theme is a defect.

| Theme | Role | Ground | Character |
|---|---|---|---|
| **Paper** | Default. The portfolio identity and marketing face. | Warm white sheet (`--surface-sheet` ≈ warm white, never yellow-aged) on a slightly deeper, cooler canvas | Ink-first typography, hairline rules, printed-proof register |
| **Ink** | Dark alternative for dark-mode users. | Near-black warm ink ground, paper-toned text | Same restraint; explicitly *not* terminal styling — no green-on-black, no neon syntax |
| **Graphite** | Technical neutral for embedding/screenshots where warmth is wrong. | Neutral gray canvas, near-white sheet | The most reserved variant |

- **Shared tokens:** one token set (`--surface-canvas`, `--surface-sheet`, `--ink`, `--ink-muted`, `--rule`, `--accent-you`, `--accent-them`, `--state-caution`, `--state-danger`, syntax roles) with per-theme values. Collaborator hues and state colors keep the same *meaning* across themes and are re-tuned per theme for contrast.
- **First implementation pass: Paper only.** Ink and Graphite are token exercises deferred until Paper ships and the token grammar is proven. No theme switcher UI in v1 unless it costs nothing.

## 4. Layout and hierarchy

Top to bottom:

1. **Document bar** (Row 1) — identity and truth: editable title, welded state phrase, presence chip, Share (primary), overflow.
2. **Operations strip** (Row 2) — the working tier: hairline-bordered, mono-set, compact. Language control · Find (with visible `⌘F`) · Versions · right-aligned live `Ln, Col`.
3. **Editor surface** — the sheet: a single bounded object carrying the code. The visual center of gravity; nothing in the chrome may exceed its optical weight.
4. **Gutter** — line numbers inside the sheet, separated from code by a hairline rule; also the home of the collaborator position tick.

**Sheet on canvas.** The sheet sits on a quiet canvas with real (but not wasteful) margins: 1px hairline border, at most one tight low shadow, matte. The canvas exists to make the sheet an *object* — hand-off-able, and structurally swappable in past-preview. No elevation theatrics; no material animation on state change.

**Responsive principles:** the sheet wins all space disputes. Below ~960px the canvas margins collapse first, then Row 1 wraps to two lines (title+state / people+Share), then Row 2 hides `Ln, Col` last-first. Nothing ever overlays code except summoned panels (Find, Versions, Share popover). Mobile is view-priority polish (post-v1 per product brief) — the layout must merely not break.

## 5. Typography

- **Strategy: one workhorse mono, nearly for everything.** Code, operations strip, metadata, state phrases, version rows, and microcopy share one mono family. A single restrained companion (humanist sans or the mono's own display weights) is permitted **only** for the document title and long-form dialog copy, and only if the all-mono title fails in build review.
- **Title role:** the largest text after code; editable in place; honest default "Untitled sheet". Reads as a filename with dignity, not a hero heading.
- **UI text role:** words over icons wherever a word fits. Controls are set in the mono at small size, sentence case, no all-caps labels except tiny field captions.
- **Code/metadata role:** editor at true code metrics — line-height ≈ 1.45, no prose measure, no soft wrap by default. Metadata one step smaller than body, differentiated by position and rules, not color.
- **Hierarchy rules:** hierarchy is carried by size, weight, and hairline rules — never by decorative color, backgrounds, or shadow. The grayscale test governs: the interface must remain fully legible with all hue removed.
- **Font selection criteria (faces not locked):** excellent code legibility at 13–15px; true italic; ≥4 usable weights; distinguishable `0O/1lI`; tabular figures; open license or budget-realistic; characterful without display-pixel styling. Candidates are auditioned in build, not chosen here.
- **Prohibited:** display-pixel and decorative monos at code sizes; more than two families; faux terminal typography; letterspaced-caps ornamental labels; any face chosen for nostalgia over legibility.

## 6. Color

- **Neutral surfaces:** warm-white sheet, deeper cooler canvas, near-black ink (not `#000`), two grays (muted text, rules/disabled). Everything else must argue its way in. Reference values are set in the Figma direction and remain **tunable in build**; meanings are locked, hexes are not.
- **Syntax strategy: ink-first.** Identifiers and most tokens stay near-ink; 3–4 muted hues at moderated saturation for keywords, strings, comments, types (register between the observed `xcode` and `atom-one-light` themes). Squint test: a screenshot reads as a black-text document with inflections, never a rainbow. Comments in gray italic. No token background fills except selection and find matches.
- **Collaborator hues:** exactly two in play — `--accent-you` and `--accent-them`, drawn from a small contrast-verified set. Scope-limited to: caret, selection tint (low alpha), name chip dot, gutter tick, arrival edge. **Never** applied to text as authorship, never persisted into history.
- **State severity colors:** healthy states carry **no color** (ink/gray text only). Caution (reconnecting / unsynced) = one amber. Danger (failed) = one red. Color always doubles a written phrase; never appears alone.
- **Past-preview treatment:** **no color-temperature shift** (the retired Amber move is prohibited). Pastness is structural and verbal — banner, frame change, removed editing affordances. The code palette in preview is identical to live.
- **Accessibility constraints:** all text ≥ 4.5:1 against its surface (syntax tokens included); collaborator hues ≥ 3:1 against the sheet for non-text marks and always paired with a name in text; state colors meaningless alone by design.

## 7. Header grammar (document bar)

Slots, left to right: Title · state phrase · ● name — here ──────── Share ▸ · ⋯ (slot names below; the brackets are not part of the rendered control chrome — see §13).

- **Title:** editable in place; `Untitled sheet` default; single line, truncates with full value on focus.
- **Filename:** derived (`title` slug + language extension, e.g. `retry-logic.ts`) and shown as quiet metadata beside the title or in the Download affordance — never a second editable field.
- **Lifecycle state:** the truth phrase is welded to the title — a first-class header element, not a caption (see §10 for the full grammar). It is the header's signature.
- **Collaborator control:** `● kaya — here` chip (hue dot + editable-by-owner name + activity word). Always visible while a collaborator is present; click = jump; keyboard-reachable as a list. No avatars.
- **Share / Copy link:** while local, **Share** is the only filled, emphasized control on screen. After success it transforms in place into the standing state (`● Shared · saved`) plus a Copy link text action. The popover carries the URL field, inline `Copied!`, and the access truth (§11).
- **Versions:** one word in the operations strip (§8); never promoted to Row 1.
- **Overflow rules (⋯):** Download, and nothing else in v1. Any candidate control must first fail the manuscript test ("would this survive on a serious paper document?") to justify hiding here; anything failing it entirely is cut, not hidden.

## 8. Editor grammar

- **Line numbers:** always on; muted; right-aligned in the gutter; hairline rule between gutter and code.
- **Active line:** current line number darkened; optional whisper-tint active-line background (must survive the squint test); never a heavy highlight bar.
- **Caret:** the local caret in `--accent-you`; designed deliberately (see §14 — specimen-level care).
- **Selection:** low-alpha tint with hairline edge in the owner's hue; character-cell snapping.
- **Gutter marker:** the collaborator tick — a small mark in `--accent-them` at the line holding their caret (§9).
- **Code density:** real editor metrics (≈1.45 line-height, true tabs, no default soft wrap, comfortable at 80–100 columns).
- **Find:** keyboard-summoned compact panel (`⌘F` shown in the strip), match count stated in words ("2 of 14"), matches highlighted, `Esc` dismisses, focus returns to the editor.
- **Line/column:** live `Ln 12, Col 8` readout, right end of the operations strip.
- **Language control:** `TypeScript ▾` as a visible text chip in the strip; drives syntax + export extension. One sheet, one language (product-locked).
- **Prohibited IDE chrome:** tabs · file tree · breadcrumbs · terminal/console · run/debug anything · minimap · status-bar soup · gutter iconography beyond line numbers and the presence tick · autocomplete/lint affordances (excluded features must not even be *implied*).

## 9. Presence grammar

Designed for **exactly two people** who are already talking elsewhere. Presence is ambient after the first seconds; nothing presence-related pulses at rest.

- **Header presence:** the named chip (`● kaya — here` / `— editing`) is permanent Row-1 furniture while a collaborator is connected. Join/leave are one-line header-adjacent notices ("kaya joined"), not toasts.
- **Remote caret label:** their caret in `--accent-them` with a small name flag on join and on activity; the flag decays to caret-only at rest and returns on movement. **Decay timing is implementation-dependent** (prototype decides; reduced-motion shows/hides without animation).
- **Selection:** low-alpha tint of their hue, hairline edge.
- **Gutter marker:** their tick sits at the line containing their caret even when their caret is horizontally off-view; it moves when they move; it never persists as history.
- **Jump-to-collaborator:** click the chip or the tick; keyboard path: collaborator list → `Enter`. Fully pointer-free operable (product accessibility requirement).
- **Arrival cue:** brief viewport-edge tint in their hue plus momentary emphasis of their caret/selection. Reduced-motion: static edge tint, no animation. The cue orients; it never scrolls-jacks afterward.
- **Back behavior:** on jump, a Back to your place text action appears in the header/status area, persistent until used or superseded by a new jump, keyboard-accessible, restores caret and scroll to a meaningful prior location.
- **Rejected:** avatar piles · cursor swarms · cursor chat · activity feeds · per-author text tinting (Etherpad's confirmed failure) · persistent follow mode (post-v1) · Point (prototype question, not v1).

## 10. Truthful state grammar

One location (welded to the title), one register (plain sentences), one ladder (ambient gray text → colored text → one-line banner). Color never alone; every change announced via live region. **Exact strings below are the approved register; strings marked ⚠ depend on sync architecture and must not be hard-finalized until the persistence model is approved.**

| State | Phrase | Presentation |
|---|---|---|
| Local draft | `Local draft — not uploaded` | Gray text. No cloud iconography. The absence of remote claims *is* the design. |
| Sharing | `Sharing…` | Share button becomes its own progress statement, in place. |
| Shared (just now) | `Shared · link copied` → settles to `Shared · saved` | Inline beside Share; no toast. |
| Saved / synced | `Shared · saved just now` ⚠ (wording of recency depends on sync granularity) | Gray text. Zero color. |
| Saving / syncing | `Saving…` ⚠ (whether a distinct visible state exists depends on architecture) | Text swap only; no spinner theater. |
| Reconnecting | `Reconnecting — recent edits not yet saved` ⚠ (the claim about which edits are at risk must match real buffering behavior) | Amber phrase; escalates to a one-line banner under the header if prolonged. |
| Failed / unsynced | `Not saved — connection failed. Your text is still on this page.` | Red phrase + persistent one-line banner; navigation-away warning per product brief. States what is true and what is at risk; never reassures falsely. |
| Viewing the past | `Viewing version from 14:32 — read-only` + `kaya is still editing live` | Full-width one-line banner replaces the phrase; content palette unshifted; see §12. |
| Returning to current | phrase resumes; brief emphasis on the state line | Banner departs; caret restored; screen-reader announcement. |

**Escalation rule (locked):** healthy states may only ever be gray text; a state may add color only when the user could lose something; a state may become a banner only when the user must act or must not be able to misunderstand.

## 11. Share lifecycle

- **Local before Share:** opening the product creates no remote object and uploads nothing. The draft state says so in words.
- **Share creates the remote sheet** and copies the edit link — one gesture. Failure leaves the draft intact on the page and says so.
- **Copy-link confirmation:** inline `Copied!` adjacent to the URL field (quiet, no toast, no modal celebration).
- **Access truth (locked copy pair):** `Anyone with this link can read and change this sheet.` + `Nothing was uploaded before you shared.` Optionally a retention sentence per the disclosed service policy — wording ⚠ until the retention policy is finalized.
- **Post-share state:** Share transforms into the standing truth (`● Shared · saved`) plus a Copy link text action. The same control never claims to "manage" access — there is no revocation to manage.
- **Never claimed:** privacy, security, ownership, revocation, verified identity, permanence. The share surface may not use the words "private", "secure", or "only".

## 12. Recent versions

- **Entry point:** the single word `Versions` in the operations strip. Closed cost: one word. No icon strip, no timeline chrome, ever.
- **Empty state:** opens to `No versions yet.` (designed, not blank).
- **List:** temporary right-side drawer; *boring on purpose*: `Current version` pinned at top, then chronological timestamp rows (`Today 14:32`), coalesced into natural groups. **No author names, no diffs, no byte counts, no named checkpoints.** Footer states the bound in words: `Older versions are not kept.` (cadence/bound/coalescing values remain product-open; the design must never imply more retention than exists).
- **Read-only preview:** selecting a version swaps in a visibly re-framed proof sheet under the past banner — editing affordances removed, no caret, distinct frame treatment, identical code palette. Three redundant read-only signals: banner sentence, removed affordances, frame.
- **Collaborator remains live:** the header chip stays live during preview (`kaya is still editing live`) — the locked non-disruption invariant made visible.
- **Copy prior text:** selection is allowed in preview; `Copy this version` (full text) in the banner area + selection-copy; confirmation inline `Copied.`
- **Back to current:** the banner *is* the exit — a Back to current control inside it; keyboard-reachable; focus restored to the live sheet.
- **Absent by design:** restore in any form · permanent timeline · scrubbers/playback · diff views · attribution · anything that pauses, locks, or notifies the live collaborator beyond the ambient truth above.

## 13. Control grammar

- **Primary action:** one per screen maximum (Share while local; Back to current while previewing). Filled, ink-on-accent or accent-on-ink, rectangular with minimal radius.
- **Secondary action:** hairline-bordered text button, transparent fill.
- **Text action:** compact text controls for tertiary moves — Copy link, Back to your place, Back to current — set in the mono, no border or with a hairline underline on hover, used only at the tertiary tier. No bracket or ASCII styling; the control reads as plain, honest text with clear hover and focus treatment.
- **Borders:** hairline (1px) rules structure header, strip, gutter, drawer, and dialogs. Structure over shadow everywhere except the sheet's single tight shadow.
- **Radius:** small and consistent (≈2–3px); nothing pill-shaped; nothing fully round except the presence dot.
- **Hover/focus:** hover = subtle ink-tint shift, never elevation; focus = visible 2px offset ring in `--accent-you`, never suppressed.
- **Avoid:** Material ripples and floating action buttons · generic SaaS pill buttons and gradient fills · icon-only controls where a word fits · toasts as a primary state channel.

## 14. Character rules

1. **Instrument-like controls:** the operations strip and metadata are compact, dense, hairline-bordered, mono-set — a typesetter's tools, not a toolbar.
2. **Hairline structure:** visible 1px organization is the product's ornament. If a surface feels bland, add typographic tension or a rule — never decoration.
3. **Candid microcopy:** the voice is plain, factual, slightly warm: "Nothing was uploaded before you shared." · "Older versions are not kept." · "Your text is still on this page." Microcopy is a personality budget line item, not filler.
4. **Specimen-level cursor care:** the two carets, the name flag, and the gutter tick are the product's signature glyphs — designed, reviewed, and presented (in the portfolio) as a specimen set.
5. **Classic-software principles, no imitation:** one document = one surface; title as identity; tools subordinate; save/share as deliberate acts; states in words. Zero rendered lineage — no bevels, pinstripes, platinum, or window chrome quotes.
6. **Old-web directness, no ASCII styling:** bluntly honest sentences and text-that-is-a-control; never ASCII art, box-drawing decoration, terminal green, or cosplay type.

**Forbidden treatments (binding refuse-list):** pixel fonts · bevels · dither · CRT/scanlines · paper texture · skeuomorphic ribbons · glassmorphism · gradient branding · dark-terminal identity · typewriter distress.

## 15. Accessibility

- **Contrast:** §6 minimums hold in every theme, syntax tokens included; the grayscale test is a release gate.
- **Keyboard reachability:** every control operable without a pointer — including jump, Back, Versions open/navigate/copy/exit, Share, Find, and the collaborator list. Tab order follows the visual hierarchy (document bar → strip → editor).
- **Focus states:** always visible; overlays (Find, Versions, Share popover) trap focus appropriately and restore it on close.
- **Live regions:** every state-phrase change, join/leave notice, copy confirmation, and past-mode entry/exit is announced; announcements use the same words the header shows.
- **Color never alone:** identity = dot + name; states = color + sentence; syntax survives grayscale.
- **Reduced motion:** every animated cue (arrival edge, label decay, banner transitions) has a static equivalent specified at design time, not retrofitted.
- **Readable code themes:** the syntax palette is contrast-checked per theme; historical preview is unmistakably read-only through structure and words, not color shift.

## 16. Portfolio implications

The direction must make these frames legible cold, in 30 seconds each:

1. **Empty local draft** — proves localness: warm sheet, `Untitled sheet`, `Local draft — not uploaded`, code-native placeholder, Share present but unfired.
2. **Shared live room, two cursors** — two hues, two carets, one selection, named chip, `Shared · saved`: a document two people are in, not a tool with users.
3. **Share confirmation** — the header mid-transformation (`Shared · link copied`); must work as a cropped header strip alone.
4. **Jump-to-collaborator** — arrival edge in their hue + emphasized remote selection + visible Back to your place control, readable as a moment in one still.
5. **Past preview ↔ return to current** — paired frames proving the locked invariant: banner + re-framed read-only proof + `kaya is still editing live`, then the live header restored.

Every marketing-grade screenshot includes at least one live element (presence, state phrase, or arrival cue) so the surface is never mistaken for a static pastebin — and the 30-second success criteria of the product brief govern all of them.

## 17. Locked decisions

1. Direction: **Typeset Sheet surface + Honest Utility state grammar**, with Studio Desk contributing only sheet-on-canvas objecthood and the collaborator-hue arrival edge.
2. Light-first identity; **Paper is the default theme and the portfolio face**; dark exists only as the non-terminal Ink variant.
3. Sheet-on-canvas object stance (hairline border, one tight shadow, matte).
4. Two-row working header: document bar + mono operations strip, with the anatomy of §7–§8.
5. State phrase welded to the title; the escalation ladder of §10; every state doubled in text.
6. Ink-first syntax strategy and the squint/grayscale tests as gates.
7. Presence = named chip + remote caret/selection + gutter tick; exactly-two hue scoping; no avatars, no attribution.
8. Jump/Back and arrival grammar of §9 (mechanics prototyped, grammar locked).
9. Versions = one word in the strip; drawer + boring bounded list + read-only re-framed preview + copy-not-restore + banner-as-exit.
10. Share grammar of §11, including the two-sentence access truth and the prohibited-claims list.
11. Control grammar (§13) and character rules incl. the binding refuse-list (§14).
12. One-mono-nearly-everything typography strategy; title-companion permitted only on build-review failure.
13. Accessibility gates of §15.

## 18. Open implementation-dependent decisions (narrow)

1. Final typeface(s) and licenses (criteria locked; faces auditioned in build).
2. Final palette hex values and the full syntax token table (meanings locked; values tuned against contrast gates).
3. Save/sync phrase details marked ⚠ in §10 (depend on the approved persistence/sync architecture).
4. Remote-label decay timing, arrival-cue duration, and reduced-motion equivalents (disposable prototype decides).
5. Version cadence, bound, and coalescing values (product-brief open details; design renders whatever is chosen truthfully).
6. Retention sentence wording in the Share surface (depends on the disclosed retention policy).
7. Ink and Graphite token values (deferred until after the Paper pass).

## 19. Non-goals

No authentication or accounts · no database/persistence work as a design requirement (architecture remains a separate, unapproved track) · no AI features · no chat or comments · no file tree or multiple files · no code execution, terminal, or deployment · no multi-room or workspace chrome · no branching or version-control semantics · no restore from versions · no permanent timeline or scrubber in any form · **no Point in v1** (prototype question only, per `docs/experiments/POINT_EXPERIMENT.md`) · no presenter/classroom modes · no mobile-first work beyond not-breaking.

---

*This brief is documentation only. It proposes no architecture, changes no product scope, renames nothing, and ships no code. Implementation passes (tokens, components, screens) and the Codex review consume this document as their acceptance reference.*
