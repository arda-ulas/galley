# Design-Research Plan — The Shared Code Sheet

> **Status: active design-research plan.**
>
> This document governs the reconstruction reference-collection and synthesis phase. It does not define the final visual direction. `docs/PRODUCT_BRIEF.md` remains the canonical product source.

---

## Research thesis

The product's identity problem is not "what should a code editor look like" — it is "what should a *document* look like when two people briefly inhabit it."

Many focused code-sharing products appear to answer the editor/tool question more strongly than the shared-document question — often with dark chrome, panel grids, and editor-as-application framing. The competitor audit must verify whether that pattern actually holds. The brief, by contrast, answers the shared-document question. The artifact is a sheet — created locally, shared deliberately, edited jointly, exported with dignity. That lifecycle is the identity. The research program therefore studies **document software, not developer tools**, as its primary lineage — and studies developer tools mainly to learn what to respect (code legibility conventions) and what to refuse (IDE chrome, dashboard density, dark-mode-as-personality). The lineage argument stands on its own merits; it does not depend on any unverified claim about how competitors look.

### Three tensions the research must resolve with evidence, not taste

1. **Document vs. tool.** How much "software chrome" can be removed before the product stops feeling capable? Where is the line between a serious document and a toy pastebin?
2. **Calm vs. truthful.** The brief demands truthful state (six distinguishable connection/save states) *and* calm under live collaboration. Truthfulness tends toward alarm; calm tends toward concealment. The research must find state grammars that are honest at a glance without shouting.
3. **Character vs. costume.** Classic references are allowed as *lineage* (principles, hierarchy, attitude), never as *skin* (pixel fonts, fake bevels, CRT effects). Every reference captured must be annotated with the principle extracted, or it is decoration.

The program ends with a synthesis that narrows three hypotheses to one direction — it does not end with a moodboard.

---

## Research questions

Grouped by the decision each answers.

### Lifecycle & object identity

- **RQ1.** What visual grammar makes a document read as *local and unsent*? (Candidates: matte/unlit surface, "Draft" wordmark, absent share affordances, no cloud iconography.) What did classic software do before autosave-to-cloud existed, when local was the default rather than the exception?
- **RQ2.** How do the best tools make create-and-copy-link one legible gesture? Where does Share feel "magical but unclear" (something happened, unclear what) vs. "mechanical and clear" (I made a thing, here is its address)? What confirmation microcopy and duration is right?
- **RQ8.** What makes an empty document inviting rather than dead? (Placeholder text? Cursor behavior? A visible title field? Absolutely nothing?) How do empty states differ between document software (invitational) and dev tools (configurational)?
- **RQ9.** What specific elements make a surface read *document* rather than *IDE*? Hypotheses to test against references: single object on screen, visible title, generous margins, no panels, no gutter iconography, toolbar subordinate to content, absence of tabs.
- **RQ12.** How do link-access products communicate "the link *is* the permission" honestly? What copy and iconography sets correct expectations (anyone with this can edit) without legalese or false security theater?

### State truthfulness

- **RQ3.** What is the minimal visual grammar that keeps six states (local · creating · shared-and-saved · reconnecting · unsynced · failed) distinguishable at a glance, never conflated, and calm in the happy path? Sub-questions: which states deserve ambient treatment vs. interruptive treatment? Where should the state live — title-adjacent (document convention) or status-bar (tool convention)? How do Notes/Docs/Figma/Linear degrade when offline, and which degradation feels trustworthy?

### Presence & attention

- **RQ4.** For exactly two people who are already talking by voice, what presence is *necessary*? What does presence look like below the avatar-pile pattern (designed for 2–50 anonymous viewers)? When does a collaborator's cursor become noise?
- **RQ5.** What is the clearest visual behavior for jump-to-collaborator (viewport travel, highlight on arrival, orientation cues) and for Back (where the affordance lives, how long it persists, how the "meaningful prior location" is communicated)? What have Figma (click avatar to follow), Google Docs (click avatar to jump), and editors with "go to definition → back" already taught users?
- **RQ-Point (evidence question).** What selection-adjacent "point here" precedents exist (Figma comment pings, FaceTime/Freeform gestures, laser pointers in deck tools, Docs' flash-on-jump)? Capture evidence only — Point remains a prototype question, not a research conclusion. See `docs/experiments/POINT_EXPERIMENT.md`.

### Recovery

- **RQ6.** Where do quiet version histories live in the best document tools, and what makes them discoverable-when-needed but invisible-when-not? (Menu item? Title dropdown? Hover reveal? Command?) What entry-point pattern fits a product with deliberately zero permanent history chrome?
- **RQ7.** How do products render "you are looking at the past" unmistakably without a color-temperature theme shift (the retired Amber treatment) — via framing, border, banner, chrome removal, typography, or spatial displacement? Which treatments survive reduced-motion and colorblind conditions?

### Identity

- **RQ10.** Where does personality safely live in a code-bearing product? Candidate zones ranked by risk: microcopy < empty states < chrome/margins < motion < non-code typography < color < code-area typography (highest risk — never at legibility's expense).
- **RQ11.** For each classic reference: what is the transferable *principle* (hierarchy, economy, honesty, single-object focus) vs. the non-transferable *artifact* (bevels, bitmaps, dither, palette)? The research must produce an explicit borrow/refuse table per historical system.

---

## Reference territories

Four territories, each evaluated on the same frame: useful principles, specific patterns, dangerous clichés, what not to borrow, and relevance to lifecycle / collaboration-state / Recent-versions / visual identity.

### A. Classic Mac document software
*MacWrite, TeachText/SimpleText, HyperCard, ClarisWorks, early Finder document windows, classic modal sheets and save indicators.*

- **Useful principles:** One document = one window = one object. Title centered in chrome as identity, not breadcrumb. Content begins immediately; tools are subordinate and hideable. The unsaved-changes marker (close-box dot) is a whole state grammar in one glyph. Modal sheets attached to the document they concern. Interface disappears around content.
- **Specific patterns:** Title-in-chrome treatment; document-window proportions and margins; save/unsaved indication; "Untitled" as honest default; HyperCard's "a stack is a thing you hand to someone" object model.
- **Dangerous clichés:** Pixel fonts, 1-bit dither, bevels, striped title bars, Chicago type, rainbow-Apple nostalgia. Any of these = costume.
- **Do not borrow:** Literal chrome rendering; modality-heavy flows; single-user assumptions in interaction (fine in hierarchy, wrong in behavior).
- **Relevance:** Lifecycle — strongest territory for RQ1/RQ9; this software was local-first by nature and "shared" was a deliberate physical act, exactly the draft→Share model. Collaboration-state — weak (predates it); useful only for the *save* half. Recent-versions — moderate; versions lived in the File menu, invisible until sought, which is the right posture. Identity — high (economy, seriousness, single-object dignity).

### B. Old web collaboration & publishing
*Etherpad, early Google Docs (Writely era), pastebins, wikis, early web forms and document utilities.*

- **Useful principles:** URL = the object; possession of the address is the whole access model, presented without apology. Zero-ceremony creation (Etherpad: page load = pad exists). Content-first pages with almost no chrome. Honest, blunt microcopy. Few, legible primitives.
- **Specific patterns:** Etherpad's per-author highlight (presence as *text ownership* rather than avatars — provocative for a two-person product); pastebin's create→URL→done linearity; wiki "this page is editable by anyone with access" candor; early Docs' "Saving… / All changes saved."
- **Dangerous clichés:** Author-color text-background soup (Etherpad's failure mode); visual poverty misread as style; Times-New-Roman-and-blue-links cosplay.
- **Do not borrow:** Persistent per-author text coloring (violates calm and no-attribution decisions); clutter; the aesthetic as skin.
- **Relevance:** Lifecycle — high for RQ2/RQ12; these products *are* the link-access model, stated honestly. Collaboration-state — moderate; crude but honest presence; the save-copy lineage is core evidence for RQ3. Recent-versions — moderate; wiki page history is complete, boring, hidden behind one link (right posture, wrong density). Identity — high as *attitude*, low as visual system.

### C. Modern macOS collaboration
*Notes, Freeform, Pages, Linear, Notion, Craft, Framer, Figma multiplayer.*

- **Useful principles:** Presence as ambient, calm, peripheral. State communicated near identity (title area) rather than in dashboards. Restraint as premium signal (Linear: personality from typography, spacing, speed — not decoration). Sheet/card as object on canvas (Freeform, Craft).
- **Specific patterns:** Figma named cursors, avatar-click-to-follow, viewport-following (study for RQ5 — though follow-mode itself is post-v1); selection flash on jump (Docs/Figma) for arrival orientation; Notes' collaboration-cursor discretion; Linear's offline/reconnect banner; Craft/Pages version browsing as a temporary full-screen mode with an unmistakable exit.
- **Dangerous clichés:** Notion-clone gray-on-white sameness; avatar piles; presence-as-marketing; glassmorphism; SaaS gradient branding.
- **Do not borrow:** Multi-document chrome (sidebars, workspaces — the product has one sheet); comment threads; account-shaped UI (permission dropdowns we do not have — our Share is simpler and should look simpler).
- **Relevance:** Lifecycle — moderate; most assume account+cloud from the first keystroke, so their *draft* states are thin; their Share sheets show what our simpler Share can strip away. Collaboration-state — highest of all territories; where RQ3/RQ4/RQ5 evidence lives. Recent-versions — high; Pages/Craft version browsing and Notion page history are hidden by default, modal when open, obvious exit. Identity — high for craft standards; dangerous for sameness (borrow the bar, not the look).

### D. Contemporary focused code tools
*Codeshare, ShareCode, GitHub gists/source views, Raycast, Zed, CodePen, diff/source viewers.*

- **Useful principles:** Code legibility conventions users will not renegotiate: monospace, syntax color logic, selection behavior, find UX. Gist as *the* precedent for "code as document, not project" — title + content + metadata, no run button. Zed/Raycast: performance and typographic care as felt quality.
- **Specific patterns:** Gist's document framing of code; diff viewers' read-only clarity (evidence for RQ7 historical-preview framing); Zed's collaboration entry (channel/join model — note how *tool-like* it feels, as contrast); CodePen's editor-as-content-frame.
- **Dangerous clichés:** Dark-by-default as personality; panel grids; status-bar soup; fake terminal aesthetics; "hacker" theming.
- **Do not borrow:** Any chrome implying execution, files, or projects; density norms; the assumption that developers prefer tool-aesthetics for *sharing* contexts (the moment is conversational, not operational).
- **Relevance:** Lifecycle — Codeshare/ShareCode are the direct competitors on the exact loop; their creation/share/join flows are the baseline the audit must characterize. Collaboration-state — *hypothesis to verify:* presence in these tools may be crude, which could be our opportunity; the audit must confirm or disprove this, and record any tool that does presence well. Recent-versions — *hypothesis to verify:* recovery appears mostly absent; treat this as a predicted pattern to confirm or disprove by actively looking for versions, not a settled finding. Identity — *hypothesis to verify:* the category may be visually homogeneous ("generic" tool chrome); the audit must test this and note any counter-examples. The legibility floor these tools set is real and must be respected regardless.

---

## Research boards

Three focused boards. Each lists what it studies, its targets, what to capture, what to annotate, and what it must produce.

### Board 1 — Document as a serious object
*Answers RQ1, RQ2, RQ8, RQ9, RQ12; feeds surface/typography decisions.*

- **Studies:** title treatment (in-chrome vs. in-content, editable-title affordances, "Untitled" handling); minimum viable document chrome; margins and measure for monospace content; editor framing (sheet-on-canvas vs. full-bleed); local-vs-shared visual difference; save/sync wording and placement; single-object hierarchy; toolbars that stay subordinate.
- **Targets:** MacWrite/SimpleText/ClarisWorks captures; HyperCard stack windows; early Google Docs (2006–2010); iA Writer; Bear; Gist; Pages; Craft; typewriter-era paper conventions (title blocks, margins) as a non-software control group.
- **Capture:** full-window screenshots of documents at rest (not feature moments); empty documents; title areas close-up; save indicators in all states; Share dialogs cropped to their essential gesture.
- **Annotate:** what is the *one* object on this screen? where does identity live? what tells me it is mine vs. published? what would I remove?
- **Must produce:** a stance on sheet-on-canvas vs. full-bleed; a title-treatment shortlist (3 max); a save-state copy shortlist; the "document not IDE" checklist (5–7 concrete rules).

### Board 2 — Human presence and attention
*Answers RQ4, RQ5, RQ-Point; feeds presence treatment in all hypotheses.*

- **Studies:** cursor rendering (label persistence, fade behavior, color assignment); remote selection rendering; minimal-avatar and no-avatar presence; collaborator navigation (jump affordance, arrival orientation, Back); off-screen presence indication (edge hints, minimap-free options); join/leave feedback; attention gestures (pings, flashes, pointers); what "calm multiplayer" concretely looks like frame-by-frame.
- **Targets:** Figma (the ceiling); Google Docs (the default); Notes/Freeform (the quiet extreme); Etherpad (the historical extreme); Zed collab; multiplayer whiteboards (Miro/FigJam pings, for Point evidence); watch-together UIs (presence for exactly-two precedents).
- **Capture:** short screen recordings, not stills, wherever possible (cursor motion, join moments, jump moments); frame-grabs of arrival states; both-users-visible split captures.
- **Annotate:** what happens in the first 3 seconds after join? how do I find my collaborator? how do I get back? what here is designed for 20 people that we can delete for 2?
- **Must produce:** a presence vocabulary for exactly-two (cursor + selection + one identity anchor — decide what the anchor is); a jump/Back interaction sketch (described, not designed); a Point evidence memo (inputs to the future prototype, no conclusion); a "calm checklist" (motion limits, label fade rules, color restraint).

### Board 3 — Recovery without timeline identity
*Answers RQ6, RQ7; feeds history treatment in all hypotheses.*

- **Locked by the product brief (not research questions):** Recent versions is secondary; it is bounded; historical preview is local; preview is read-only; preview does not interrupt or mutate collaborators' live state; restore is not in v1. Collaborators remaining live and unaffected is a locked invariant, not a research question. Research should examine how that fact is communicated visually — not whether it holds.
- **This board is only deciding:** entry point; discoverability; framing; version-list density; preview visual treatment; copy-from-version interaction; exit / back-to-current treatment.
- **Studies:** version-history entry points (where hidden, how invoked); revision-list anatomy (grouping, timestamps, density); temporary-preview modes (how the interface transforms, what stays); compare/restore patterns (for framing only — restore is out of v1 scope); read-only signaling that is not a color-temperature shift; the exit back to current (placement, persistence, keyboard path); reconnect/unsynced warnings; copy-from-version affordances.
- **Targets:** Google Docs version history; Pages/Craft version browsing; Notion page history; Figma version history; wiki page history; Time Machine (as the *anti-pattern* for chrome weight — annotate why its full-environment takeover is wrong for us); diff viewers for read-only framing.
- **Capture:** the closed state (prove it is invisible); the entry gesture; the open drawer/mode; the preview state; the exit; the copy affordance if present.
- **Annotate:** how many pixels does history cost when closed? is the preview state mistakable for editing? how do I leave — and could I ever *not* know how to leave? how does the interface communicate that collaborators keep editing, live and unaffected, while one person previews locally?
- **Must produce:** an entry-point recommendation shortlist (2–3 patterns); a read-only framing direction that is *not* Amber's temperature shift (structural/framing candidates); exit-affordance requirements; a density target for the version list ("boring on purpose" spec).

---

## Pinterest strategy

Pins are evidence, not mood. Every pin is renamed and annotated or deleted at the end of the session.

**Naming convention:** `B{board}-{territory}-{system}-{pattern}` — e.g. `B1-A-macwrite-title-chrome`, `B2-C-figma-cursor-fade`, `B3-C-pages-version-exit`.

**Annotation template (every pin, 3 lines):**

```
PRINCIPLE: the transferable idea in one sentence
REFUSE:    what in this image must not be copied
DECISION:  which research question / hypothesis this informs
```

### Board 1 — search phrases
1. `MacWrite 1984 screenshot`
2. `SimpleText TeachText window screenshot`
3. `HyperCard stack interface screenshot`
4. `ClarisWorks document window`
5. `System 7 save dialog unsaved changes`
6. `Writely 2006 interface` / `Google Docs 2008 screenshot`
7. `iA Writer focus mode typography`
8. `Bear app markdown editor minimal chrome`
9. `GitHub gist page screenshot`
10. `typewriter manuscript title block page`
11. `book colophon page design`
12. `legal document letterhead layout`
13. `Apple Pages title bar collaboration`
14. `Craft app document design`
15. `single column editor generous margins`

- **Save:** whole documents at rest; chrome close-ups; save indicators; empty documents; monospace set in document contexts.
- **Reject:** dribbble concepts; "redesigns"; dark-editor screenshots with neon syntax; anything where you cannot tell what product it is; bevel/pixel nostalgia posts without interface content.

### Board 2 — search phrases
1. `Figma multiplayer cursors names`
2. `Figma follow mode avatar spotlight`
3. `Google Docs collaborator cursor colored flag`
4. `Google Docs anonymous animal viewers`
5. `Etherpad author colors screenshot`
6. `Notion presence avatars page`
7. `Apple Notes collaboration cursor`
8. `Freeform app collaboration iPad`
9. `Miro cursor chat ping reaction`
10. `FigJam stamp ping cursor`
11. `Zed editor collaboration channels`
12. `multiplayer text editor remote selection highlight`
13. `live cursor label fade interaction`
14. `pair programming remote cursor UI`
15. `watch together presence indicator two people`

- **Save:** cursors mid-motion with labels; selection highlights from the *other* user's view; join/leave toasts; jump/follow affordances; ping/point gestures.
- **Reject:** marketing-page illustrations of fake cursors; avatar-pile hero shots; anything with more than 5 collaborators (wrong scale for our evidence).

### Board 3 — search phrases
1. `Google Docs version history panel screenshot`
2. `Apple Pages browse all versions interface`
3. `Craft app version history`
4. `Notion page history restore screenshot`
5. `Figma version history list`
6. `Wikipedia page history diff view`
7. `Time Machine restore interface macOS`
8. `document revision list timestamps design`
9. `read only banner document viewing`
10. `GitHub file history blame view`
11. `diff viewer side by side read only`
12. `autosave status all changes saved`
13. `offline reconnecting banner app`
14. `unsaved changes warning dialog design`

- **Save:** closed states *and* open states of the same product; exits ("Done", "Back to current"); read-only banners; reconnect banners; version-list rows close-up.
- **Reject:** timeline scrubbers and film-strip metaphors (the retired thesis — save none; the temptation is the danger); Git GUI complexity; branching visualizations.

**Avoid vague searches** such as: retro UI, cool developer tool, futuristic code editor, aesthetic dashboard. Prefer searches tied to interaction or software history.

---

## Mobbin strategy

Work flow-by-flow, not screen-by-screen. For each category: flows to inspect → patterns to record → poor-translation warnings → decisions informed.

| Category | Inspect (flows) | Record | Translates poorly | Informs |
|---|---|---|---|---|
| Instant creation | Arc/Notion/Craft "new doc"; Canva/Figma new-file; link-shortener and paste-tool creation | Steps from intent→editable; what exists before first keystroke; default titles | Template pickers; onboarding carousels | RQ1, RQ8 |
| Edit before account | Figma/Canva guest flows; survey tools' try-first; Excalidraw-type anonymous editing | Where the account wall appears; how "guest" is labeled; what is lost without account | Account-upsell banners (we have no accounts — note only as anti-pattern) | RQ1, RQ12 |
| Share & copy-link | Figma share modal; Notion share; Google Docs link settings; Zoom/Meet invite-copy | The copy gesture; confirmation (toast copy, duration); how permissions are *worded* | Permission matrices, role dropdowns (our model is simpler; evidence is what to delete) | RQ2, RQ12 |
| Join/loading | Docs/Figma opening a shared link; Meet/Zoom pre-join; multiplayer game join screens | What shows before content sync; identity-assignment moments; skeletons vs. spinners | Pre-join lobbies/device checks (wrong ceremony weight) | RQ3 (joining-before-sync) |
| Presence | Docs/Notion/Figma/Miro live sessions | Cursor+selection rendering; identity anchors; idle/away handling | Avatar piles; org-chart presence | RQ4 |
| Collaborator navigation | Figma avatar-click follow; Docs jump-to-cursor | The gesture; arrival orientation; how following/jumping *ends* | Persistent follow mode (post-v1) | RQ5 |
| Save/sync status | Docs "saved" wording; Notion sync; Linear offline; iCloud states | Exact copy strings; placement; transitions between states | Cloud-brand iconography; sync-settings pages | RQ3 |
| Reconnect & failure | Linear/Notion/Figma offline banners; Slack reconnecting; editors' conflict warnings | Severity ladder (ambient→banner→blocking); copy tone; recovery affordances | Full-screen error pages for transient states | RQ3 |
| History drawers | Notion page history; Figma versions; Docs version panel | Entry-point location; drawer vs. mode; list density | Git-style graphs | RQ6 |
| Read-only preview | Docs "viewing" mode; file previewers; locked-doc states | How editing affordances are removed/disabled; banner treatments | Watermarks; paywall-style locks | RQ7 |
| Export/download | Figma export; Notion export; print dialogs | Filename handling; format-choice moments; completion feedback | Multi-format export matrices (we have one artifact) | Export-as-ending |
| Empty document | Notes/Bear/Craft/Notion empty states | Placeholder copy; cursor state; what is clickable | Illustration-heavy empty states; template galleries | RQ8 |

**Standing recording rule:** for every flow, capture the *state grammar* (what changes between states, where on screen, how loud) — not the branding.

---

## Historical primary sources

Prefer emulator captures, scanned manuals, and archive screenshots over modern retro-tribute posts.

**Sources:** Internet Archive software collection + emulation (Mini vMac, Infinite Mac for in-browser System 6/7); GUIdebook Gallery (guidebookgallery.org); Apple Human Interface Guidelines (1987 & 1992 editions, full documents); Version Museum; Web Design Museum (Writely/early-Docs captures); archive.org Wayback for Etherpad (2009–2011) and pastebin origins; original MacWrite and HyperCard manuals (archive.org scans).

| System | Principle to extract | Why it matters here | Do not imitate |
|---|---|---|---|
| MacWrite (1984) | The document is the entire interface; ruler/tools collapse away; title = identity in chrome | The purest "sheet as serious object" precedent; calibrates minimum chrome | Bitmap fonts, patterned title bars, 72dpi texture |
| TeachText/SimpleText | One window, one text, near-zero affordances — still felt like *software*, not absence | Lower bound for RQ9: how little is too little | Its poverty of state feedback |
| HyperCard | A stack is a *thing you hand to someone*; author/browse as distinct postures | Hand-it-over model maps to Share; author/browse maps to live/preview postures (RQ7) | Card-metaphor literalism, home-stack kitsch |
| System 7 Finder & save model | The unsaved-dot; save as a *deliberate act* with a visible result | Ancestor of draft→Share deliberateness; one-glyph state honesty (RQ3) | Dialog-heavy modality |
| Apple HIG 1987/1992 (documents) | Codified rules for document identity, modality, feedback — *reasons*, not just looks | Strongest written articulation of document-first principles; quote in synthesis | Treating 1992 rules as binding UI law |
| Writely / Google Docs 2006–2010 | "Saving… / All changes saved" — state honesty as trust engine; web document with paper posture | Founding text for RQ3 copy; proof paper-posture works in-browser | Mid-2000s toolbar sprawl |
| Etherpad (2009) | Presence as text authorship; zero-ceremony pad creation; time-slider (study as *cautionary* — the retired thesis, shipped in 2009) | Both the honesty to keep and the timeline-identity to refuse, in one artifact | Author-color text soup; the slider |
| Early pastebins (2002–2010) | URL-as-object candor; create→address→done | RQ2/RQ12 in their most distilled form | Ad-cluttered layouts, visual neglect |
| Xerox Star / Alto documents (context) | Origin of document-as-object and direct manipulation; "the document is the interface" as founding ideology | Grounds the lineage argument for the portfolio narrative | Everything literal — conceptual ancestry only |

---

## Competitor visual audit

**Subjects:** Codeshare · ShareCode (sharecode.in — official collaborative editor reference: `https://www.sharecode.in/about`) · one additional relevant collaborative code product (e.g. CoderPad sandbox or codefile.io — whichever has a live free flow at audit time; CoderPad brings the interview-tool contrast, codefile.io the closest-loop comparison). Gist as a fourth *reference point* (not competitor) for document-framing contrast.

**Method:** two browsers, one incognito, screen-record the full loop twice (as creator, as joiner). Throttle the network mid-session (DevTools offline) for state-truthfulness testing. A keyboard-only pass for the accessibility row.

**Audit matrix** — score each dimension 1–5 with a screenshot per cell:

| Dimension | What to record |
|---|---|
| Landing/entry | What do I see before I act? Is "start typing" available in under 5s? |
| Creation | Gesture count to editable state; what exists pre-share? Is there a local phase at all? |
| Copy-link | Where is the affordance? Confirmation? Is the URL the object or a feature? |
| Join | Second browser: time-to-content, identity assignment, initial-sync honesty |
| Editor hierarchy | Annotated screenshot: what % of pixels is content vs. chrome? What is louder than code? |
| Presence | Both windows visible: cursor/selection rendering, identity clarity, noise level |
| State truthfulness | Kill network mid-edit: what does each side claim? Is unsynced work flagged? Reconnect behavior? |
| Empty state | New sheet with nothing in it — dead or inviting? |
| Return visit | Reopen link next day: is it there? What does it say about retention? |
| History/recovery | Any versions at all? (Hypothesis to verify, including contrary evidence: recovery may be absent — actively look for versions and record any that exist) |
| Visual personality | Could this screenshot be identified without the logo? |
| Trust signals | What claims are made (private? saved? forever?) — and are they true? |
| Accessibility cues | Focus rings, keyboard reach, contrast, motion |

**Required outputs** — each bullet below is a set of *hypotheses to verify, including contrary evidence*, not a settled finding. The audit must actively record evidence that disproves each predicted pattern — specifically, evidence that draft-before-share is *not* uncommon, that sync truthfulness is *not* weak, that recovery is *not* absent, that jump-to-collaborator is *not* uncommon, or that the category is *not* visually homogeneous. Where the evidence contradicts a hypothesis, record the contradiction rather than discarding it.
- **Conventions to respect** (hypothesis to verify: instant anonymous join; monospace + familiar syntax coloring; the link as sole ceremony) — if confirmed, deviating here makes us wrong, not distinctive.
- **Conventions to deliberately break** (hypothesis to verify, including contrary evidence: dark-tool-chrome default; presence as afterthought; silence about save/sync truth; no local phase; no recovery story) — record any competitor that already handles one of these well.
- **Obvious gaps** (hypothesis to verify, including contrary evidence: the six-state grammar; quiet versions; draft-before-share; export dignity; any visual identity at all) — a "gap" counts only once the audit confirms it is actually missing across the sample.
- **Where polish is not enough:** *if* the audit confirms competitors have no lifecycle model — no draft, no truth, no recovery — then the differentiator is structural, and the visual direction must make the *lifecycle* visible, not just re-skin the same loop. Whether that "if" holds is the audit's central question, not a settled premise.

---

## Visual-direction hypotheses

Three hypotheses. **No winner is chosen here.** Each must survive contact with the boards' evidence.

### H1 — The Typeset Sheet
**Thesis:** the code sheet is a *printed page that happens to be alive* — light, paper-postured, typographically serious, where sharing feels like handing someone the page.

- **Lineage:** MacWrite/HIG document tradition → Writely/early Docs → iA Writer; typographic specimen culture for monospace.
- **Character:** quiet, literate, confident; the anti-terminal. Personality lives in typography and microcopy.
- **Typography:** a characterful humanist mono for code (the iA/Triplicate register — evidence to decide); UI text in the same mono or a single restrained companion; type does almost all hierarchy work.
- **Surface/chrome:** light ground; near-zero chrome; title + state line above content like a manuscript header; no panels; generous measure and margins.
- **Presence:** ink-weight accents — thin named carets and understated selection tints on paper; collaborator identity as a name in the header line, not an avatar.
- **Connection state:** typeset status line adjacent to title ("Draft — local only" → "Shared · saved" → "Reconnecting…"), Docs-lineage copy honesty; failure gains a rule/border, not a red panel.
- **History:** versions as a *contents page* — typographic list in a temporary overlay; preview reads as "proof copy" via framing and header change, no color-temperature shift.
- **Likely strengths:** potentially instantly distinct from the competitor field *if the audit confirms it is predominantly dark*; photographs beautifully; document-not-IDE for free; accessibility-friendly ground.
- **Likely risks:** developers' dark-mode expectations for code; syntax-palette-on-light needs real work to avoid highlighter soup; can drift twee/literary.
- **Validates if:** Board 1 shows light document posture carries code credibly (Gist is partial proof); competitor audit confirms an all-dark field; a syntax-on-paper legibility spike passes. **Rejects if:** light-ground code reads as "blog post" rather than "live surface"; presence feels invisible on paper.

### H2 — The Studio Desk
**Thesis:** the sheet is a *physical object on a neutral workspace* — an elevated card whose material state visibly changes when it goes from local draft to shared live document.

- **Lineage:** Freeform/Craft/Figma-canvas object model; modern macOS material discipline; HyperCard's hand-someone-the-stack objecthood.
- **Character:** spatial, calm, crafted; the interface is a desk, the sheet is the only thing on it.
- **Typography:** neutral high-quality mono for code; compact system-adjacent sans for chrome; hierarchy via elevation and spacing more than type contrast.
- **Surface/chrome:** neutral gray-toned canvas (light or graphite variant — evidence decides); the sheet as a single elevated surface with real shadow; controls on the *desk*, never on the sheet.
- **Presence:** collaborator as a presence chip docked to the sheet's edge (on the object, because they are *in the document*); cursors/selections standard-calm inside.
- **Connection state:** *material* state — draft sheet is matte with a "local" tag; Share animates a subtle lift/edge-light ("it now exists elsewhere"); reconnecting dims the edge; failed sets the sheet visibly "down." Plus a truthful text label — material alone never carries it (accessibility).
- **History:** versions slide from under the sheet (drawer beneath the object); preview swaps a visibly *different* sheet on top — read-only as a different object, spatially, not chromatically.
- **Likely strengths:** strongest local-vs-shared metaphor of the three — the core lifecycle becomes literally visible; distinctive screenshots; natural home for state changes.
- **Likely risks:** skeuomorphism creep; shadow-and-canvas can go generic-design-tool; material cues fail colorblind/low-vision users if not doubled with text; more CSS surface to keep calm.
- **Validates if:** Board 1 sheet-on-canvas captures outperform full-bleed for object identity; Mobbin state-grammar research shows material+label patterns reading truthfully; the desk survives a 13" laptop without wasted space. **Rejects if:** canvas margins feel like waste at code-width; the material metaphor demands motion that violates reduced-motion calm.

### H3 — The Honest Utility
**Thesis:** the product looks like *infrastructure with manners* — old-web candor (the URL is the thing, the states are stated in words, every control is visibly what it is) executed with modern typographic rigor.

- **Lineage:** Etherpad/pastebin/wiki honesty → early Docs plainness → Linear's restraint-as-premium; HTML-native controls elevated, not disguised.
- **Character:** blunt, trustworthy, fast; personality from candor and precision, not decoration. The tool a sysadmin would trust and a designer would respect.
- **Typography:** one excellent mono for *everything* — code, UI, states (Berkeley register); hierarchy from weight, size, and rules; text is the interface.
- **Surface/chrome:** near-flat; visible 1px structure; a plain header stating the truth: title, state, collaborator, share — as *words and real controls*. Light-first with an honest dark variant later.
- **Presence:** presence as a *statement* — "kaya is here" in the header + standard cursor/selection; no avatars anywhere; join/leave as one-line notices.
- **Connection state:** the flagship — a plain-language status phrase as a permanent header element ("local draft, not uploaded" / "shared — saved just now" / "reconnecting — edits not yet saved"), state changes as text changes first, color second. Maximum truthfulness per pixel.
- **History:** "versions" as a plain text control; a boring, dense, honest list; preview announced by a full-width one-line banner ("viewing 14:32 version — read-only — back to current"), the banner *is* the exit.
- **Likely strengths:** cheapest to build truthfully in React/CSS; hardest to mistake for Replit *or* for retro costume; state-truthfulness (brief principle 4) becomes the visual identity; ages well.
- **Likely risks:** narrow line between "confident plainness" and "unfinished"; single-mono system demands elite typographic execution; may undersell craft to portfolio viewers who skim.
- **Validates if:** competitor audit shows trust-language absent everywhere (candor = differentiation); Board 3 confirms text-first state changes read faster than iconographic ones; a header-statement mock passes the 30-second-legibility test. **Rejects if:** test viewers describe it as "default HTML" rather than "intentional"; the header statement cannot stay calm through reconnect churn.

**Shared guardrails for all three:** code-area legibility is inviolable; every state doubled in text (never color-only); reduced-motion versions specified from day one; no pixel fonts, bevels, scanlines, or CRT anything.

---

## Screenshot annotation template

One block per capture, kept with the image:

```
ID:         B{1|2|3}-{A|B|C|D}-{system}-{pattern}   (matches pin naming)
SOURCE:     product + version/date + URL or emulator
MOMENT:     what state/flow this shows (one line)
PRINCIPLE:  the transferable idea (one sentence, no adjectives without nouns)
MECHANISM:  concretely how the UI achieves it (placement, copy, weight, motion)
REFUSE:     what here must not be copied, and why
STATES:     which of our six states / lifecycle steps this informs
HYPOTHESIS: supports / challenges H1, H2, H3 (state which and how)
VERDICT:    keep / reference-only / anti-pattern
```

---

## Synthesis template

The document that ends the research phase (future `docs/DESIGN_DIRECTION.md` input — not created yet):

```
1. FIELD REPORT      — what the competitor audit proved (with the matrix)
2. EVIDENCE DIGEST   — per board: 5 strongest captures, principle each locked
3. QUESTION ANSWERS  — RQ1–RQ12 answered in one paragraph each, citing capture IDs
4. HYPOTHESIS TRIALS — per hypothesis: validating evidence found, rejecting evidence
                        found, verdict (advance / merge / kill)
5. DIRECTION         — the surviving direction: thesis, lineage, and the
                        state-grammar table (all six states × treatment)
6. GUARDRAILS        — the refuse-list carried forward (anti-costume, calm rules)
7. LOCKED / OPEN     — explicit lists (see below)
8. NEXT TASK         — single named task with acceptance criteria
```

---

## Decisions research should lock

1. Ground stance: light / dark / canvas-neutral default.
2. Object stance: sheet-on-canvas vs. full-bleed document.
3. The state grammar: where the six states live on screen and their severity ladder (ambient → labeled → interruptive).
4. Save/sync copy register (the exact wording family).
5. Presence vocabulary for exactly-two (cursor + selection + chosen identity anchor; avatars in or out).
6. Recent-versions entry-point pattern and the read-only framing mechanism (the non-Amber answer to RQ7).
7. Title treatment and the "document not IDE" rule list.
8. Typography *strategy* (one-mono-for-all vs. mono+companion) — though not final typefaces.
9. The borrow/refuse table per historical territory (the anti-costume contract).

## Decisions that must remain open

1. Final palette values and syntax-highlighting theme.
2. Final typeface licenses/choices (strategy locked, faces spiked in build).
3. Everything about Point — lifetime, repeat behavior, reduced-motion form, and whether it ships (prototype territory; see `docs/experiments/POINT_EXPERIMENT.md`).
4. Jump/Back micro-mechanics (research sketches them; a disposable prototype decides them).
5. Motion specification beyond the calm/reduced-motion guardrails.
6. Product name and any naming-dependent chrome.
7. All architecture (persistence, identity storage, routing) — untouched by design research.
8. Version cadence/bound/coalescing (the brief's open details — design research may *inform*, must not decide).

---

## Next task

**Run the reference collection.**

Dependency order forces it: the synthesis consumes evidence that does not exist yet, and a disposable interaction prototype would today be built on an unchosen ground stance — it would silently re-inherit Amber-era defaults, precisely the failure mode this program exists to prevent. Collection is the only task with no unmet dependencies.

**Scope of that task:**
1. Execute the competitor audit first — two browsers, screen recordings, the 13-row matrix for all three products. Fastest to complete; grounds everything else in "what the field actually is."
2. Execute Boards 1–3 via the Pinterest, Mobbin, and historical-source plans — every capture annotated with the template at save time, not retroactively.
3. Exit criteria: audit matrix complete; at least 12 annotated captures per board with no unannotated pins surviving; each board's "must produce" list delivered; every capture tagged for/against H1–H3.

**Then** the synthesis runs against that evidence, and only after a direction survives does a disposable prototype earn its place — first candidates: the six-state header grammar, then jump/Back, then Point.
