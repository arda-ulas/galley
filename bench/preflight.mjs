#!/usr/bin/env node
// ---------------------------------------------------------------------------
// M4.5 T3 — inbound-path benchmark harness.
// Contract: docs/IMPLEMENTATION_PLAN.md §5.3. Baseline record: docs/BENCHMARK.md.
//
// WHY THIS EXISTS
// The sync preflight is O(document) per inbound message, not O(update) (§2.5).
// M5 adds a synchronous durability capture (§6.4.2) and a client-side coverage
// predicate (§6.4.3) to that same path. This harness fixes the pre-M5 numbers so
// the M5 question — "did canonical persistence capture + deletion-aware coverage
// materially worsen the synchronous event-loop cost?" — has an answer instead of
// an opinion.
//
// WHAT IS MEASURED, AND ON WHAT
// Every timed operation is a REAL repository or real Yjs call:
//   * `preflightSyncUpdate` is imported from server/app.mjs — the live function
//     the WebSocket handler calls, not a copy.
//   * `canonicalizeSubmission` is imported from server/yjs.mjs.
//   * The size envelopes come from server/limits.mjs.
//   * The §6.4.2 capture block and the §6.4.3 `covers()` predicate are
//     transcribed VERBATIM from the plan. They are the only transcriptions here,
//     because M5 has not built them yet. See the M5 HANDOFF notes below.
//
// WHAT IS DELIBERATELY OUTSIDE THE TIMED SECTIONS
// Document construction, update generation, statistics, and all reporting. No
// network, no SQLite, no filesystem, no WebSocket framing, and no client
// fan-out is timed. Fan-out encoding is excluded because a 26-byte update
// encode is ~3 orders of magnitude below the preflight it accompanies; socket
// I/O is excluded because it is not event-loop-blocking CPU.
//
// M5 HANDOFF — how to keep this comparable without rewriting it
//   1. Do not change SEED, the CASES table, PASTE_CODE_UNITS, or the iteration
//      counts. Changing any of them invalidates comparison; bump HARNESS_VERSION
//      if you must, and say so in docs/BENCHMARK.md.
//   2. `applyInboundMessage()` is the extension point for the combined path.
//      Once `livePersister` exists, attach it to `doc` there and the two-client
//      workload measures preflight + persist hook together (§7 AC-budget).
//   3. Replace `captureCurrentState()` with the real M5 export and `covers()`
//      with the real `src/` implementation; the surrounding measurement,
//      budgets, and output shape stay as they are.
//
// USAGE
//   npm run bench                 full matrix, human-readable pipe tables
//   node bench/preflight.mjs      same
//   node bench/preflight.mjs --json          machine-readable, for diffing runs
//   node bench/preflight.mjs --cases=B,D     subset (NOT a baseline run)
// ---------------------------------------------------------------------------

import * as Y from "yjs";
import v8 from "node:v8";
import vm from "node:vm";
import os from "node:os";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { monitorEventLoopDelay } from "node:perf_hooks";

import { preflightSyncUpdate } from "../server/app.mjs";
import { canonicalizeSubmission } from "../server/yjs.mjs";
import {
  MAX_CANONICAL_STATE_BYTES,
  MAX_VISIBLE_CONTENT_CODE_UNITS,
} from "../server/limits.mjs";

// --- Fixed parameters. Changing any of these breaks comparability. ---------

const HARNESS_VERSION = "1.0.0";
const SEED = 20260824;
// Yjs assigns a RANDOM uint32 clientID per Y.Doc, and that id is varint-encoded
// into every struct reference in an update and in canonical state. Pinning it is
// what makes update sizes and canonical bytes byte-identical run to run.
//
// The pinned values are all above 2^28, so each encodes to FIVE varint bytes —
// the same width as ~94% of real random uint32 ids. Pinning to a small id (say
// 1_000_001, three bytes) would quietly shrink every fragmented document: case E
// measured 149,335 canonical bytes instead of 195,029, a 23% optimistic bias, and
// case F would no longer sit near the 512 KiB envelope it is defined to probe.
// Every id must also stay distinct: two docs sharing a clientID collide on clocks.
const CLIENT_ID_DOCUMENT = 3_141_592_653;
const CLIENT_ID_WORKLOAD = 2_718_281_828;
const CLIENT_ID_SUSTAINED = [1_618_033_988, 1_414_213_562];
const CLIENT_ID_DELETION_SERIES = 2_236_067_977;
const PASTE_CODE_UNITS = 5_000; // the §5.3 "5 KB paste" workload
const KEYSTROKE_CHAR = "Z"; // the §5.3 "single keystroke (~20-40 B)" workload

// §5.3 two-client workload: 8 updates/sec each = ~16 inbound messages/sec.
const SUSTAINED_MSGS_PER_SEC = 16;
const SUSTAINED_INTERVAL_MS = 1000 / SUSTAINED_MSGS_PER_SEC; // 62.5 ms
const SUSTAINED_DURATION_MS = 10_000;
// The event-loop-delay histogram samples on a `resolution`-ms timer, so an idle
// loop reports ~`resolution` ms. Raw values are reported unadjusted: that
// OVERSTATES true lag by roughly the resolution, which is the conservative
// direction against a "< 50 ms" budget. `min` is reported so the floor is visible.
const LAG_RESOLUTION_MS = 10;

// §5.3 probe-doc leak check.
const LEAK_ITERATIONS = 10_000;
const LEAK_CASE = "B";

// §5.3 revision-4 supplementary series: encoded snapshot size vs deletion count.
// The base is sized to reproduce the plan's cited 77,636-byte canonical document.
const DELETION_SERIES_BASE_CODE_UNITS = 77_614;
const DELETION_SERIES_COUNTS = [0, 10, 100, 1_000, 5_000];

/**
 * The §5.3 document matrix. `visible` is UTF-16 code units.
 *
 * Case D sits exactly one 5 KB paste below MAX_VISIBLE_CONTENT_CODE_UNITS
 * (250,000) rather than at it. At the literal ceiling every workload in the
 * matrix is REJECTED by the visible-content limit, so the harness would time a
 * throw instead of the work M5 has to fit inside. 245,000 is the largest
 * document at which the whole matrix is accepted.
 *
 * Case F is a contiguous base plus scattered single-code-unit edits, not pure
 * scattered construction. Pure scattered construction at 50,000 visible code
 * units produces ~1.02 MB of canonical state — nearly 2x the 512 KiB ingress
 * envelope — so that document is UNREACHABLE: the room could never hold it,
 * because ingress rejects every update that would take it past the cap. F is
 * therefore the heaviest 50 KB document that can actually exist in a room.
 */
const CASES = [
  { id: "A", title: "2 KB contiguous",   kind: "contiguous", base: 2_000,   scatter: 0,      latency: 1_000, phase: 500, capture: 1_000, coverage: 2_000 },
  { id: "B", title: "10 KB contiguous",  kind: "contiguous", base: 10_000,  scatter: 0,      latency: 1_000, phase: 500, capture: 1_000, coverage: 2_000 },
  { id: "C", title: "50 KB contiguous",  kind: "contiguous", base: 50_000,  scatter: 0,      latency: 1_000, phase: 500, capture: 1_000, coverage: 2_000 },
  { id: "D", title: "245 KB contiguous", kind: "contiguous", base: 245_000, scatter: 0,      latency: 1_000, phase: 500, capture: 1_000, coverage: 2_000 },
  { id: "E", title: "10 KB fragmented",  kind: "fragmented", base: 0,       scatter: 11_429, latency: 200,   phase: 100, capture: 200,   coverage: 500 },
  { id: "F", title: "50 KB fragmented",  kind: "fragmented", base: 34_688,  scatter: 17_500, latency: 200,   phase: 100, capture: 200,   coverage: 500 },
];

// One scattered delete per this many scattered inserts.
const SCATTER_DELETE_EVERY = 8;

const WARMUP_FRACTION = 0.05; // discarded iterations, floor of 5, cap of 50

/**
 * The §5.3 budgets, verbatim. Nothing here may be invented, relaxed, or added.
 * `evaluate` receives the whole result object and returns { value, unit, ok }.
 */
const BUDGETS = [
  {
    id: "BUD-1",
    statement: "p95 <= 5 ms per preflightSyncUpdate call at case B (10 KB contiguous)",
    limit: 5,
    unit: "ms",
    evaluate: (r) => r.latency.B?.keystroke?.p95,
  },
  {
    id: "BUD-2",
    statement: "p95 <= 25 ms per preflightSyncUpdate call at case D (250 KB ceiling)",
    limit: 25,
    unit: "ms",
    evaluate: (r) => r.latency.D?.keystroke?.p95,
  },
  {
    id: "BUD-3",
    statement: "event-loop lag < 50 ms sustained under the 2-client workload at case C",
    limit: 50,
    unit: "ms",
    evaluate: (r) => r.sustained.C?.lag?.p95,
  },
  {
    id: "BUD-4",
    statement: "synchronous capture block (state + snapshot + text) <= 3 ms at case B",
    limit: 3,
    unit: "ms",
    evaluate: (r) => r.capture.B?.block?.p95,
  },
  {
    id: "BUD-5",
    statement: "synchronous capture block (state + snapshot + text) <= 20 ms at case D",
    limit: 20,
    unit: "ms",
    evaluate: (r) => r.capture.D?.block?.p95,
  },
  {
    id: "BUD-6",
    statement: "encoded snapshot <= 128 KiB at EVERY case",
    limit: 128 * 1024,
    unit: "B",
    evaluate: (r) => Math.max(...Object.values(r.documents).map((d) => d.snapshotBytes)),
  },
];

/** The §5.3 redesign triggers, verbatim. A trigger firing is a plan-level event. */
const TRIGGERS = [
  { id: "TRG-1", statement: "p95 > 25 ms at case C", fired: (r) => (r.latency.C?.keystroke?.p95 ?? 0) > 25 },
  { id: "TRG-2", statement: "event-loop lag > 50 ms in the 2-client workload at case C", fired: (r) => (r.sustained.C?.lag?.p95 ?? 0) > 50 },
  { id: "TRG-3", statement: "heap not returning to baseline over 10k calls", fired: (r) => r.leak?.verdict === "FAIL" },
  // TRG-4 ("M5's persist hook pushing the combined path past the lag ceiling")
  // is not evaluable pre-M5 and is reported as N/A.
];

// --- Deterministic construction -------------------------------------------

/** mulberry32 — 32-bit seeded PRNG. Same seed, same document, every run. */
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build one matrix document the way the room builds one: a fresh Y.Doc with the
 * "content" root predeclared as Y.Text, exactly as server/app.mjs buildRoom()
 * does (default gc: true, matching production).
 */
function buildDocument({ base, scatter, deleteEvery = SCATTER_DELETE_EVERY, seed = SEED, clientId = CLIENT_ID_DOCUMENT }) {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  const text = doc.getText("content");
  if (base > 0) text.insert(0, "x".repeat(base));
  const rnd = mulberry32(seed);
  for (let i = 0; i < scatter; i++) {
    text.insert(Math.floor(rnd() * (text.length + 1)), String.fromCharCode(97 + (i % 26)));
    if (deleteEvery > 0 && i % deleteEvery === deleteEvery - 1 && text.length > 1) {
      text.delete(Math.floor(rnd() * (text.length - 1)), 1);
    }
  }
  return doc;
}

/** Struct count, canonical size, snapshot size, and delete-set shape. */
function describeDocument(doc) {
  const state = Y.encodeStateAsUpdate(doc);
  const { structs } = Y.decodeUpdate(state);
  const snap = Y.snapshot(doc);
  const encodedSnapshot = Y.encodeSnapshot(snap);
  let deleteRanges = 0;
  let deletedCodeUnits = 0;
  for (const [, ranges] of snap.ds.clients) {
    deleteRanges += ranges.length;
    for (const range of ranges) deletedCodeUnits += range.len;
  }
  return {
    visibleCodeUnits: doc.getText("content").toString().length,
    structs: structs.length,
    canonicalBytes: state.byteLength,
    snapshotBytes: encodedSnapshot.byteLength,
    deleteRanges,
    deletedCodeUnits,
    canonicalPercentOfCap: +((state.byteLength / MAX_CANONICAL_STATE_BYTES) * 100).toFixed(1),
  };
}

/**
 * Produce the exact bytes a live y-websocket client puts on the wire for one
 * edit: the incremental update emitted by the client doc's own `update` event,
 * NOT a state-vector diff. A diff would additionally carry the whole delete set
 * (thousands of bytes on a fragmented document) and would not be a keystroke.
 */
function liveClientUpdate(sourceDoc, mutate, clientId = CLIENT_ID_WORKLOAD) {
  const client = new Y.Doc();
  client.clientID = clientId;
  client.getText("content");
  Y.applyUpdate(client, Y.encodeStateAsUpdate(sourceDoc));
  let captured = null;
  const handler = (update) => { captured = update; };
  client.on("update", handler);
  mutate(client.getText("content"));
  client.off("update", handler);
  client.destroy();
  if (!captured) throw new Error("mutation produced no update");
  return captured;
}

const keystrokeAt = (text) => text.insert(Math.floor(text.length / 2), KEYSTROKE_CHAR);
const pasteAt = (text) => text.insert(Math.floor(text.length / 2), "p".repeat(PASTE_CODE_UNITS));

// --- Timing ----------------------------------------------------------------

const NS_PER_MS = 1e6;

/** Nearest-rank percentile over an already-sorted Float64Array of ms samples. */
function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(samplesMs) {
  const sorted = Float64Array.from(samplesMs).sort();
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    n: sorted.length,
    mean: round(sum / sorted.length),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]),
  };
}

const round = (ms) => (Number.isFinite(ms) ? +ms.toFixed(4) : ms);

/**
 * Time `fn` `iterations` times, one hrtime pair per call, after a discarded
 * warm-up. Setup is the caller's job and is never inside the loop.
 */
function measure(fn, iterations) {
  const warmup = Math.min(50, Math.max(5, Math.round(iterations * WARMUP_FRACTION)));
  for (let i = 0; i < warmup; i++) fn();
  const samples = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples[i] = Number(process.hrtime.bigint() - t0) / NS_PER_MS;
  }
  return summarize(samples);
}

// --- The M5 surfaces, transcribed from the plan ----------------------------

/**
 * §6.4.2 synchronous capture block, verbatim. M5 runs this inside `livePersister`
 * on every persist attempt, with no await between any two lines.
 */
function captureCurrentState(doc) {
  // ─── SYNCHRONOUS CAPTURE BLOCK — no await, no I/O, no yield ───
  const state = Y.encodeStateAsUpdate(doc);
  const snap = Y.snapshot(doc);
  const coverage = Y.encodeSnapshot(snap);
  const text = doc.getText("content").toString();
  // ──────────────────────────────────────────────────────────────
  return { state, snap, coverage, text };
}

/** §6.4.3 client coverage predicate, verbatim. Runs in the browser on every ack. */
function covers(committed, local) {
  for (const [clientId, clock] of local.sv) {
    if ((committed.sv.get(clientId) ?? 0) < clock) return false;
  }
  return Y.equalDeleteSets(Y.mergeDeleteSets([committed.ds, local.ds]), committed.ds);
}

/**
 * The inbound message path as applyWsSyncMessage runs it, minus decode framing
 * and fan-out. M5 EXTENSION POINT: once `livePersister` exists, attach it to
 * `doc` before calling this so the two-client workload measures the combined
 * preflight + persist-hook cost (§7 AC-budget).
 */
function applyInboundMessage(doc, update, origin) {
  preflightSyncUpdate(doc, update);
  Y.applyUpdate(doc, update, origin);
}

// --- Sections ---------------------------------------------------------------

function sectionDocuments(cases) {
  const documents = {};
  const built = new Map();
  for (const spec of cases) {
    const doc = buildDocument(spec);
    built.set(spec.id, doc);
    documents[spec.id] = { title: spec.title, ...describeDocument(doc) };
  }
  return { documents, built };
}

function sectionLatency(cases, built) {
  const latency = {};
  for (const spec of cases) {
    const doc = built.get(spec.id);
    const workloads = {
      keystroke: liveClientUpdate(doc, keystrokeAt),
      paste5k: liveClientUpdate(doc, pasteAt),
    };
    latency[spec.id] = {};
    for (const [name, update] of Object.entries(workloads)) {
      // Prove the call is ACCEPTED before timing it: a rejected update would
      // time the throw path, not the work.
      let accepted = true;
      let rejection = null;
      try {
        preflightSyncUpdate(doc, update);
      } catch (err) {
        accepted = false;
        rejection = err?.message ?? String(err);
      }
      if (!accepted) {
        latency[spec.id][name] = { updateBytes: update.byteLength, rejected: true, rejection };
        continue;
      }
      latency[spec.id][name] = {
        updateBytes: update.byteLength,
        rejected: false,
        ...measure(() => preflightSyncUpdate(doc, update), spec.latency),
      };
    }
  }
  return latency;
}

/**
 * Phase attribution. `preflightSyncUpdate` cannot be instrumented from outside
 * without adding timers to production, so the phases are timed on a MIRROR of
 * its body that calls the same real functions in the same order. The mirror's
 * fidelity is then checked against the measured whole-call mean; a ratio far
 * from 1.0 means the attribution below is not describing the real function.
 */
function sectionPhases(cases, built, latency) {
  const phases = {};
  for (const spec of cases) {
    const doc = built.get(spec.id);
    const update = liveClientUpdate(doc, keystrokeAt);
    const iters = spec.phase;

    // Phase 1: encodeStateAsUpdate(doc)
    const encodeState = measure(() => Y.encodeStateAsUpdate(doc), iters);
    const currentState = Y.encodeStateAsUpdate(doc);

    // Phase 2 (+ probe allocation): new Y.Doc + getText + applyUpdate(probe, currentState)
    const probeSeed = measure(() => {
      const probe = new Y.Doc();
      probe.getText("content");
      Y.applyUpdate(probe, currentState);
      probe.destroy();
    }, iters);

    // Phase 3: applyUpdate(probe, update). It can only run on a freshly seeded
    // probe (applying the same update twice is a no-op), so it is measured as a
    // composite and the phase-2 mean is subtracted out.
    const seedPlusDelta = measure(() => {
      const probe = new Y.Doc();
      probe.getText("content");
      Y.applyUpdate(probe, currentState);
      Y.applyUpdate(probe, update);
      probe.destroy();
    }, iters);
    const applyDeltaMean = Math.max(0, seedPlusDelta.mean - probeSeed.mean);

    // Phase 4: canonicalizeSubmission on the merged probe state (the real call).
    const merged = new Y.Doc();
    merged.getText("content");
    Y.applyUpdate(merged, currentState);
    Y.applyUpdate(merged, update);
    const mergedState = Y.encodeStateAsUpdate(merged);
    const mergedVector = Y.encodeStateVector(merged);
    const canonicalize = measure(
      () => canonicalizeSubmission(mergedState, mergedVector, {
        maxVisibleContentCodeUnits: MAX_VISIBLE_CONTENT_CODE_UNITS,
        maxCanonicalStateBytes: MAX_CANONICAL_STATE_BYTES,
      }),
      iters,
    );
    // The probe's own re-encode feeding phase 4 (encodeStateAsUpdate(probe) +
    // encodeStateVector(probe)) is the second and third full document pass.
    const probeReencode = measure(() => {
      Y.encodeStateAsUpdate(merged);
      Y.encodeStateVector(merged);
    }, iters);
    merged.destroy();

    const attributed =
      encodeState.mean + probeSeed.mean + applyDeltaMean + probeReencode.mean + canonicalize.mean;
    const whole = latency[spec.id]?.keystroke?.mean ?? NaN;

    phases[spec.id] = {
      encodeStateAsUpdate_doc: encodeState,
      probeAlloc_applyUpdate_currentState: probeSeed,
      applyUpdate_update: { mean: round(applyDeltaMean), derived: "composite minus probe seed" },
      encodeStateAsUpdate_probe_plus_vector: probeReencode,
      canonicalizeSubmission: canonicalize,
      attributedTotalMean: round(attributed),
      measuredWholeCallMean: round(whole),
      fidelity: round(attributed / whole),
    };
  }
  return phases;
}

function sectionCapture(cases, built) {
  const capture = {};
  for (const spec of cases) {
    const doc = built.get(spec.id);
    const iters = spec.capture;
    const snapForEncode = Y.snapshot(doc);
    capture[spec.id] = {
      encodeStateAsUpdate: measure(() => Y.encodeStateAsUpdate(doc), iters),
      snapshot: measure(() => Y.snapshot(doc), iters),
      encodeSnapshot: measure(() => Y.encodeSnapshot(snapForEncode), iters),
      textToString: measure(() => doc.getText("content").toString(), iters),
      block: measure(() => captureCurrentState(doc), iters),
      encodedSnapshotBytes: Y.encodeSnapshot(snapForEncode).byteLength,
    };
  }
  return capture;
}

function sectionCoverage(cases, built) {
  const coverage = {};
  for (const spec of cases) {
    const doc = built.get(spec.id);
    const iters = spec.coverage;
    const committedSnapshot = Y.snapshot(doc);
    const committedBytes = Y.encodeSnapshot(committedSnapshot);
    const localSnapshot = Y.snapshot(doc);
    // A covered document is the expensive path: an uncovered one short-circuits
    // in the insertion loop and never reaches the delete-set merge.
    const result = covers(Y.decodeSnapshot(committedBytes), localSnapshot);
    coverage[spec.id] = {
      coversResult: result,
      coversOnly: measure(() => covers(committedSnapshot, localSnapshot), iters),
      ackEvaluation: measure(
        () => covers(Y.decodeSnapshot(committedBytes), Y.snapshot(doc)),
        iters,
      ),
      committedSnapshotBytes: committedBytes.byteLength,
    };
  }
  return coverage;
}

/**
 * The §5.3 target workload: two clients at 8 updates/sec each. Every update is
 * pre-generated before the histogram is enabled, so client-doc cloning is never
 * inside the measured window. The pump is saturating: if a message takes longer
 * than the 62.5 ms slot, the next one runs immediately and the achieved rate
 * falls — which is exactly what a single-threaded server does.
 */
async function sectionSustained(cases, built) {
  const sustained = {};
  const targetMessages = Math.ceil(SUSTAINED_DURATION_MS / SUSTAINED_INTERVAL_MS);

  for (const spec of cases) {
    // Fresh doc: this workload MUTATES the room document.
    const doc = buildDocument(spec);
    const originA = { client: "A" };
    const originB = { client: "B" };

    // Two independent clients, each unaware of the other's edits — the real
    // concurrent-editing shape, and causally applicable in any order.
    const clients = [originA, originB].map((origin, idx) => {
      const cdoc = new Y.Doc();
      cdoc.clientID = CLIENT_ID_SUSTAINED[idx];
      cdoc.getText("content");
      Y.applyUpdate(cdoc, Y.encodeStateAsUpdate(doc));
      return { origin, doc: cdoc };
    });
    // Pre-generated so that cloning a client doc — several ms on a fragmented
    // document — never lands inside the measured window.
    const messages = [];
    for (let i = 0; i < targetMessages; i++) {
      const client = clients[i % 2];
      const text = client.doc.getText("content");
      let captured = null;
      const handler = (update) => { captured = update; };
      client.doc.on("update", handler);
      text.insert(Math.floor(text.length / 2), KEYSTROKE_CHAR);
      client.doc.off("update", handler);
      messages.push({ update: captured, origin: client.origin });
    }

    const histogram = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS });
    const perMessage = new Float64Array(targetMessages);
    let delivered = 0;
    let rejected = 0;
    let rejection = null;

    await new Promise((resolve) => setTimeout(resolve, 25)); // let the loop settle
    histogram.enable();
    const startedAt = process.hrtime.bigint();

    await new Promise((resolve) => {
      const tick = () => {
        const msg = messages[delivered];
        const t0 = process.hrtime.bigint();
        try {
          applyInboundMessage(doc, msg.update, msg.origin);
        } catch (err) {
          rejected++;
          if (!rejection) rejection = err?.message ?? String(err);
        }
        perMessage[delivered] = Number(process.hrtime.bigint() - t0) / NS_PER_MS;
        delivered++;
        if (delivered >= targetMessages) return resolve();
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / NS_PER_MS;
        const nextDueMs = delivered * SUSTAINED_INTERVAL_MS;
        setTimeout(tick, Math.max(0, nextDueMs - elapsedMs));
      };
      setTimeout(tick, SUSTAINED_INTERVAL_MS);
    });

    histogram.disable();
    const wallMs = Number(process.hrtime.bigint() - startedAt) / NS_PER_MS;

    sustained[spec.id] = {
      targetMessages,
      deliveredMessages: delivered,
      rejectedMessages: rejected,
      rejection,
      targetRatePerSec: SUSTAINED_MSGS_PER_SEC,
      achievedRatePerSec: +((delivered / wallMs) * 1000).toFixed(2),
      wallMs: +wallMs.toFixed(1),
      perMessage: summarize(perMessage.subarray(0, delivered)),
      lag: {
        samples: histogram.count,
        min: round(histogram.min / NS_PER_MS),
        mean: round(histogram.mean / NS_PER_MS),
        p50: round(histogram.percentile(50) / NS_PER_MS),
        p95: round(histogram.percentile(95) / NS_PER_MS),
        p99: round(histogram.percentile(99) / NS_PER_MS),
        max: round(histogram.max / NS_PER_MS),
        idleFloorMs: LAG_RESOLUTION_MS,
      },
      documentAfter: describeDocument(doc),
    };
    doc.destroy();
  }
  return sustained;
}

/** §5.3 probe-doc leak check: heap delta over 10k calls, back to baseline after GC. */
function sectionLeak(built, documents) {
  const forceGc = resolveGc();
  const spec = CASES.find((c) => c.id === LEAK_CASE);
  const doc = built.get(LEAK_CASE);
  if (!forceGc || !doc) {
    return { skipped: true, reason: forceGc ? `case ${LEAK_CASE} not selected` : "gc unavailable" };
  }
  const update = liveClientUpdate(doc, keystrokeAt);
  for (let i = 0; i < 200; i++) preflightSyncUpdate(doc, update); // warm

  forceGc(); forceGc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < LEAK_ITERATIONS; i++) preflightSyncUpdate(doc, update);
  forceGc(); forceGc();
  const after = process.memoryUsage().heapUsed;

  const deltaBytes = after - before;
  // If every call retained its probe, the floor cost would be one canonical
  // document per call. PASS means the delta is under 1% of that floor.
  const fullLeakFloor = LEAK_ITERATIONS * documents[LEAK_CASE].canonicalBytes;
  const threshold = fullLeakFloor * 0.01;
  return {
    skipped: false,
    case: LEAK_CASE,
    caseTitle: spec.title,
    iterations: LEAK_ITERATIONS,
    heapBeforeBytes: before,
    heapAfterBytes: after,
    deltaBytes,
    deltaBytesPerCall: +(deltaBytes / LEAK_ITERATIONS).toFixed(2),
    retainedProbeFloorBytes: fullLeakFloor,
    thresholdBytes: Math.round(threshold),
    rule: "PASS if post-GC heap delta < 1% of the cost of retaining one probe document per call",
    verdict: deltaBytes < threshold ? "PASS" : "FAIL",
  };
}

/** Supplementary: encoded snapshot size vs scattered-deletion count (§5.3 rev-4). */
function sectionDeletionSeries() {
  const rows = [];
  for (const count of DELETION_SERIES_COUNTS) {
    const doc = new Y.Doc();
    doc.clientID = CLIENT_ID_DELETION_SERIES;
    const text = doc.getText("content");
    text.insert(0, "y".repeat(DELETION_SERIES_BASE_CODE_UNITS));
    const rnd = mulberry32(SEED);
    for (let i = 0; i < count; i++) text.delete(Math.floor(rnd() * (text.length - 1)), 1);
    rows.push({ deletions: count, ...describeDocument(doc) });
    doc.destroy();
  }
  return rows;
}

// --- Environment ------------------------------------------------------------

function resolveGc() {
  if (typeof globalThis.gc === "function") return globalThis.gc;
  try {
    v8.setFlagsFromString("--expose-gc");
    const fn = vm.runInNewContext("gc");
    v8.setFlagsFromString("--no-expose-gc");
    return typeof fn === "function" ? fn : null;
  } catch {
    return null;
  }
}

function readEnvironment() {
  let yjsVersion = "unknown";
  try {
    yjsVersion = JSON.parse(
      readFileSync(new URL("../node_modules/yjs/package.json", import.meta.url), "utf8"),
    ).version;
  } catch { /* not installed from this location */ }
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch { /* not a git checkout */ }
  const cpus = os.cpus();
  return {
    harnessVersion: HARNESS_VERSION,
    runAtUtc: new Date().toISOString(),
    node: process.version,
    v8: process.versions.v8,
    platform: `${process.platform} ${os.release()}`,
    arch: process.arch,
    cpu: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    totalMemoryGiB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    // Recorded because this is a developer workstation, not an isolated
    // benchmark host: it is the context a later run has to be compared against.
    loadAverage: os.loadavg().map((v) => +v.toFixed(2)),
    yjs: yjsVersion,
    commit,
    seed: SEED,
    maxVisibleContentCodeUnits: MAX_VISIBLE_CONTENT_CODE_UNITS,
    maxCanonicalStateBytes: MAX_CANONICAL_STATE_BYTES,
  };
}

// --- Reporting --------------------------------------------------------------

const table = (headers, rows) => {
  const all = [headers, ...rows].map((r) => r.map((c) => String(c)));
  const widths = headers.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
  return [
    line(all[0]),
    `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`,
    ...all.slice(1).map(line),
  ].join("\n");
};

const ms = (v) => (Number.isFinite(v) ? v.toFixed(3) : "n/a");
const int = (v) => (Number.isFinite(v) ? v.toLocaleString("en-US") : "n/a");

function report(result) {
  const out = [];
  const env = result.environment;
  out.push("=".repeat(78));
  out.push("GALLEY INBOUND-PATH BENCHMARK — PRE-M5 BASELINE");
  out.push("docs/IMPLEMENTATION_PLAN.md §5.3 · harness v" + env.harnessVersion);
  out.push("=".repeat(78));
  out.push("");
  out.push(
    table(
      ["field", "value"],
      [
        ["run (UTC)", env.runAtUtc],
        ["commit", env.commit],
        ["node", env.node],
        ["v8", env.v8],
        ["yjs", env.yjs],
        ["platform", `${env.platform} / ${env.arch}`],
        ["cpu", `${env.cpu} (${env.cpuCount} logical)`],
        ["memory", `${env.totalMemoryGiB} GiB`],
        ["load average (1/5/15m)", env.loadAverage.join(" / ")],
        ["seed", env.seed],
        ["visible ceiling", `${int(env.maxVisibleContentCodeUnits)} UTF-16 code units`],
        ["canonical ceiling", `${int(env.maxCanonicalStateBytes)} B (512 KiB)`],
      ],
    ),
  );

  out.push("", "-- 1. DOCUMENT MATRIX " + "-".repeat(56), "");
  out.push(
    table(
      ["case", "document", "visible", "structs", "canonical B", "% of cap", "snapshot B", "del ranges", "deleted"],
      Object.entries(result.documents).map(([id, d]) => [
        id, d.title, int(d.visibleCodeUnits), int(d.structs), int(d.canonicalBytes),
        `${d.canonicalPercentOfCap}%`, int(d.snapshotBytes), int(d.deleteRanges), int(d.deletedCodeUnits),
      ]),
    ),
  );

  out.push("", "-- 2. preflightSyncUpdate PER CALL (ms) " + "-".repeat(39), "");
  const latencyRows = [];
  for (const [id, workloads] of Object.entries(result.latency)) {
    for (const [name, s] of Object.entries(workloads)) {
      latencyRows.push(
        s.rejected
          ? [id, name, int(s.updateBytes), "-", "REJECTED", s.rejection, "-", "-", "-"]
          : [id, name, int(s.updateBytes), int(s.n), ms(s.p50), ms(s.p95), ms(s.p99), ms(s.max), ms(s.mean)],
      );
    }
  }
  out.push(table(["case", "workload", "update B", "n", "p50", "p95", "p99", "max", "mean"], latencyRows));

  out.push("", "-- 3. PHASE ATTRIBUTION, keystroke workload (mean ms) " + "-".repeat(25), "");
  out.push(
    table(
      ["case", "encodeState(doc)", "probe+apply(state)", "apply(update)", "reencode(probe)", "canonicalize", "sum", "whole call", "fidelity"],
      Object.entries(result.phases).map(([id, p]) => [
        id,
        ms(p.encodeStateAsUpdate_doc.mean),
        ms(p.probeAlloc_applyUpdate_currentState.mean),
        ms(p.applyUpdate_update.mean),
        ms(p.encodeStateAsUpdate_probe_plus_vector.mean),
        ms(p.canonicalizeSubmission.mean),
        ms(p.attributedTotalMean),
        ms(p.measuredWholeCallMean),
        Number.isFinite(p.fidelity) ? p.fidelity.toFixed(2) + "x" : "n/a",
      ]),
    ),
  );

  out.push("", "-- 4. M5 SYNCHRONOUS CAPTURE BLOCK §6.4.2 (ms) " + "-".repeat(32), "");
  out.push(
    table(
      ["case", "encodeState", "snapshot", "encodeSnapshot", "toString", "block p50", "block p95", "block max", "snapshot B"],
      Object.entries(result.capture).map(([id, c]) => [
        id, ms(c.encodeStateAsUpdate.mean), ms(c.snapshot.mean), ms(c.encodeSnapshot.mean),
        ms(c.textToString.mean), ms(c.block.p50), ms(c.block.p95), ms(c.block.max), int(c.encodedSnapshotBytes),
      ]),
    ),
  );

  out.push("", "-- 5. CLIENT COVERAGE §6.4.3 (ms) " + "-".repeat(45), "");
  out.push(
    table(
      ["case", "covers()", "covers() p95", "ack eval", "ack eval p95", "ack eval max", "covered", "watermark B"],
      Object.entries(result.coverage).map(([id, c]) => [
        id, ms(c.coversOnly.mean), ms(c.coversOnly.p95), ms(c.ackEvaluation.mean),
        ms(c.ackEvaluation.p95), ms(c.ackEvaluation.max), String(c.coversResult), int(c.committedSnapshotBytes),
      ]),
    ),
  );

  out.push("", `-- 6. TWO-CLIENT WORKLOAD, ${SUSTAINED_MSGS_PER_SEC} msg/s for ${SUSTAINED_DURATION_MS / 1000}s ` + "-".repeat(26), "");
  out.push(
    table(
      ["case", "msgs", "rejected", "target/s", "achieved/s", "lag min", "lag p50", "lag p95", "lag p99", "lag max", "per-msg p95"],
      Object.entries(result.sustained).map(([id, s]) => [
        id, int(s.deliveredMessages), int(s.rejectedMessages), s.targetRatePerSec, s.achievedRatePerSec,
        ms(s.lag.min), ms(s.lag.p50), ms(s.lag.p95), ms(s.lag.p99), ms(s.lag.max), ms(s.perMessage.p95),
      ]),
    ),
  );
  out.push("", `   lag values are RAW: an idle loop reports ~${LAG_RESOLUTION_MS} ms on a ${LAG_RESOLUTION_MS} ms sampling timer,`);
  out.push("   so reported lag overstates true lag by roughly that floor (the conservative direction).");

  out.push("", "-- 7. PROBE-DOC LEAK CHECK " + "-".repeat(52), "");
  if (result.leak.skipped) {
    out.push(`   skipped: ${result.leak.reason}`);
  } else {
    out.push(
      table(
        ["field", "value"],
        [
          ["case", `${result.leak.case} (${result.leak.caseTitle})`],
          ["iterations", int(result.leak.iterations)],
          ["heap before GC-settled", `${int(result.leak.heapBeforeBytes)} B`],
          ["heap after GC-settled", `${int(result.leak.heapAfterBytes)} B`],
          ["delta", `${int(result.leak.deltaBytes)} B (${result.leak.deltaBytesPerCall} B/call)`],
          ["retained-probe floor", `${int(result.leak.retainedProbeFloorBytes)} B`],
          ["threshold (1% of floor)", `${int(result.leak.thresholdBytes)} B`],
          ["verdict", result.leak.verdict],
        ],
      ),
    );
  }

  out.push("", "-- 8. SUPPLEMENTARY: snapshot size vs scattered deletions " + "-".repeat(21), "");
  out.push(
    table(
      ["deletions", "visible", "structs", "canonical B", "snapshot B", "snapshot % of canonical", "del ranges"],
      result.deletionSeries.map((r) => [
        int(r.deletions), int(r.visibleCodeUnits), int(r.structs), int(r.canonicalBytes),
        int(r.snapshotBytes), ((r.snapshotBytes / r.canonicalBytes) * 100).toFixed(1) + "%", int(r.deleteRanges),
      ]),
    ),
  );

  out.push("", "-- 9. BUDGETS (§5.3, verbatim) " + "-".repeat(48), "");
  out.push(
    table(
      ["id", "budget", "limit", "measured", "verdict"],
      result.budgets.map((b) => [
        b.id, b.statement, `${b.limit} ${b.unit}`,
        b.measured == null ? "n/a" : `${b.unit === "B" ? int(b.measured) : ms(b.measured)} ${b.unit}`,
        b.verdict,
      ]),
    ),
  );

  out.push("", "-- 10. REDESIGN TRIGGERS (§5.3, verbatim) " + "-".repeat(37), "");
  out.push(
    table(
      ["id", "trigger", "state"],
      [
        ...result.triggers.map((t) => [t.id, t.statement, t.fired ? "FIRED" : "not fired"]),
        ["TRG-4", "M5's persist hook pushing the combined path past the lag ceiling", "N/A pre-M5"],
      ],
    ),
  );

  out.push("", "=".repeat(78));
  out.push(`VERDICT: ${result.verdict}`);
  out.push("=".repeat(78));
  return out.join("\n");
}

// --- Main -------------------------------------------------------------------

function parseArgs(argv) {
  const args = { json: false, cases: CASES.map((c) => c.id) };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg.startsWith("--cases=")) {
      args.cases = arg.slice("--cases=".length).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    } else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  const known = new Set(CASES.map((c) => c.id));
  for (const id of args.cases) if (!known.has(id)) throw new Error(`unknown case: ${id}`);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: node bench/preflight.mjs [--json] [--cases=A,B,C,D,E,F]");
    return;
  }
  const selected = CASES.filter((c) => args.cases.includes(c.id));
  const partial = selected.length !== CASES.length;

  const environment = readEnvironment();
  const { documents, built } = sectionDocuments(selected);
  const latency = sectionLatency(selected, built);
  const phases = sectionPhases(selected, built, latency);
  const capture = sectionCapture(selected, built);
  const coverage = sectionCoverage(selected, built);
  const sustained = await sectionSustained(selected, built);
  const leak = sectionLeak(built, documents);
  const deletionSeries = sectionDeletionSeries();

  const result = {
    environment, partial, documents, latency, phases, capture, coverage,
    sustained, leak, deletionSeries,
  };

  result.budgets = BUDGETS.map((b) => {
    const measured = b.evaluate(result);
    const verdict = !Number.isFinite(measured) ? "N/A" : measured <= b.limit ? "PASS" : "FAIL";
    return { id: b.id, statement: b.statement, limit: b.limit, unit: b.unit, measured: Number.isFinite(measured) ? measured : null, verdict };
  });
  result.triggers = TRIGGERS.map((t) => ({ id: t.id, statement: t.statement, fired: t.fired(result) }));

  const failed = result.budgets.filter((b) => b.verdict === "FAIL");
  const fired = result.triggers.filter((t) => t.fired);
  result.verdict = partial
    ? "PARTIAL RUN — not a baseline"
    : failed.length === 0 && fired.length === 0
      ? "PASS — all §5.3 budgets met, no redesign trigger fired"
      : `FAIL — budgets: ${failed.map((b) => b.id).join(", ") || "none"}; triggers: ${fired.map((t) => t.id).join(", ") || "none"}`;

  console.log(args.json ? JSON.stringify(result, null, 2) : report(result));
  for (const doc of built.values()) doc.destroy();
}

await main();
