# Product Brief

**Status:** Canonical reconstruction brief
**Supersedes:** the retired timeline-first Echo/Rewind product thesis ("the timeline is the interface")
**Historical implementation reference:** `prototype-v1` → `4147372`
**Last updated:** 2026-07-10

---

## What this is

**Category:** Real-time collaborative code sharing — differentiated through lifecycle, recovery, and interaction craft, not through the baseline of anonymous joining and shared cursors.

**Primary user:** A working developer already in a live call or chat with one trusted collaborator.

**Primary moment:** Mid-conversation — *"Hang on, let me show you"* — with a self-contained code excerpt or single file in hand.

**Primary job:** Give both people independent eyes and hands on the same code within seconds, without sharing an entire project, installing software, or handing over control.

**Product sentence:** Paste code into a local draft, share one link, and think it through together—with live cursors, honest sync state, and Recent versions available quietly when recovery is needed.

**Canonical artifact:** A shared **code sheet**.

---

## Locked decisions

### Creation model
- The root opens a **local draft**.
- Draft code is not uploaded before Share.
- **Share** creates the remote sheet, uploads the initial state, and copies the edit link — one gesture.
- If Share fails, the current draft remains available in the open page.
- Once shared, the artifact stays a shared sheet; it does not revert to draft.

### Access and persistence
Anyone with the edit link can read and change the sheet. V1 provides no verified owner or link revocation.

Shared sheets remain available under a clearly disclosed service retention policy. The product does not promise permanent availability. Only an exported local copy falls outside service retention. The same link reopens the current sheet while it remains retained.

### Identity
Anonymous · per sheet · per browser · generated name and color · user-editable · may be restored while browser storage remains available · **unverified**. Never described as authenticated identity or authorship.

### Core loop
1. Open a local draft.
2. Paste or write one self-contained excerpt.
3. Choose a language if needed.
4. Invoke Share.
5. The remote sheet is created; the edit link is copied.
6. A collaborator joins immediately with a generated guest identity.
7. Both independently inspect and edit the same code.
8. Presence, cursors, selections, and jump-to-collaborator support the conversation.
9. Connection and saved state stay visibly truthful.
10. If earlier text is needed, one person opens Recent versions and previews a bounded past state locally while the collaborator stays live.
11. Past text is copied back out without mutating the current sheet.
12. The result is copied or downloaded into the user's real environment.
13. The same link may be reopened while the sheet remains under retention.

### Differentiators

**Primary experience:** immediate independent co-editing between two people.

**Supporting product distinction:** bounded Recent versions that one participant can preview locally without interrupting live collaborators.

**Supporting lifecycle distinction:** local draft until deliberately shared.

**Experimental interaction:** deliberate Point behavior — validated before inclusion.

### History — "Recent versions"

**Locked:** automatic · bounded · hidden by default · zero permanent timeline chrome · chronological list · local read-only preview · collaborators keep editing unaffected · obvious return-to-current · copy full text from a previewed version · no restore · no named checkpoints · no author attribution · no diff · no audit-log claim.

**Open details:** capture cadence · version bound · coalescing policy · exact copy interaction.

Preview-and-copy without restore is locked for v1. Cadence, bounds, and coalescing remain open design and architecture details.

---

## Minimum complete v1

### Product behavior
- Local draft open on root
- Share creates a remote sheet and copies the edit link
- Stable edit link during retention
- One sheet, one selected language
- Document title
- Anonymous immediate joining
- Per-sheet browser guest identity
- Presence
- Remote cursors
- Remote selections
- Jump to collaborator
- A user can navigate to a collaborator's current location and return to a meaningful prior location through an explicit, keyboard-accessible Back action
- Truthful connection and remote-save state; the product must distinguish connecting, shared-and-saved, reconnecting, unsynced, and failed states; it does not promise that unsynced work survives closing or reloading
- Download with appropriate filename and extension
- Bounded Recent versions
- Local read-only historical preview
- Copy from a past version

### Required editor baseline
- Syntax-aware CodeMirror editing
- Find/search
- Standard selection and clipboard behavior
- Safe per-user undo/redo that does not unintentionally undo collaborators' changes (required; not currently proven by prototype-v1)

### Required designed states
- Empty local draft
- Initial Share
- Share failure
- Shared and saved
- Reconnecting
- Disconnected or failed
- Collaborator joining before initial sync
- Collaborator joining or leaving
- Waiting alone for a collaborator
- Invalid or unavailable link
- No recent versions yet
- Loading a historical preview
- Viewing a historical preview
- Return to current
- Closing or navigating away with unsynced work

### Accessibility requirements
- All controls keyboard reachable
- Jump and Back operable without a pointer
- Overlays restore focus correctly
- State changes announced through appropriate live regions
- Identity never communicated by color alone
- Reduced-motion preferences respected
- Historical mode unmistakably read-only
- Connection failure communicated clearly, not only visually

---

## Prototype questions (not yet decided)

**Prototype before inclusion:**
- Selection-adjacent "Point here"
- Off-screen point indicator
- Ping lifetime
- Repeated-ping behavior
- Reduced-motion treatment for Point
- Whether deliberate pointing improves on ordinary remote selection and voice
- Whether Point should integrate with jump navigation

**Open experiments:** Does deliberate pointing outperform ordinary remote selection and voice? Which copy-from-version interaction is clearest? What version cadence and bound feel useful without creating noise?

---

## Boundaries

**Post-v1:** restore from version · named checkpoints · local recents · read-only links · continuous follow mode · duplicate from version · mobile viewing polish.

**Explicitly excluded:** code execution · terminal · package installation · deployment · multiple files · file tree · comments · chat · accounts · AI · autocomplete · linting · automatic formatting · presenter mode · classroom-scale collaboration.

---

## Product principles

1. **Both editing within seconds.** The path from paste to independent co-editing must remain nearly frictionless.
2. **A sheet, not an IDE.** One self-contained code artifact. Production tooling remains elsewhere.
3. **Local until deliberately shared.** Opening the product uploads no code and creates no remote object.
4. **Always tell the truth about state.** Local, shared, saved, reconnecting, failed, live, and historical states are never visually conflated.
5. **The collaborator is more important than the chrome.** Presence and attention outrank toolbars and settings for design priority.
6. **Recovery stays invisible until needed.** Recent versions are a safety surface, never the main interface.
7. **Character without costume.** Old-internet, classic Mac, or macOS references may shape the visual identity, but never at the cost of clarity, latency, accessibility, or technical seriousness.

---

## Public promises that must not be made

The local draft is local before Share. After Share, anyone with the edit link can read and change the sheet; the shared sheet must never be described as private or secure.

Do not promise: permanent / forever · describing a shared sheet as private · secure / only-invited-collaborators · verified identity · verified authorship · ownership or revocation · complete history · "every keystroke is retained" · "nothing can be lost" · full offline support · source-control replacement · backup replacement.

---

## Success criteria

**A new user understands within 30 seconds:** this is a local draft until shared · Share creates one editable link · another person can edit independently · connection state is trustworthy · Recent versions are secondary recovery · the product does not run code or replace an IDE.

**A portfolio viewer understands:** the product decision is deliberate · the collaboration model is technically credible · historical preview preserves live collaboration · the design prioritizes state truthfulness and human attention · the project is more than a polished code pad.
