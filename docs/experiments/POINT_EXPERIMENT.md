# Experiment Brief — Does Deliberate Pointing Beat Selection Plus Voice?

> **Status: approved experiment specification; implementation not yet authorized.**
>
> This document defines how deliberate Point behavior may later be tested. It does not place Point in v1 and does not authorize prototype code. A smaller first probe may be derived after visual-direction synthesis.

Disposable paired-use experiment. Specification only — no production code, no final UI, no v1 assumption. This brief exists to answer the product brief's open question: *"Does deliberate pointing outperform ordinary remote selection and voice?"* A "no" is as valuable as a "yes."

---

## Framing and stance

**Hypothesis (H1):** An explicit Point action brings a collaborator's attention to an exact range faster and with fewer verbal coordination moves than ordinary remote selection plus voice.

**Null stance (H0), stated with respect:** Two people on a call already have a high-bandwidth attention channel — voice — and ordinary selection is already visible. Point may be redundant ceremony. The experiment is designed so that H0 winning is a clean, publishable outcome, not a failed study. The observer's job is to catch the moments where voice + selection *already worked fine*, because that is the strongest evidence available.

### Behavior envelope (not visual design)

What Point is, for this experiment:

- Sender selects a range, then performs one explicit additional action ("Point").
- Recipient sees one calm visible target at that range — no flashing loop, no modal, no sound.
- If the range is off-screen, the recipient sees exactly one directional indicator.
- Recipient may jump to the target; after jumping, an explicit Back action returns them to their prior location.
- Point is ephemeral awareness state: it decays, leaves no history entry, and is never persisted.
- All prototype visuals are deliberately unstyled/neutral (grayscale, default-ish). Amber does not exist here.

---

## 1. Test scenarios

Eight scenarios, S1–S8. Each is run as a short directed task (see the protocol for how they pack into sessions).

| # | Scenario | Setup | What it isolates |
|---|---|---|---|
| S1 | Same viewport | Both users already looking at the same ~40-line region; sender directs attention to a specific expression within it | Whether Point adds anything when selection is already visible — the strongest case for H0 |
| S2 | Recipient scrolled elsewhere | Recipient is parked ~300 lines away on a reading task; sender directs attention to a specific range | The strongest case for H1 — off-screen indicator + jump vs. "scroll up… no, more… line 214" |
| S3 | Range edited during signal | Sender points at a range; a scripted edit modifies text inside the range before the recipient arrives | Whether the target follows the text (relative position) or dangles; the arrival experience |
| S4 | Range deleted | As S3, but the pointed-at text is deleted entirely before arrival | Failure honesty: what should a dead Point do? (Behavior informs the design answer; the prototype may just let it vanish — record recipient confusion) |
| S5 | Repeated Points | Sender must direct attention to four targets in quick succession (~15s apart) | Repeated-signal annoyance, signal blur, whether recipients start ignoring it (alarm fatigue) |
| S6 | Three-person | Third participant (observer-confederate acceptable) joins; sender Points | Degradation check only: who receives it, is it ambiguous who it was "for," does the two-person calm survive — *not* a feature test; brief scope is two people |
| S7 | Reduced motion | Recipient's client runs the reduced-motion treatment (static indicator, no animated transitions); repeat S2 | Whether the static form is still noticeable and the jump still orienting — accessibility gate |
| S8 | Keyboard-only recipient | Recipient's pointing device is removed; repeat S2 and one jump+Back cycle | Whether jump and Back are genuinely operable without a pointer — accessibility gate from the brief's locked requirements |

S7 and S8 are **gates, not comparisons**: Point cannot pass the experiment overall if it fails either, regardless of speed wins.

---

## 2. Variants

Within-subject, using a **fixed baseline with partial counterbalancing of the two primary candidate interactions** — not a full Latin square. Concretely: Variant A always runs first as the baseline; Variants B and D are counterbalanced across pairs (their order alternates pair to pair); Variant C always runs last; roles swap halfway through each session. All variants run on the identical prototype document with voice open.

| Variant | Mechanic | Class |
|---|---|---|
| A — Selection only (control) | Ordinary remote cursor + selection, voice. No signal, no jump affordance. | Baseline |
| B — Selection-adjacent Point | The candidate as specified in the behavior envelope: select → explicit Point → calm target + off-screen indicator → recipient jump → explicit Back. | Sender-push |
| C — Gutter line ping | Sender clicks a line gutter to emit a one-line ping (no range precision, no selection prerequisite); same recipient indicator/jump/Back plumbing. | Sender-push, coarser |
| D — Avatar-click navigation | No sender signal at all. Recipient can click the collaborator's presence indicator to jump to *wherever their cursor/selection currently is*; explicit Back. Sender just selects and talks. | Receiver-pull |

Why D matters: jump-to-collaborator is **already locked into v1**. If A+D matches B on the measures, the product needs no new sender-side gesture — the locked feature suffices. D is the true bar Point must clear, not A alone.

C exists to test whether the *precision* of range-anchored pointing (B) earns its extra step over a one-click coarse ping.

The central comparison is these four: ordinary selection plus voice · selection-adjacent Point · gutter ping · jump-to-collaborator.

---

## 3. Measures

### Primary (quantitative)

| Measure | Definition | Collected |
|---|---|---|
| T-target: time to correct target | From the sender's signal-intent moment (utterance beginning "okay, look at—" or the Point/ping action, whichever is first) to the recipient's viewport containing the full target range **and** the recipient's verbal confirmation | Stopwatch + screen-recording timestamp |
| Verbal correction count | Number of discrete location-coordination moves after the initial reference: line numbers read aloud, "above/below/left," "the other one," "do you see it," re-descriptions | Tally against codebook |
| Wrong-scroll events | Recipient scrolls the wrong direction or overshoots past the target and reverses | Tally from recording |
| Accidental signals | Point/ping fired unintentionally (sender says "oops" or debrief confirms) | Tally |
| Back usage | After each jump: did the recipient use Back, scroll manually back, or never return? | Tally per jump |

### Secondary (behavioral/qualitative)

| Measure | How |
|---|---|
| Repeated-signal annoyance | S5 observation (sighs, "okay okay," delayed responses, ignoring the 4th signal) + debrief item rated 1–5 |
| Discovery | In the undirected phase, does the sender find and use Point/ping without instruction? Prototype affordances are placeholder, so treat discovery as *directional* evidence only — it can support but not sink Point |
| Sufficiency of control | Debrief: "In which tasks would plain selection + talking have been enough?" + observer's own log of A-variant tasks completed without friction |
| Preference & trust | Debrief ranking of A/B/C/D per scenario type (same-screen vs. far-away), with "why" verbatims |
| S3/S4 integrity | Recipient confusion on arrival at edited/deleted targets: none / momentary / task-breaking |

**Sample:** minimum 4 pairs (8 participants), target 6 pairs; roles swap halfway in every session so every participant sends and receives. Small-N is accepted — the thresholds below are effect-size and consistency based, not significance based.

---

## 4. Success threshold — recommend adding Point to v1

Meeting this threshold produces a *recommendation* to add Point to v1, not an automatic scope change (see the recommendation rule before the decision mapping). Point is **recommended for v1** only if **all** of the following hold:

1. **Far-target speed:** In S2-type tasks, median T-target for B is at least **30% lower** than A *and* at least **20% lower** than D, consistent across at least ¾ of pairs.
2. **Coordination cost:** Median verbal corrections in S2-type tasks for B is **≤1** where A's median is **≥2**.
3. **No same-screen penalty:** In S1, B is no slower than A and produces no observed annoyance — Point must be *neutral* when it is not needed.
4. **Repeat tolerance:** S5 annoyance ratings average **≤2/5** and no participant begins ignoring signals by the fourth Point.
5. **Accident rate:** ≤1 accidental signal across the whole study, or accidents are all attributable to placeholder-affordance jank (observer judgment, recorded).
6. **Gates pass:** S7 (reduced motion still noticeable and orienting) and S8 (keyboard-only jump + Back fully operable) both pass outright.
7. **Beats the coarse alternative:** B outperforms C on T-target *or* participants prefer B's precision in debrief by a clear majority. If gutter ping matches or outperforms Point, Point does not pass. Any proposal to add gutter ping requires separate product review and explicit canonical approval; it is not adopted by this experiment.

## 5. Rejection threshold — recommend rejecting Point

Meeting this threshold produces a *recommendation* to reject Point, not an automatic change to the brief. Point is **recommended for rejection** (not merely deferral) if **any** of the following hold:

1. **Redundancy:** In S2-type tasks, A+voice or D achieves median T-target within **15%** of B — the locked jump feature plus talking is already sufficient.
2. **Annoyance:** S5 average annoyance **≥3.5/5**, or ≥2 recipients visibly start ignoring signals.
3. **Same-screen harm:** B measurably slows or irritates S1 tasks (any consistent penalty vs. A).
4. **Integrity failure:** S3/S4 arrival confusion is rated task-breaking by ≥2 recipients and no cheap behavioral fix is evident from observation.
5. **Preference inversion:** A majority of participants rank A or D above B for the far-away scenario despite any speed win — perceived value overrules a marginal stopwatch delta.

**Between the thresholds → defer** (see decision mapping).

---

## 6. Prototype fidelity — the smallest honest rig

> The experiment evaluates interaction behavior, not transport, persistence, synchronization architecture, or production data modeling. No transport, sync, or storage choice made for the prototype implies anything about production.

**Must be real:**
- Two (occasionally three) genuinely separate clients on separate machines over a real network — latency and sync artifacts are part of what is being tested.
- Genuinely synchronized editing across the separate clients: when one types, the others see it live, so S3/S4 (concurrent edits against a live Point) are authentic. The synchronization method is unconstrained.
- Real independent scrolling and viewports: each client scrolls on its own, in one seeded, realistic code file of ~500 lines — long enough that S2 distances are honest.
- Genuinely ephemeral Point state: it decays, is never written to the document or any history, and leaves no persisted trace.
- Real reduced-motion variant and real keyboard operability for jump/Back.
- Voice: an ordinary call (any tool) — real, not simulated.

**May be mocked / cheap:**
- All visuals: grayscale placeholder styling; default cursors with plain name labels; the Point target may be a simple outline; the off-screen indicator a plain edge arrow. Deliberately no Amber, no design polish — polish here would contaminate both the measures and the later design phase.
- Identity: hardcoded names/colors per client. No identity persistence.
- Document: one hardcoded seeded file; no titles, no language picker, no share flow, no draft lifecycle.
- Point decay time: a hardcoded constant (start ~4s visible + fade; a prototype knob — observers may adjust between pairs and must log the value used).
- Back: a plain on-screen button + keyboard shortcut restoring the pre-jump scroll position. Single-slot memory is fine.
- Transport and sync mechanism: any convenient method that achieves genuine live sync is acceptable. Any specific choice — including a CRDT such as Yjs, Yjs awareness as the carrier for the ephemeral Point state, a WebSocket relay, or a local disposable relay on a spare port — is **an optional disposable-prototype convenience chosen for speed; it provides no evidence for production architecture.**

**Must not touch production architecture:**
- Lives in a throwaway directory or scratch branch (e.g. `experiments/point-probe/` on a disposable branch) — **zero imports from or into `src/`**, no edits to `server/index.mjs`, `room.ts`, snapshots, or any production path.
- If it uses a relay or server at all, that runs as its own throwaway instance (e.g. on a spare port), entirely separate from `server/index.mjs` — a convenience, not an architecture decision, and no evidence for one.
- Is deleted or archived after the decision; nothing from it is "promoted" by copy-paste, and no prototype implementation may be promoted into production by default. Findings travel as a report, code does not.
- Per repo rules, building even this rig requires an explicitly approved task before any code is written; this brief is the specification for that approval, not the authorization.

---

## 7. Test script — paired call protocol (18 minutes)

Participants: P1 + P2 on a voice call, separate machines. Observer present (third client where needed, otherwise watching screenshare/recordings). Roles: **Sender** (has a secret target card) and **Receiver**. Roles swap at the midpoint. Variant order follows the fixed-baseline design: A first, B and D counterbalanced per pair, C last.

The seeded file contains 10 pre-chosen target tokens (distinct function names / constants / bugs), each with a card: *"Bring your partner's attention to `<token>` in the `<region>` section. Don't read the line number aloud unless you have to."* Receiver confirms arrival by reading the token's adjacent value aloud.

| Time | Phase | Protocol |
|---|---|---|
| 0:00–2:00 | 1. Setup & consent | Both clients open, call live, recording on. Script: "You'll help each other find things in a shared file while talking normally. Work as fast as feels natural. Nothing you do can break anything." No mention of Point. |
| 2:00–3:30 | 2. Warm-up | Both scroll the file freely; each makes one trivial edit; confirm both see each other's cursors. Observer confirms sync + latency acceptable. |
| 3:30–6:30 | 3. Block 1 — Variant A (control), always first | Task A1 = S1 (same viewport): observer directs both to the same region, sender gets card 1. Task A2 = S2 (receiver parked far away via a reading decoy), card 2. Task A3 = S2 again, card 3. Time each; tally corrections and wrong-scrolls. |
| 6:30–7:00 | 4. Reveal | Observer: "There's now an extra action available when you have text selected. Try whatever you find." (30s undirected — the discovery probe. Log whether the sender finds it unaided.) |
| 7:00–10:30 | 5. Block 2 — Variant B or D (counterbalanced) | Same task structure: one S1 card, two S2 cards. For B, additionally run S5: four rapid-fire cards ~15s apart. For D, receiver is told the presence indicator is clickable. |
| 10:30–11:00 | 6. Role swap | Sender and Receiver switch. New target cards (5–10). |
| 11:00–14:30 | 7. Block 3 — the other of B/D, then C | One S1 + one S2 card on the remaining push/pull variant; then two S2 cards on C (gutter ping). During the final B-or-C card, observer triggers S3 (scripted edit inside the target) and on the last card S4 (deletion). |
| 14:30–15:30 | 8. Gates | S7: switch receiver client to reduced-motion, one S2 card. S8: receiver goes keyboard-only, one S2 card including a full jump + Back cycle. (S6 three-person: run for two designated pairs only, +2 min, observer joins as third client and receives/ignores a Point.) |
| 15:30–18:00 | 9. Debrief | Structured items: (1) rank A/B/C/D for "partner far away" and for "both looking at the same thing," with why; (2) annoyance rating 1–5 for the rapid-fire block; (3) "In which tasks would selecting + talking have been enough?"; (4) "What did you expect Back to do? Did it?"; (5) S3/S4 recipients: "What did you think happened?"; (6) anything that felt like noise. |

---

## 8. Observation sheet

One row per task card; header block per session.

```
SESSION ____  PAIR ____  DATE ____  VARIANT ORDER ____  POINT DECAY SETTING ____
P1 ____ (role 1st half: S/R)   P2 ____   MACHINES/NETWORK NOTES ____

┌────┬──────┬────────┬──────────┬─────────┬─────────┬────────┬────────┬───────────────┐
│Card│Scen. │Variant │ T-target │ Verbal  │ Wrong-  │ Accid. │ Back   │ Notes         │
│ #  │S1–S8 │A/B/C/D │  (m:ss)  │ corr. # │ scrolls │ signal │ used?  │ (verbatims,   │
│    │      │        │          │         │    #    │  Y/N   │ Y/N/n-a│  confusion,   │
│    │      │        │          │         │         │        │        │  ignoring)    │
├────┼──────┼────────┼──────────┼─────────┼─────────┼────────┼────────┼───────────────┤
└────┴──────┴────────┴──────────┴─────────┴─────────┴────────┴────────┴───────────────┘

VERBAL-CORRECTION CODEBOOK (count each discrete move after the initial reference):
  L = line number spoken     D = direction word ("above/below/further")
  R = re-description of target   C = confirmation request ("see it?")
  N = negation ("no, not that one")

DISCOVERY (phase 4):  found unaided? Y/N   time-to-first-use ____   what they tried first ____
S5 RAPID-FIRE: signals acknowledged 1☐ 2☐ 3☐ 4☐   visible annoyance? ____
S3 arrival: target tracked text? Y/N  recipient confusion: none/momentary/task-breaking
S4 arrival: what recipient saw ____  confusion: none/momentary/task-breaking
S7 reduced-motion: indicator noticed? Y/N  orientation after jump: fine/lost
S8 keyboard-only: jump reachable? Y/N  Back reachable? Y/N  friction notes ____
DEBRIEF: far-away ranking ____  same-screen ranking ____  annoyance /5 ____
        "selection was enough for…" ____  Back expectation met? Y/N  quotes ____
```

---

## 9. Decision mapping

> **Every experiment outcome is a recommendation.** No result changes v1 scope or becomes canonical until `docs/PRODUCT_BRIEF.md` is explicitly reviewed and updated. The rows below describe what the experiment *recommends*, not what it enacts.

Evaluated after all pairs complete, against the success/rejection thresholds. Exactly one recommendation is recorded, with the evidence table attached.

| Outcome | Criteria | Recommendation |
|---|---|---|
| Recommend adding Point to v1 | All seven success conditions met, including both gates and the beat-C condition | The experiment recommends promoting Point from "experimental" to a v1 design task. This requires a separate `docs/PRODUCT_BRIEF.md` update before it changes scope. If that update is approved, the *behavioral* spec (range-anchored, calm single target, one off-screen indicator, ephemeral, jump + Back, decay ≈ the value that tested well, S3-tracking required, S4-vanish + honest microcopy) becomes the recommended input to design; visual treatment remains fully open for the design phase. |
| Defer Point | Neither success fully met nor rejection triggered — e.g. far-target wins are real but inconsistent across pairs; or B wins but C ties it; or gates pass only with fixes evident | Point stays on the brief's experimental list with the specific unresolved questions named (e.g. "retest B vs. C precision with a real affordance"). It does not ship in v1. A maximum of one follow-up probe is permitted before a forced recommend-add/recommend-reject call — no perpetual deferral. |
| Recommend rejecting Point | Any rejection condition triggered | The experiment recommends that Point does not pass and should leave the experimental list; this requires a separate `docs/PRODUCT_BRIEF.md` update to take effect. Record the behavior that performed best as the recommended attention mechanism (also subject to canonical review). If gutter ping (C) was the specific reason Point did not pass, record: "Point rejected; gutter ping merits separate evaluation" — gutter ping is **not** thereby approved or canonical and would require its own product review and explicit canonical approval. |
| Recommend retaining only jump-to-collaborator | The specific redundancy case: D (+voice) matches or beats B on T-target and corrections, and participants rank D ≥ B for far-away tasks | A constructive sub-case of a recommend-reject outcome: the evidence indicates the already-locked v1 jump feature is sufficient. The experiment recommends retaining only jump-to-collaborator (no canonical change needed, since jump is already in v1), and the evidence (arrival orientation, Back usage, S8 keyboard findings) feeds directly into designing *that* feature well. A useful outcome for the product, not a loss. |

**In every outcome:** the prototype is discarded; the findings memo (measures tables + debrief verbatims + the recommendation) is the sole artifact that survives, and it feeds the product brief's open-question ledger for explicit review. Back-behavior observations transfer to the locked jump/Back v1 feature regardless of Point's fate — that data is free either way.

---

## Interpretation limits

- This experiment is a **product decision aid, not a statistically powered study.** Its purpose is to inform a go/defer/reject judgment, not to establish a scientific result.
- The small-sample percentages and timing thresholds **guide judgment rather than establish significance.** With 4–6 pairs, a "30% faster" median is a decision signal, not a proven effect size.
- **Qualitative observations and repeated behavior across pairs matter alongside the medians.** A consistent annoyance pattern, a repeated confusion on arrival, or a unanimous debrief preference can outweigh a marginal stopwatch delta in either direction.
- **A simpler pilot may be run before the full protocol** — for example, one or two pairs on S1/S2 with variants A and B only, to shake out the rig and the target cards before committing to the full sessions (A first, B/D counterbalanced, C last). A smaller first probe may also be derived after visual-direction synthesis, once a ground stance exists to prototype against.
