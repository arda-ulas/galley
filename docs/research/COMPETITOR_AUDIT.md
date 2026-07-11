# Competitor Audit — Collaborative Code-Sharing Products

> **Status: active competitor-audit evidence.**
>
> This document records a manual browser audit conducted on 2026-07-10 for the Echo/Rewind reconstruction design-research phase. It supports `docs/DESIGN_RESEARCH_PLAN.md` and does not define product scope or final visual direction. `docs/PRODUCT_BRIEF.md` remains canonical.

## Provenance

- **Method:** browser-driven manual audit (Claude-in-Chrome), one macOS Chrome browser.
- **Contexts:** one normal browser session, with a **second tab** used for initial multiplayer observation. The second tab was **not** a fully isolated context (same browser session).
- **Captures:** 18 screenshots were saved manually **outside the repository**.
- **Capture folder:** `~/Desktop/echo-rewind-competitor-audit-2026-07-10/`.
- **Git:** screenshots are **not** part of Git in this pass.
- **Missing image:** `COMP-codefile-02-captcha` is the only missing capture (state was observed live and recorded in notes).
- **Evidence labels used throughout:**
  - **Directly observed** — seen firsthand in the live product during this audit.
  - **First-party claimed** — stated by the product's own marketing/mockups, not independently verified.
  - **Inferred** — reasoned from observed behavior, not directly confirmed.
  - **Not verified** — not tested or not confirmable with the available tooling.
  - **Unavailable** — could not be reached (gated, blocked, or errored).

---

## Limitations (read before the findings)

These constraints bound every conclusion in this document.

- **No isolated guest context was available.** The "guest" was a second tab in the same signed-in browser.
- **Remote cursor rendering for distinct users is not verified.** The absence of presence *chrome* was observed; labeled remote-cursor behavior for separate users was not.
- **Identity, cookie, and storage isolation are not verified.**
- **Offline, reconnecting, unsynced, and failure states were not tested.** The available tooling exposed no safe DevTools network control, and page-JS "offline" events would have been synthetic. No claim is made about these states.
- **Long-term persistence was not tested.** Where content survived a reload, that is **short-session persistence** only.
- **Reload persistence means only short-session persistence** — not durability across days, server restarts, or stated retention windows.
- **Codefile was blocked** by a reCAPTCHA gate that then errored ("Oops, something went wrong. Try again."). Its live editor is `Unavailable`.
- **CoderPad collaboration was account-gated.** Only the single-user sandbox was reachable.
- **ShareCodeLive was not assessed** (could not confirm it is a distinct, usable product separate from ShareCode).
- **Absence of an affordance means "not found in the tested surface,"** not proof that no hidden, later-loading, or account-only feature exists.

---

## Products

### 1. Codeshare

#### Availability
- **URL:** `https://codeshare.io` — accessible, no account, no paywall.
- **Date:** 2026-07-10.
- **Access limitations:** none for the tested flow; ad banner present.

#### Verified flow
Landing page with a "Share Code Now" CTA; one click opens an editor at a freshly created URL (`/5X9mdo`). Typing streamed into that already-created remote object with no upload prompt. "Share" opened a dialog that copied the already-existing URL. Opening the same URL in a second tab showed the synced content immediately with no identity/permission/account/loading gate. Text typed in one tab appeared in the other. A recovery search (settings, right rail, chrome) found no history surface. Reloading the URL preserved content for the session.

#### Evidence table
| Dimension | Finding | Evidence label | Capture ID | Notes |
|---|---|---|---|---|
| Remote-object timing | URL created at editor-open, before any Share | Directly observed | COMP-codeshare-02-editor-empty | Address bar changed on CTA click, before typing |
| Draft-before-share | Absent; no local draft phase | Directly observed | COMP-codeshare-02-editor-empty | Placeholder: "Anyone you share with will see code as it is typed!" |
| Share/copy behavior | Creation and copy separate; Share copies the existing URL; inline "Copied!" | Directly observed | COMP-codeshare-03-share-open, COMP-codeshare-04-link-copied | — |
| Access microcopy | "Anyone with access to this URL will see your code in real time." | Directly observed | COMP-codeshare-03-share-open | Honest about link access |
| Permission control | Coarse "View only" mode toggle (default OFF) | Directly observed | COMP-codeshare-03-share-open | — |
| Guest join | Instant; no identity/permission/account/loading gate | Directly observed | COMP-codeshare-05-guest-joined | Same-session second tab |
| Live text sync | Line typed in one tab appeared in the other | Directly observed | COMP-codeshare-06-live-sync | Content only; no cursor claim |
| Presence chrome | No presence roster / avatar / participant count in the chrome | Directly observed | COMP-codeshare-06-live-sync | — |
| Remote cursor (distinct users) | Not confirmed | Not verified | — | Same-session, backgrounded observer tab |
| Connection/save indicator | None in the healthy state (only "Expires in 24 hours") | Directly observed | COMP-codeshare-07-settings | Offline behavior not tested |
| Recovery/history | No history/versions/restore found; settings = Syntax/Tab/Theme/Keymap | Directly observed | COMP-codeshare-07-settings | — |
| Short-session persistence | Content persisted across reload | Directly observed | COMP-codeshare-10-return-visit | Short session only |
| Document model | Single file; title = auto timestamp; syntax defaults to "Plain Text" (manual) | Directly observed | COMP-codeshare-07-settings | — |
| Visual framing | Dark; near full-bleed editor; thin top bar + right rail; ad banner | Directly observed | COMP-codeshare-02-editor-empty | High content-to-chrome |
| Export | "Download" affordance present | Directly observed | COMP-codeshare-07-settings | File output not verified (download not triggered) |

#### Product takeaway
- **Strongest positive pattern:** candid link-access microcopy ("Anyone with access to this URL will see your code in real time").
- **Strongest directly supported weakness:** no connection/save-state indicator and no presence roster in the tested surface.
- **Contrary evidence:** a real view-only permission exists; access-model candor is better than expected.
- **Remaining unknowns:** distinct-user remote cursors; offline/reconnect; durability beyond the session.

---

### 2. Codefile

#### Availability
- **URL:** `https://codefile.io` — landing accessible; live editor `Unavailable`.
- **Date:** 2026-07-10.
- **Access limitations:** creation gated by a reCAPTCHA that then errored.

#### Verified flow
Landing page with a "+ New file" CTA. Clicking it opened a "Create a new file — Let's double check you're really human:" modal with a reCAPTCHA checkbox (not interacted with). On the attempt the modal errored ("Oops, something went wrong. Try again."). The live editor, share, join, collaboration, recovery, and persistence could not be tested.

#### Evidence table
| Dimension | Finding | Evidence label | Capture ID | Notes |
|---|---|---|---|---|
| Entry | Light landing; "+ New file" CTA | Directly observed | COMP-codefile-01-entry | "No sign up. Free. Forever ❤️" |
| Creation gate | reCAPTCHA "I'm not a robot" before file creation | Directly observed | COMP-codefile-02-captcha (not saved) | State observed live |
| Creation result | Failed after the gate ("Oops, something went wrong. Try again.") | Directly observed | COMP-codefile-02-captcha (not saved) | Not retried |
| Retention | "Free. Forever" permanence phrasing | First-party claimed | COMP-codefile-01-entry | Marketing copy |
| Document title | Editable title ("Interview with Jon") | First-party claimed | COMP-codefile-01-entry | Landing mockup only |
| Presence | Participant count "2" + avatar + named cursor | First-party claimed | COMP-codefile-01-entry | Landing mockup only |
| Live editor & all flows | Not reachable | Unavailable | — | CAPTCHA/error gate |

#### Product takeaway
- **Strongest positive pattern:** (claimed) named document title and participant count — more document-like identity than Codeshare, but unverified.
- **Strongest directly supported weakness:** creation friction — a CAPTCHA wall that then errored.
- **Contrary evidence:** light marketing theme; claimed named title + avatar presence (unverified).
- **Remaining unknowns:** essentially the entire live product.

---

### 3. ShareCode

#### Availability
- **URL:** `https://www.sharecode.in` (official collaborative editor reference: `https://www.sharecode.in/about`) — accessible, no account. Cookie banner declined.
- **Date:** 2026-07-10.
- **Access limitations:** email-send share and some features gated behind sign-in; donation prompt appears.

#### Verified flow
Light landing with a "Start Coding Now" CTA; one click opened a dark editor at a freshly created URL (`/iDpZji`). Typing streamed into the already-created remote object. A QR icon opened a share sheet distributing the existing URL. Opening the URL in a second tab synced content; text typed in one tab appeared in the other (after ensuring editor focus). A recovery search found no history surface (the clock indicator is a "last updated" stamp, not versions). Reloading preserved content for the session.

#### Evidence table
| Dimension | Finding | Evidence label | Capture ID | Notes |
|---|---|---|---|---|
| Remote-object timing | URL created at editor-open, before any Share | Directly observed | COMP-sharecode-02-editor-empty | Title "CodeSpace" |
| Draft-before-share | Absent | Directly observed | COMP-sharecode-02-editor-empty | Placeholder near-identical to Codeshare |
| Share/copy behavior | QR share sheet distributes the existing URL; top-bar "Copy" copies code, not link | Directly observed | COMP-sharecode-03-share-open | "Copy all code to clipboard" tooltip |
| Access microcopy | "Anyone with the link can view & collaborate live" | Directly observed | COMP-sharecode-03-share-open | Honest about link access |
| Guest join | Account-less join in the tested flow | Directly observed | COMP-sharecode-09-live-sync | Same-session second tab |
| Live text sync | Line typed in one tab appeared in the other | Directly observed | COMP-sharecode-09-live-sync | Content only; no cursor claim |
| Presence chrome | No persistent presence roster / visible remote caret | Directly observed (absence) / Not verified (distinct users) | COMP-sharecode-09-live-sync | Same-session caveat |
| Connection/save indicator | Only a "last updated by · Xm ago" stamp; no connect/sync state | Directly observed | COMP-sharecode-06-last-updated | Small truthfulness cue |
| Recovery/history | No history/versions/restore found (clock = last-updated) | Directly observed | COMP-sharecode-06-last-updated | — |
| Short-session persistence | Content persisted across reload | Directly observed | COMP-sharecode-10-return-visit | Short session only |
| Editor / document model | Dark editor; syntax highlighting on by default; single file | Directly observed | COMP-sharecode-02-editor-empty | Contrasts Codeshare's Plain-Text default |
| Additional features | "Run" (execution), video-call icon, attach, embed, social share | Directly observed | COMP-sharecode-03-share-open | IDE-ward breadth |
| Visual framing | Light marketing site, dark editor; more top-bar controls than Codeshare | Directly observed | COMP-sharecode-01-entry, COMP-sharecode-02-editor-empty | — |

#### Product takeaway
- **Strongest positive pattern:** honest share copy ("Anyone with the link can view & collaborate live") plus a small "last updated by" truthfulness cue.
- **Strongest directly supported weakness:** feature breadth (Run, video, social, donations) with no history surface and no real connection-state communication in the healthy state.
- **Contrary evidence:** light marketing theme; syntax-on-by-default; the "last updated" cue that Codeshare lacks.
- **Remaining unknowns:** remote-cursor rendering; offline/reconnect; whether "Anonymous" ever differentiates two users; durability.

---

### 4. ShareCodeLive

#### Availability
- **Not assessed.** Could not confirm it is a distinct, usable collaborative product separate from ShareCode.
- **Date:** 2026-07-10.

#### Verified flow
None — not investigated in this pass (deprioritized to avoid guessing about an unconfirmed product).

#### Evidence table
| Dimension | Finding | Evidence label | Capture ID | Notes |
|---|---|---|---|---|
| Product distinctness | Not confirmed as a separate usable product | Not verified | — | Deferred by instruction |
| All flows | Not assessed | Unavailable | — | — |

#### Product takeaway
- **Strongest positive pattern:** none observed.
- **Strongest directly supported weakness:** none observed.
- **Contrary evidence:** none.
- **Remaining unknowns:** whether it is distinct from ShareCode and worth a later pass.

---

### 5. CoderPad Sandbox

#### Availability
- **URL:** `https://app.coderpad.io/sandbox` — accessible, no login.
- **Date:** 2026-07-10.
- **Access limitations:** the sandbox is single-user; collaborative "pads" are account-gated (`Unavailable`).

#### Verified flow
Opening the sandbox showed an immediate dark two-pane execution IDE (editor + console) seeded with Java. It offers Run, a console, IntelliSense, a language rail, and a drawing/whiteboard mode. No share/copy-link control exists in the sandbox. A recovery search found only "Reset." Collaboration could not be tested without an account.

#### Evidence table
| Dimension | Finding | Evidence label | Capture ID | Notes |
|---|---|---|---|---|
| Entry | Instant dark two-pane IDE, seeded code | Directly observed | COMP-coderpad-01-entry | "Running Temurin JDK 25" |
| Execution | Run + console output + IntelliSense | Directly observed | COMP-coderpad-01-entry | Execution-centric |
| Share / collaboration | No share/copy-link in sandbox; collaboration behind Login | Directly observed / Unavailable | COMP-coderpad-01-entry | Solo surface tested |
| Recovery | None found (Reset only) | Directly observed | COMP-coderpad-01-entry | — |
| Document model | Language rail, whiteboard, multi-language | Directly observed | COMP-coderpad-01-entry | — |
| Visual framing | Most IDE-like of the tested surfaces; low content-to-chrome | Directly observed | COMP-coderpad-01-entry | — |

#### Product takeaway
- **Strongest positive pattern:** immediate runnable environment with a clear runtime indicator.
- **Strongest directly supported weakness:** pure IDE framing; sharing/collaboration not present in the free surface.
- **Contrary evidence:** none for our hypotheses — it shows the IDE-like end of the spectrum exists.
- **Remaining unknowns:** the account-gated collaborative pad.

---

### 6. GitHub Gist

#### Availability
- **URL:** `https://gist.github.com` — accessible. The browser was signed into a GitHub account, so the audit stayed strictly read-only (viewed public gists and revisions only; created/edited/starred/forked nothing).
- **Date:** 2026-07-10.
- **Access limitations:** creating a gist requires an account (not exercised); this is a **non-live document/history reference**, not a live-collaboration test.

#### Verified flow
A public gist presents one titled document (author / filename) with a description and metadata. A "Revisions" tab (hidden behind one click) shows a git-backed revision history with per-revision diffs and a Split/Unified toggle. Export is available via Raw, Embed, and Download ZIP. There is no live multiplayer editing; there is a comment thread.

#### Evidence table
| Dimension | Finding | Evidence label | Capture ID | Notes |
|---|---|---|---|---|
| Document framing | One titled document (author / filename), description, metadata | Directly observed | COMP-gist-02-document | Strong single-object identity |
| History entry point | "Revisions" tab, hidden behind one click | Directly observed | COMP-gist-02-document | Quiet entry |
| Recovery model | Full git-backed revision history; per-revision diffs; Split/Unified toggle | Directly observed | COMP-gist-03-revisions | Permanent, diff/commit-shaped |
| Export | Raw, Embed `<script>`, Download ZIP | Directly observed | COMP-gist-02-document | Dignified export |
| Comments | Comment thread per gist | Directly observed | COMP-gist-02-document | Feature Echo/Rewind excludes |
| Live collaboration | None (single-author document) | Directly observed | COMP-gist-02-document | Not a live tool |

#### Product takeaway
- **Strongest positive pattern:** exemplary document identity (filename-as-title), a quiet history entry point, and dignified export.
- **Strongest directly supported weakness (as a model for us):** history is permanent, diff-centric, and commit-shaped — the heavy opposite of ephemeral bounded Recent versions; and there is no live collaboration.
- **Contrary evidence:** demonstrates that rich document-history UX is well-established, though in a non-live, diff-based form.
- **Remaining unknowns:** none material (read-only reference).

---

## Cross-product synthesis

### Category conventions directly observed
Bounded to the tested surfaces (Codeshare and ShareCode as the two directly tested live products):

- Both **created the remote object before Share**.
- **Share distributed an already-existing URL** (creation and copy were separate).
- Both supported **account-less short-session join/edit** in the tested flow.
- Both **persisted content across reload** during the short session.
- **URL possession was the main access model**.
- **Syntax-aware browser editing and line numbers** appear to be expected conventions.

These are observations about two products, not a claim about the entire category.

### Hypotheses supported (cautious wording)
- **Draft-before-share was absent** in both directly tested live products.
- **Neither directly tested live product exposed a user-facing history surface.**
- **Neither directly tested live product showed a persistent presence roster.**
- **No jump-to-collaborator affordance was found** in the tested flows.
- **Healthy-state connection/save truthfulness was limited** (only ShareCode's "last updated by" cue).

### Hypotheses weakened or disproved
- **Access-model truthfulness was stronger than expected** — honest "anyone with the link can edit" microcopy in both live tools.
- **Visual homogeneity was weaker than expected** — marketing sites were light (Codefile, ShareCode); framing spanned a spectrum from document (Gist) to full IDE (CoderPad).
- **ShareCode showed a small "last updated by" truthfulness cue.**
- **Codeshare included a view-only permission.**
- **GitHub Gist already provides strong document framing, quiet history entry, and dignified export** — outside live collaboration.

### Structural gaps supported by evidence (bounded)
- **Local draft before remote creation was not present in Codeshare or ShareCode.**
- **No user-facing Recent versions/history surface was found in those two live tools.**
- **No collaborator navigation was found** in the tested flows.
- **Live connection/save-state communication was weak in the healthy state.**

Not claimed: that the whole market has no recovery; that no competitor anywhere has local history; that reconnect handling is absent; that remote cursors are absent; that long-term persistence is absent.

### Merely visual gaps (separate from structural)
- Generic dark-editor framing.
- Ad/donation clutter.
- Inconsistent visual personality.
- IDE-like feature sprawl.

### Closest tested conceptual comparison
- **ShareCode** is the closest tested live comparison.
- **GitHub Gist** is the strongest non-live document/history reference.
- **Codefile** remains an important but largely unverified claimant.

---

## Explicit research answers

**Is draft-before-share genuinely uncommon?**
> In the two directly tested live products, yes: both created the remote object before Share. The broader category conclusion remains provisional.

**Is explicit sync truthfulness weak?**
> Healthy-state connection/save communication was weak in the directly tested live products. Offline, reconnect, unsynced, and failure behavior remains unverified.

**Is local live-safe historical preview absent?**
> No user-facing history or local preview surface was found in Codeshare or ShareCode. This supports the hypothesis but does not prove category-wide absence.

**Is jump-to-collaborator uncommon?**
> No jump-to-collaborator affordance was found in the directly tested live tools. Broader-category rarity remains provisional.

**Is recovery still a credible supporting distinction?**
> Yes, as a supporting distinction, because neither directly tested live tool exposed user-facing history, while Gist demonstrates the value of quiet document history in a non-live context.

**Which product is the closest conceptual threat?**
> ShareCode.

**Which parts of Echo/Rewind would still look derivative?**
Category table-stakes that will read as familiar regardless of execution:
- browser code editor
- syntax highlighting
- line numbers
- anonymous URL join
- live co-editing
- dark-editor presentation, if retained

Evidence-supported differentiators (where the distinctiveness must come from):
- local-draft lifecycle
- truthful live state
- bounded Recent versions
- local non-mutating preview
- collaborator navigation
- stronger document identity

---

## Capture manifest

The image files currently live **outside Git** in the local audit folder listed in Provenance (`~/Desktop/echo-rewind-competitor-audit-2026-07-10/`). They are not embedded here because local absolute paths would not resolve for other repository users.

**Codeshare (8):**
- COMP-codeshare-01-entry
- COMP-codeshare-02-editor-empty
- COMP-codeshare-03-share-open
- COMP-codeshare-04-link-copied
- COMP-codeshare-05-guest-joined
- COMP-codeshare-06-live-sync
- COMP-codeshare-07-settings
- COMP-codeshare-10-return-visit

**ShareCode (6):**
- COMP-sharecode-01-entry
- COMP-sharecode-02-editor-empty
- COMP-sharecode-03-share-open
- COMP-sharecode-06-last-updated
- COMP-sharecode-09-live-sync
- COMP-sharecode-10-return-visit

**Codefile (1 saved):**
- COMP-codefile-01-entry
- COMP-codefile-02-captcha — **not saved**; state observed live and recorded in notes (reCAPTCHA gate that then errored).

**CoderPad (1):**
- COMP-coderpad-01-entry

**GitHub Gist (2):**
- COMP-gist-02-document
- COMP-gist-03-revisions

**Total saved: 18.** Missing: 1 (`COMP-codefile-02-captcha`).

### Strongest seven
1. **COMP-codeshare-02-editor-empty** — shows the remote object exists at editor-open (no draft-before-share) and the placeholder microcopy.
2. **COMP-codeshare-03-share-open** — honest link-access microcopy plus a view-only permission.
3. **COMP-sharecode-03-share-open** — a richer share sheet with the same candid "collaborate live" access framing.
4. **COMP-sharecode-06-last-updated** — the one small state-truthfulness cue found in the tested tools.
5. **COMP-coderpad-01-entry** — the IDE anti-pattern anchor that defines what not to become.
6. **COMP-gist-02-document** — the strongest document-framing reference (title identity, quiet history entry, dignified export).
7. **COMP-gist-03-revisions** — the recovery model in the wrong (permanent, diff-based) shape, clarifying the Board 3 stance.

---

## Implications for Boards 1–3

### Board 1 — Document as a serious object
- Gist is the strongest document-framing reference.
- Filename/title hierarchy and quiet export are useful.
- Light versus dark remains open.
- Competitor editors do not establish dark as mandatory.

### Board 2 — Human presence and attention
- The tested tools offered little directly observable presence chrome.
- Distinct-user cursor behavior remains unverified.
- Reference collection should therefore continue with Figma, Google Docs, Notes, Freeform, and other collaboration products.
- No conclusion about Point should be drawn.

### Board 3 — Recovery without timeline identity
- Gist's quiet Revisions entry is useful.
- Its permanent diff/commit model is not the desired Recent versions model.
- Codeshare and ShareCode showed no history surface in the tested flows.
- Keep the brief's locked invariants: bounded · secondary · local · read-only · non-mutating to collaborators · no restore in v1.

---

## Next research dependency

> Next: continue Boards 1–3 reference collection. The competitor audit is sufficient to proceed; no second competitor pass is required before historical, Pinterest, Mobbin, and modern collaboration references are collected. Offline/reconnect behavior may receive a later targeted pass if safer browser tooling becomes available.
