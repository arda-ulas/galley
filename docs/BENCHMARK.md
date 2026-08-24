# Inbound-path benchmark — pre-M5 baseline

**Status: the approved pre-M5 baseline.** Produced by M4.5 T3
(`docs/IMPLEMENTATION_PLAN.md` §5.3). Every budget and every redesign trigger
below is quoted from that section; none was invented here, relaxed here, or
added here.

**This is not a production performance claim.** It is a single-process,
single-machine measurement of synchronous CPU cost on a developer laptop with
other work running, taken so that the same measurement can be repeated after M5
and compared. It says nothing about hosted latency, network behaviour, SQLite
throughput, or concurrent-room load.

**The question this baseline exists to answer later:** after M5 lands, does
canonical persistence capture plus deletion-aware coverage materially worsen the
synchronous event-loop cost of the inbound path? See
[Comparison protocol](#comparison-protocol-for-m5).

---

## Running it

```bash
npm run bench
```

| Flag | Effect |
|---|---|
| *(none)* | full matrix, human-readable tables — the only form that is a baseline |
| `--json` | the same result as machine-readable JSON on stdout, for diffing runs |
| `--cases=B,D` | subset; the harness labels the run `PARTIAL RUN — not a baseline` |

One full run takes roughly two minutes. Node prints an
`ExperimentalWarning: SQLite` line to **stderr** on startup, because the harness
imports the live `server/app.mjs`; `--json` output on stdout is unaffected.

Harness: [`bench/preflight.mjs`](../bench/preflight.mjs), harness version **1.0.0**.

## What is actually measured

Every timed operation is a real repository call or a real Yjs call:

| Measured | Source | Real or transcribed |
|---|---|---|
| `preflightSyncUpdate` | `server/app.mjs` | **real** — imported, not copied |
| `canonicalizeSubmission` | `server/yjs.mjs` | **real** |
| size envelopes | `server/limits.mjs` | **real** |
| `Y.encodeStateAsUpdate` · `Y.applyUpdate` · `Y.snapshot` · `Y.encodeSnapshot` · `Y.decodeSnapshot` · `Y.mergeDeleteSets` · `Y.equalDeleteSets` | `yjs 13.6.31` | **real** |
| §6.4.2 synchronous capture block | plan §6.4.2 | transcribed — M5 has not built it |
| §6.4.3 `covers()` predicate | plan §6.4.3 | transcribed — M5 has not built it |

`preflightSyncUpdate` is exported from `server/app.mjs` solely as this
measurement seam. It is pure with respect to the room document: everything it
touches lives on a probe document destroyed before it returns.

**Outside every timed section:** document construction, update generation,
statistics, and reporting. No network, no SQLite, no filesystem, no WebSocket
framing. Client fan-out is excluded — a 26-byte update encode is roughly three
orders of magnitude below the preflight it accompanies — and socket I/O is
excluded because it is not event-loop-blocking CPU.

## Determinism

- Documents are built from a fixed seed (`20260824`) with a mulberry32 PRNG.
- Yjs `clientID`s are pinned. They are pinned **above 2²⁸**, so each encodes to
  five varint bytes — the width of ~94% of real random uint32 client ids.
  Pinning to a small id would have shrunk case E's canonical state from 195,029
  to 149,335 bytes, a 23% optimistic bias, and would have moved case F off the
  512 KiB envelope it exists to probe.
- The document matrix is byte-identical across runs; so are all update sizes.
- Each measured loop discards a warm-up (5% of iterations, floor 5, cap 50) and
  then times each call individually with `process.hrtime.bigint()`.

---

## Environment

| Field | Value |
|---|---|
| Date | **2026-08-24** (runs at 19:11, 19:13, 19:15 UTC) |
| Commit | `e57c17b` (`reconstruction/collab-first`, T4 complete, T3 working tree) |
| Node | v22.22.2 (repo-pinned; `.nvmrc`, `engines` `>=22.22.2 <23`) |
| V8 | 12.4.254.21-node.39 |
| yjs | **13.6.31** (pinned) |
| OS / arch | darwin 25.4.0 / arm64 |
| CPU | Apple M1, 8 logical cores |
| Memory | 16 GiB |
| Load average at each run | 4.78 / 6.05 / 3.92 (1-minute) |
| Visible ceiling | 250,000 UTF-16 code units (`MAX_VISIBLE_CONTENT_CODE_UNITS`) |
| Canonical ceiling | 524,288 B = 512 KiB (`MAX_CANONICAL_STATE_BYTES`) |

The machine was **not** quiesced. Load averages are recorded because they are the
context a later comparison run has to be read against.

## Scenario parameters

### Document matrix (§5.3)

| Case | Plan definition | Visible (UTF-16) | Structs | Canonical B | % of 512 KiB cap | Snapshot B | Delete ranges | Deleted units |
|---|---|---|---|---|---|---|---|---|
| A | 2 KB contiguous paste | 2,000 | 1 | 2,021 | 0.4% | 9 | 0 | 0 |
| B | 10 KB contiguous paste — **the primary case** | 10,000 | 1 | 10,021 | 1.9% | 9 | 0 | 0 |
| C | 50 KB contiguous paste | 50,000 | 1 | 50,022 | 9.5% | 10 | 0 | 0 |
| D | 250 KB contiguous — the visible ceiling | 245,000 | 1 | 245,022 | 46.7% | 10 | 0 | 0 |
| E | 10 KB **fragmented** | 10,001 | 11,428 | 195,029 | 37.2% | 3,357 | 1,125 | 1,428 |
| F | 50 KB **fragmented**, approaching the canonical cap | 50,001 | 31,511 | 492,714 | **94.0%** | 7,554 | 2,078 | 2,187 |

Two construction decisions are worth stating, because both are departures from a
literal reading of §5.3 and both were forced by the enforced limits:

- **Case D is 245,000 code units, not 250,000.** At the literal ceiling every
  workload in the matrix is *rejected* by the visible-content limit, so the
  harness would be timing a throw rather than the work M5 must fit inside.
  245,000 is the largest document at which the whole matrix is accepted — it
  leaves room for exactly one 5 KB paste.
- **Case F is a contiguous base plus 17,500 scattered single-code-unit edits,
  not pure scattered construction.** Pure scattered construction at 50,000
  visible code units produces **~1.02 MB** of canonical state, nearly 2× the
  512 KiB ingress envelope. That document is **unreachable**: a room can never
  hold it, because ingress rejects every update that would carry it past the
  cap. Case F is therefore the *heaviest 50 KB document that can actually
  exist*, at 94% of the envelope.

Cases E and F both carry real deletion state (1,125 and 2,078 delete ranges), so
the deletion-aware watermark and the `covers()` predicate are measured against
non-empty delete sets, not insert-only documents.

### Workloads (§5.3)

| Workload | Bytes on the wire | Notes |
|---|---|---|
| single keystroke | 26–28 B | the plan's "~20–40 B"; captured from a client doc's own `update` event, exactly as y-websocket emits it |
| 5 KB paste | 5,026–5,028 B | one 5,000-code-unit insert |
| two clients at 8 updates/sec each | 16 inbound msg/s, 10 s, 160 messages | the plan's target case; drives the event-loop-lag measurement |

A state-vector *diff* was deliberately not used to generate the keystroke: a diff
additionally carries the whole delete set, which is 3.3–7.5 KB on a fragmented
document, and would not be a keystroke.

### Iteration counts

| Section | A–D | E, F |
|---|---|---|
| per-call latency | 1,000 | 200 |
| phase attribution | 500 | 100 |
| capture block | 1,000 | 200 |
| coverage | 2,000 | 500 |
| two-client workload | 160 messages over 10 s | 160 messages over 10 s |
| probe-doc leak check | 10,000 calls at case B | — |

---

## Measured baseline

The tables below are the **quietest of three consecutive full runs** on the
committed harness (2026-08-24T19:15:05Z, 1-minute load average 3.92). Cross-run
variance follows.

### 1. `preflightSyncUpdate` per call (ms)

| Case | Workload | update B | n | p50 | p95 | p99 | max | mean |
|---|---|---|---|---|---|---|---|---|
| A | keystroke | 26 | 1,000 | 0.126 | 0.192 | 0.460 | 2.996 | 0.148 |
| A | paste 5 KB | 5,026 | 1,000 | 0.148 | 0.520 | 1.161 | 2.360 | 0.201 |
| B | keystroke | 26 | 1,000 | 0.162 | **0.219** | 0.551 | 1.335 | 0.179 |
| B | paste 5 KB | 5,026 | 1,000 | 0.185 | 0.203 | 0.236 | 1.160 | 0.194 |
| C | keystroke | 28 | 1,000 | 0.135 | **0.170** | 0.563 | 0.704 | 0.147 |
| C | paste 5 KB | 5,028 | 1,000 | 0.165 | 0.176 | 0.584 | 0.628 | 0.174 |
| D | keystroke | 28 | 1,000 | 0.314 | **0.609** | 0.679 | 1.387 | 0.343 |
| D | paste 5 KB | 5,028 | 1,000 | 0.345 | 0.655 | 0.764 | 1.661 | 0.376 |
| E | keystroke | 26 | 200 | 16.229 | 31.056 | 105.775 | 111.389 | 19.202 |
| E | paste 5 KB | 5,026 | 200 | 14.805 | 16.253 | 19.714 | 27.074 | 15.038 |
| F | keystroke | 28 | 200 | 67.502 | 84.037 | 88.182 | 89.863 | 70.213 |
| F | paste 5 KB | 5,028 | 200 | 69.956 | 95.338 | 217.093 | 316.484 | 77.205 |

Budgets are judged on the **keystroke** workload, the primary inbound message.
The paste workload is within noise of it at every case, so the choice does not
change any verdict.

### 2. Phase attribution, keystroke workload (mean ms)

`preflightSyncUpdate` cannot be instrumented from outside without putting timers
into production, so phases are timed on a **mirror** of its body calling the same
real functions in the same order. The mirror's fidelity against the measured
whole call is reported; 0.73–1.04× here, so the attribution is describing the
real function.

| Case | `encodeStateAsUpdate(doc)` | probe alloc + `applyUpdate(probe, state)` | `applyUpdate(probe, update)` | re-encode probe + vector | `canonicalizeSubmission` | sum | whole call | fidelity |
|---|---|---|---|---|---|---|---|---|
| A | 0.009 | 0.043 | 0.000 | 0.011 | 0.056 | 0.119 | 0.148 | 0.80× |
| B | 0.010 | 0.040 | 0.006 | 0.037 | 0.081 | 0.174 | 0.179 | 0.97× |
| C | 0.023 | 0.042 | 0.003 | 0.016 | 0.070 | 0.153 | 0.147 | 1.04× |
| D | 0.050 | 0.086 | 0.001 | 0.045 | 0.136 | 0.317 | 0.343 | 0.93× |
| E | 1.423 | 3.674 | 0.007 | 1.417 | 7.523 | 14.044 | 19.202 | 0.73× |
| F | 4.319 | **23.226** | **0.135** | 4.406 | **36.219** | 68.306 | 70.213 | 0.97× |

### 3. M5 synchronous capture block, §6.4.2 (ms)

| Case | `encodeStateAsUpdate` | `Y.snapshot` | `Y.encodeSnapshot` | `toString()` | block p50 | block p95 | block max | encoded snapshot B |
|---|---|---|---|---|---|---|---|---|
| A | 0.009 | 0.000 | 0.001 | 0.000 | 0.009 | 0.011 | 0.031 | 9 |
| B | 0.009 | 0.000 | 0.001 | 0.000 | 0.007 | **0.010** | 0.277 | 9 |
| C | 0.015 | 0.000 | 0.001 | 0.000 | 0.015 | 0.024 | 0.319 | 10 |
| D | 0.053 | 0.000 | 0.001 | 0.000 | 0.046 | **0.078** | 0.287 | 10 |
| E | 1.545 | 0.038 | 0.026 | 0.121 | 1.549 | 1.898 | 3.805 | 3,357 |
| F | 4.736 | 0.103 | 0.047 | 0.484 | 5.370 | 8.160 | 31.133 | **7,554** |

Values at or below 0.001 ms sit at the timer floor and should be read as
"unmeasurably small", not as an exact figure. The block max at cases B and F
(0.277 and 31.133 ms) are garbage-collection outliers, not document costs — the
corresponding p95s are 0.010 and 8.160 ms.

### 4. Client coverage, §6.4.3 (ms)

`covers()` returns `true` at every case, which is the expensive path: a
`false` result short-circuits in the insertion loop and never reaches the
delete-set merge.

| Case | `covers()` mean | `covers()` p95 | full ack evaluation mean | ack p95 | ack max | watermark B |
|---|---|---|---|---|---|---|
| A | 0.000 | 0.001 | 0.001 | 0.001 | 0.233 | 9 |
| B | 0.000 | 0.000 | 0.001 | 0.001 | 0.035 | 9 |
| C | 0.000 | 0.000 | 0.000 | 0.000 | 0.023 | 10 |
| D | 0.000 | 0.000 | 0.001 | 0.000 | 0.326 | 10 |
| E | 0.061 | 0.080 | 0.112 | 0.134 | 0.427 | 3,357 |
| F | 0.107 | 0.119 | 0.271 | 0.416 | 1.459 | 7,554 |

"Full ack evaluation" is `Y.decodeSnapshot(watermark)` + `Y.snapshot(localDoc)` +
`covers(...)` — what the browser actually runs on each ack.

### 5. Two-client workload — 16 inbound msg/s for 10 s

| Case | msgs | rejected | target /s | achieved /s | lag min | lag p50 | lag p95 | lag p99 | lag max | per-msg p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 160 | 0 | 16 | 16.1 | 9.159 | 11.059 | 11.289 | 12.747 | 16.679 | 2.477 |
| B | 160 | 0 | 16 | 16.1 | 9.298 | 11.051 | 11.682 | 13.926 | 63.406 | 3.166 |
| C | 160 | 0 | 16 | 16.1 | 9.290 | 11.059 | **11.485** | 13.976 | 23.773 | 2.740 |
| D | 160 | 0 | 16 | 16.1 | 9.298 | 11.067 | 11.567 | 13.386 | 16.155 | 3.225 |
| E | 160 | 0 | 16 | 16.07 | 9.511 | 11.051 | 30.425 | 32.293 | 95.879 | 22.364 |
| F | 160 | 0 | 16 | **13.03** | 11.026 | 69.534 | 92.471 | 128.516 | 388.497 | 91.181 |

Lag figures are **raw**. The histogram samples on a 10 ms timer, so an idle loop
reports ~10 ms; reported lag therefore overstates true lag by roughly that floor,
which is the conservative direction against a "< 50 ms" budget. The `min` column
makes the floor visible. `p95` is the statistic read as "sustained", matching the
p95 convention the other §5.3 budgets use.

At the contiguous cases, per-message costs here run 5–16× the tight-loop figures
in table 1 (case C: 2.740 ms p95 here vs 0.170 ms there). That gap is real and
expected: 62.5 ms of idle between messages drops the working set out of cache and
lets GC run, which is what a live server actually experiences. At cases E and F
the two agree, because document work already dominates cache effects.
**For contiguous documents, table 1 is the lower bound and this table is closer
to the lived cost.**

### 6. Probe-doc leak check — 10,000 calls at case B

| Field | Value |
|---|---|
| Heap before (GC-settled) | 20,819,808 B |
| Heap after 10,000 calls (GC-settled) | 20,689,352 B |
| Delta | **−130,456 B** (−13.05 B/call) |
| Retaining one probe per call would cost | 100,210,000 B |
| Threshold (1% of that) | 1,002,100 B |
| Verdict | **PASS** |

All three runs measured a *negative* delta (−130,456 B, −146,392 B, −157,064 B):
the heap settled slightly below where it started, which is allocator noise, not
retention. §5.3 states no numeric tolerance for "returns to baseline", so the
harness applies a stated rule: pass if the post-GC delta is under 1% of what
retaining one probe document per call would cost. The measured magnitudes are
~0.15% of that floor, in the wrong direction for a leak.

### 7. Supplementary — encoded snapshot size vs scattered deletions

Not a §5.3 budget. It reproduces the revision-4 snapshot-size figures quoted in
the plan so the "≈105 KiB at the 512 KiB canonical cap" extrapolation is
checkable rather than remembered. The base is sized to land on the plan's cited
77,636-byte canonical document, and it does, exactly.

| Scattered deletions | Visible | Structs | Canonical B | Snapshot B | Snapshot % of canonical | Delete ranges |
|---|---|---|---|---|---|---|
| 0 | 77,614 | 1 | 77,636 | 10 | 0.0% | 0 |
| 10 | 77,604 | 21 | 77,875 | 54 | 0.1% | 10 |
| 100 | 77,514 | 201 | 79,965 | 395 | 0.5% | 100 |
| 1,000 | 76,614 | 1,979 | 99,945 | 3,760 | 3.8% | 989 |
| 5,000 | 72,614 | 9,347 | 181,894 | 17,742 | 9.8% | 4,673 |

The plan recorded 8 / 26 / 275 / 2,976 / 15,881 B for the same deletion counts.
This harness measures 10 / 54 / 395 / 3,760 / 17,742 B — the same shape and
order of magnitude, differing because the deletion positions come from a
different seed. The plan's "roughly 20% of canonical state under pathological
fragmentation" is an **upper** bound: the worst ratio observed here is 9.8%, and
the real matrix's most fragmented case (F, at 94% of the canonical cap) encodes
its snapshot at **1.5%** of canonical state.

### Cross-run variance (three consecutive full runs)

| Statistic | Run 1 (load 4.78) | Run 2 (load 6.05) | Run 3 (load 3.92) — recorded above |
|---|---|---|---|
| B keystroke p50 / p95 | 0.153 / 0.169 | 0.152 / 0.181 | 0.162 / 0.219 |
| C keystroke p50 / p95 | 0.143 / 0.269 | 0.141 / 0.225 | 0.135 / 0.170 |
| D keystroke p50 / p95 | 0.324 / 0.660 | 0.322 / 0.644 | 0.314 / 0.609 |
| E keystroke p50 / p95 | 14.766 / 16.910 | 14.886 / 20.246 | 16.229 / 31.056 |
| F keystroke p50 / p95 | 67.052 / 83.403 | 72.063 / 96.543 | 67.502 / 84.037 |
| C lag p95 | 11.575 | 11.567 | 11.485 |
| E lag p95 | 31.703 | 30.556 | 30.425 |
| F lag p95 / achieved msg/s | 90.374 / 13.42 | 86.704 / 13.98 | 92.471 / 13.03 |
| B capture block p95 | 0.009 | 0.008 | 0.010 |
| D capture block p95 | 0.086 | 0.068 | 0.078 |
| Verdict | PASS | PASS | PASS |

**p50 is the stable comparison statistic on this host** (≤ 7% spread at the
budgeted cases). p95/p99/max carry host noise — case E's p95 ranged 16.9–31.1 ms
across the three runs while its p50 moved 10%. The M5 comparison should weigh p50
and the phase attribution first. The budgets are nonetheless judged on p95 as
§5.3 specifies — they pass by 17–300×, far outside the observed noise.

---

## Budget verdicts

Every budget below is quoted verbatim from §5.3.

| # | Budget (§5.3) | Limit | Measured | Margin | Verdict |
|---|---|---|---|---|---|
| BUD-1 | p95 ≤ 5 ms at case B (10 KB contiguous) — the primary case | 5 ms | 0.219 ms | 23× | **PASS** |
| BUD-2 | p95 ≤ 25 ms at case D (250 KB, the enforced ceiling) | 25 ms | 0.609 ms | 41× | **PASS** |
| BUD-3 | Event-loop lag < 50 ms sustained under the 2-client workload at case C | 50 ms | 11.485 ms raw (~1.5 ms above the ~10 ms sampling floor) | ≥ 4× | **PASS** |
| BUD-4 | Synchronous capture block (state + snapshot + text) ≤ 3 ms at case B | 3 ms | 0.010 ms | 300× | **PASS** |
| BUD-5 | Synchronous capture block (state + snapshot + text) ≤ 20 ms at case D | 20 ms | 0.078 ms | 256× | **PASS** |
| BUD-6 | Encoded snapshot ≤ 128 KiB at **every** case | 131,072 B | 7,554 B (worst case, F) | 17× | **PASS** |

All six also passed in the other two runs; the harness prints the verdict table
itself, so it is not transcribed by hand.

## Redesign triggers

| # | Trigger (§5.3) | State |
|---|---|---|
| TRG-1 | p95 > 25 ms at case C | **not fired** (0.170 ms; 0.170–0.269 ms across three runs) |
| TRG-2 | Event-loop lag > 50 ms in the 2-client workload at case C | **not fired** (11.485 ms raw; 11.485–11.575 across three runs) |
| TRG-3 | Heap not returning to baseline | **not fired** |
| TRG-4 | M5's persist hook pushing the combined path past the lag ceiling | **N/A** — not evaluable before M5 |

**Verdict: PASS.** All six §5.3 budgets are met and no redesign trigger has
fired. Under §5.3's "optimize only on a trigger" rule, none of the three
documented redesign directions is authorized. This baseline authorizes M5 to
begin on the current inbound-path architecture.

---

## What the numbers say

**1. The §2.5 finding holds: cost tracks Yjs struct fragmentation, not character
count.** Across the contiguous cases, visible size grows 122× (2,000 → 245,000
code units) while per-call cost grows 2.5× (0.126 → 0.314 ms p50) — and all four
documents are one struct. Case E carries the *same* 10 KB of visible text as case
B and costs **100× more** (16.229 vs 0.162 ms p50) purely because it holds 11,428
structs instead of one. Struct count, not character count, is the cost driver.

**2. The O(update) part of the inbound path is free; everything else is
O(document).** In the phase attribution, `applyUpdate(probe, update)` — the only
term proportional to the incoming message — measures 0.000–0.135 ms at every
case, 0–3% of the call, including at case F. The remaining 97–100% is spent
re-deriving the whole document: at case F, `canonicalizeSubmission` (36.219 ms,
53% of attributed cost), seeding the probe from current state (23.226 ms, 34%),
encoding current state (4.319 ms, 6%), and re-encoding the probe (4.406 ms, 6%).
This is a direct, quantified confirmation of §5.3's redesign directions 1 and 2:
fusing the double canonicalization and holding a persistent per-room probe would
remove nearly all of the measured cost, because the part that must be done per
message is effectively free. **Neither is authorized now — no trigger fired.**

**3. The M5 durability capture is cheap, and the coverage watermark is small.**
The full §6.4.2 capture block costs 0.010 ms at case B and 0.078 ms at case D
against budgets of 3 ms and 20 ms — 300× and 256× of headroom. It is 4–15% of one
preflight call at every case, so M5's synchronous capture is not the term that
will decide the combined path; the preflight already dominates it by 7–23×.
`Y.snapshot` + `Y.encodeSnapshot` together are ≤ 0.15 ms even at case F. The
encoded watermark peaks at **7,554 B**, 5.8% of the 128 KiB budget, so §6.5's
broadcast-per-commit of the coverage frame is not a size concern at any
reachable document.

**4. The client coverage predicate is not a render-path risk.** A full ack
evaluation — decode watermark, snapshot the local doc, run `covers()` — costs
0.271 ms mean and 0.416 ms p95 at the worst reachable document, and is
unmeasurable on contiguous ones. §6.4.5's rule that coverage is recomputed only
on a fresh ack or a dirty re-evaluation, never per render, remains the right
constraint, but the per-evaluation cost is not what makes it necessary.

**5. DEF-7 is measurably reachable, and the cliff is nearer than "50k
characters" suggests.** Case F reaches **94% of the 512 KiB canonical envelope at
only 50,001 visible code units** — 20% of the visible ceiling — from 17,500
scattered single-character edits on top of a contiguous base. Pure scattered
construction at that same visible size would need ~1.02 MB, so it is not merely
near the cap but **structurally unreachable**: ingress would have rejected it
long before. A user who edits scatteredly can therefore brick a sheet at a fifth
of the advertised size limit, with no explanation and no recovery path. M4.5
measures this; §5.3 assigns surfacing it to **M5**.

## Measured but not gated

§5.3's budgets and triggers name cases B, C and D — all contiguous, all cheap —
plus the snapshot-size budget which does apply at every case. **No §5.3 budget or
trigger names case E or case F.** Their numbers are therefore reported here as
evidence, not as a verdict, and they are the numbers that matter most for M5:

| Case | Per-call p50 | 2-client lag p95 | Achieved throughput vs 16 msg/s target |
|---|---|---|---|
| E — 10 KB fragmented, 11,428 structs | 16.229 ms | 30.425 ms | 16.07 /s — keeps up |
| F — 50 KB fragmented, 31,511 structs, 94% of cap | 67.502 ms | 92.471 ms | **13.03 /s — falls behind** |

At case F the single Node thread cannot sustain two clients typing at 8 updates
per second: it delivers 13.0–14.0 of the 16 messages per second offered across
the three runs, and the observed event-loop lag (86.7–92.5 ms p95) is well past
the 50 ms point at which §5.3 states remote cursor motion stops reading as live.
This is a whole-server ceiling, not a per-room one — the work is synchronous
inside `ws.on('message')` and blocks every other room and every HTTP request.
Case E already shows the leading edge: 30.4–31.7 ms p95 lag, within the 50 ms
ceiling but not by much.

Nothing here is a §5.3 trigger, so nothing here authorizes work. It is recorded
because M5's own budget re-run (§7, AC-budget) will need it, and because the gap
between the gated cases and the reachable worst case is the single most useful
thing this baseline establishes.

---

## Comparison protocol for M5

To answer *"did canonical persistence capture and deletion-aware coverage
materially worsen the synchronous event-loop cost?"*, re-run `npm run bench` on
the same machine after M5 and compare against this document.

Preconditions for the comparison to be valid:

1. **Do not change** `SEED`, the `CASES` table, `PASTE_CODE_UNITS`, the pinned
   `CLIENT_ID_*` values, or the iteration counts. Any of those changes the
   measurement, not the result. If one must change, bump `HARNESS_VERSION` in
   `bench/preflight.mjs` and say so here — a version mismatch invalidates the
   comparison.
2. **Attach the real persister.** `applyInboundMessage()` in the harness is the
   extension point: once `livePersister` exists, attach it to the document there
   and the two-client workload measures the combined preflight + persist-hook
   cost, which is what TRG-4 is about.
3. **Swap the two transcriptions for the real implementations.**
   `captureCurrentState()` should become the real M5 export and `covers()` the
   real `src/` implementation. The surrounding measurement, budgets, and output
   shape do not change.
4. **Compare p50 first**, then the phase attribution, then p95. p95/p99/max on
   this host carry enough noise (see the variance table) that a p95 regression
   under ~2× is not evidence on its own.
5. **Record the load average** shown in the new run's header alongside the old
   ones. A comparison run at load 10 against a baseline run at load 4 is not a
   comparison.

## Limitations

- **One machine, one process, not quiesced.** An Apple M1 laptop under normal
  developer load (1-minute load averages 3.92–6.05 during the recorded runs).
  Absolute values will differ on the deployment host; the shape of the curve —
  flat in characters, steep in structs — should not.
- **No I/O in the measurement.** No SQLite write, no WebSocket frame, no
  network. The real inbound path also decodes a frame, checks size caps, and
  fans out to peers. Those are excluded deliberately (§5.3 budgets the
  synchronous Yjs work) and they are small relative to preflight, but they are
  not zero.
- **The capture block and `covers()` are transcriptions, not shipped code.** They
  are byte-for-byte the plan's §6.4.2 and §6.4.3 listings and use only public
  `yjs 13.6.31` exports, but if M5 implements them differently the pre-M5
  numbers for those two rows describe the plan, not the product.
- **Fan-out cost is not modelled.** With more than two clients the per-message
  encode is shared but the per-client `send` is not; this harness says nothing
  about that.
- **Tail statistics are noisy at cases E and F.** Across three runs two minutes
  apart, case E's per-call p95 ranged 16.9–31.1 ms while its p50 moved only 10%,
  and case F's p95 ranged 83.4–96.5 ms. Treat single-run tails at those cases as
  indicative only; p50 is the statistic that holds.
- **This is not a production performance claim.** Nothing here has been measured
  on the deployment host, under real network conditions, or with more than one
  room active.
