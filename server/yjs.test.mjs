import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import {
  canonicalizeSubmission,
  decodeStateVectorStrict,
  YjsValidationError,
} from "./yjs.mjs";
// DEF-9: the limits are asserted against their single declaration site.
import {
  MAX_CANONICAL_STATE_BYTES,
  MAX_VISIBLE_CONTENT_CODE_UNITS,
} from "./limits.mjs";

/** Encode a submission (update + matching vector) from a mutated Y.Doc. */
function submission(mutate) {
  const doc = new Y.Doc();
  if (mutate) mutate(doc);
  const update = Y.encodeStateAsUpdate(doc);
  const vector = Y.encodeStateVector(doc);
  doc.destroy();
  return { update, vector };
}

/** Reconstruct the "content" text from an encoded update. */
function decodeContent(update) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const text = doc.getText("content").toString();
  doc.destroy();
  return text;
}

/** The state vector of a brand-new empty doc — never matches a non-empty one. */
function emptyVector() {
  const doc = new Y.Doc();
  const v = Y.encodeStateVector(doc);
  doc.destroy();
  return v;
}

/** Hand-encode a state vector from [client, clock] entries (order preserved). */
function encodeVector(entries) {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, entries.length);
  for (const [client, clock] of entries) {
    encoding.writeVarUint(e, client);
    encoding.writeVarUint(e, clock);
  }
  return encoding.toUint8Array(e);
}

describe("canonicalizeSubmission — exported limits", () => {
  it("exposes the approved limits", () => {
    expect(MAX_VISIBLE_CONTENT_CODE_UNITS).toBe(250_000);
    expect(MAX_CANONICAL_STATE_BYTES).toBe(512 * 1024);
  });
});

describe("canonicalizeSubmission — accepted plain-text content model", () => {
  it("accepts an empty document and round-trips to empty content", () => {
    const { update, vector } = submission();
    const { canonicalUpdate, canonicalStateVector } = canonicalizeSubmission(
      update,
      vector,
    );
    expect(canonicalUpdate).toBeInstanceOf(Uint8Array);
    expect(canonicalStateVector).toBeInstanceOf(Uint8Array);
    expect(decodeContent(canonicalUpdate)).toBe("");
  });

  it("accepts inserted Y.Text and round-trips it exactly", () => {
    const { update, vector } = submission((d) =>
      d.getText("content").insert(0, "retry-logic goes here"),
    );
    const { canonicalUpdate } = canonicalizeSubmission(update, vector);
    expect(decodeContent(canonicalUpdate)).toBe("retry-logic goes here");
  });

  it("accepts deleted-text state (deletions + remaining text)", () => {
    const { update, vector } = submission((d) => {
      const t = d.getText("content");
      t.insert(0, "hello");
      t.delete(0, 2);
    });
    const { canonicalUpdate } = canonicalizeSubmission(update, vector);
    expect(decodeContent(canonicalUpdate)).toBe("llo");
  });

  it("persists only server-computed bytes (canonical vector matches the doc)", () => {
    const { update, vector } = submission((d) =>
      d.getText("content").insert(0, "abc"),
    );
    const { canonicalUpdate, canonicalStateVector } = canonicalizeSubmission(
      update,
      vector,
    );
    const doc = new Y.Doc();
    Y.applyUpdate(doc, canonicalUpdate);
    const expected = Y.encodeStateVector(doc);
    doc.destroy();
    expect([...canonicalStateVector]).toEqual([...expected]);
  });

  it("accepts a top-level plain Y.XmlText (wire-equivalent to plain text)", () => {
    // A top-level Y.XmlText with only string content emits the same
    // ContentString structs as plain Y.Text — there is no discriminator — so it
    // is accepted and canonicalized through the server-owned Y.Text.
    const doc = new Y.Doc();
    doc.get("content", Y.XmlText).insert(0, "plain xml text");
    const update = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    doc.destroy();
    const { canonicalUpdate } = canonicalizeSubmission(update, vector);
    expect(decodeContent(canonicalUpdate)).toBe("plain xml text");
  });

  it("accepts a multi-client merged plain-text state and reconstructs it", () => {
    // Two independent clients edit the same content; their updates merge into a
    // valid multi-client plain-text state. This guards the struct allowlist
    // against rejecting legitimate collaborative edits.
    const d1 = new Y.Doc();
    d1.getText("content").insert(0, "hello ");
    const d2 = new Y.Doc();
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    d2.getText("content").insert(6, "world");
    const update = Y.encodeStateAsUpdate(d2);
    const vector = Y.encodeStateVector(d2);
    d1.destroy();
    d2.destroy();

    const { canonicalUpdate, canonicalStateVector } = canonicalizeSubmission(
      update,
      vector,
    );
    expect(decodeContent(canonicalUpdate)).toBe("hello world");

    // The canonical vector strictly decodes and matches the reconstructed doc.
    const rec = new Y.Doc();
    Y.applyUpdate(rec, canonicalUpdate);
    const recVector = decodeStateVectorStrict(Y.encodeStateVector(rec));
    rec.destroy();
    const canVector = decodeStateVectorStrict(canonicalStateVector);
    expect(canVector.size).toBe(2); // two distinct clients
    expect([...canVector.entries()].sort()).toEqual(
      [...recVector.entries()].sort(),
    );
  });
});

describe("canonicalizeSubmission — rejected content models", () => {
  it("rejects a Y.Map root", () => {
    const { update, vector } = submission((d) => d.getMap("content").set("k", "v"));
    expect(() => canonicalizeSubmission(update, vector)).toThrow(/map content/i);
  });

  it("rejects a Y.Array root", () => {
    const { update, vector } = submission((d) =>
      d.getArray("content").insert(0, ["a"]),
    );
    expect(() => canonicalizeSubmission(update, vector)).toThrow(
      /unsupported content/i,
    );
  });

  it("rejects a Y.XmlFragment/XmlElement root", () => {
    const { update, vector } = submission((d) => {
      const f = d.getXmlFragment("content");
      f.insert(0, [new Y.XmlElement("b")]);
    });
    expect(() => canonicalizeSubmission(update, vector)).toThrow(
      /unsupported content/i,
    );
  });

  it("rejects a text embed", () => {
    const { update, vector } = submission((d) =>
      d.getText("content").insertEmbed(0, { image: "x" }),
    );
    expect(() => canonicalizeSubmission(update, vector)).toThrow(
      /unsupported content/i,
    );
  });

  it("rejects text formatting attributes", () => {
    const { update, vector } = submission((d) =>
      d.getText("content").insert(0, "hi", { bold: true }),
    );
    expect(() => canonicalizeSubmission(update, vector)).toThrow(
      /unsupported content/i,
    );
  });

  it("rejects any shared root other than content", () => {
    const { update, vector } = submission((d) => {
      d.getText("content").insert(0, "x");
      d.getText("other").insert(0, "y");
    });
    expect(() => canonicalizeSubmission(update, vector)).toThrow(
      /unexpected root/i,
    );
  });

  it("rejects a malformed (undecodable) update", () => {
    const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(() => canonicalizeSubmission(garbage, emptyVector())).toThrow(
      /could not be decoded/i,
    );
  });

  it("rejects a non-binary update or vector", () => {
    expect(() => canonicalizeSubmission("nope", emptyVector())).toThrow(
      /must be binary/i,
    );
    const { update } = submission();
    expect(() => canonicalizeSubmission(update, "nope")).toThrow(
      /must be binary/i,
    );
  });
});

describe("canonicalizeSubmission — size limits", () => {
  it("accepts content exactly at the visible-content limit", () => {
    const { update, vector } = submission((d) =>
      d.getText("content").insert(0, "aaaaaaaaaa"),
    );
    expect(() =>
      canonicalizeSubmission(update, vector, { maxVisibleContentCodeUnits: 10 }),
    ).not.toThrow();
  });

  it("rejects content over the visible-content limit", () => {
    const { update, vector } = submission((d) =>
      d.getText("content").insert(0, "aaaaaaaaaaa"),
    );
    expect(() =>
      canonicalizeSubmission(update, vector, { maxVisibleContentCodeUnits: 10 }),
    ).toThrow(/content exceeds the size limit/i);
  });

  it("rejects a canonical state over the byte limit", () => {
    const { update, vector } = submission((d) =>
      d.getText("content").insert(0, "hello world"),
    );
    expect(() =>
      canonicalizeSubmission(update, vector, { maxCanonicalStateBytes: 8 }),
    ).toThrow(/state exceeds the size limit/i);
  });
});

describe("canonicalizeSubmission — state-vector agreement", () => {
  it("accepts a vector that matches the submitted update", () => {
    const { update, vector } = submission((d) =>
      d.getText("content").insert(0, "match me"),
    );
    expect(() => canonicalizeSubmission(update, vector)).not.toThrow();
  });

  it("rejects a vector that does not match the submitted update", () => {
    const { update } = submission((d) =>
      d.getText("content").insert(0, "content present"),
    );
    expect(() => canonicalizeSubmission(update, emptyVector())).toThrow(
      /does not match/i,
    );
  });
});

describe("decodeStateVectorStrict — strict parsing", () => {
  it("accepts a valid vector", () => {
    const map = decodeStateVectorStrict(encodeVector([[10, 3], [20, 5]]));
    expect(map.get(10)).toBe(3);
    expect(map.get(20)).toBe(5);
    expect(map.size).toBe(2);
  });

  it("accepts an empty vector", () => {
    expect(decodeStateVectorStrict(encodeVector([])).size).toBe(0);
  });

  it("is order-independent (reordered entries decode to the same map)", () => {
    const a = decodeStateVectorStrict(encodeVector([[10, 3], [20, 5]]));
    const b = decodeStateVectorStrict(encodeVector([[20, 5], [10, 3]]));
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("rejects a duplicate client id", () => {
    expect(() => decodeStateVectorStrict(encodeVector([[5, 1], [5, 2]]))).toThrow(
      /duplicate client id/i,
    );
  });

  it("rejects trailing bytes", () => {
    const bytes = new Uint8Array([...encodeVector([[5, 1]]), 0x00]);
    expect(() => decodeStateVectorStrict(bytes)).toThrow(/trailing bytes/i);
  });

  it("rejects a truncated varint", () => {
    const full = encodeVector([[5, 1]]);
    expect(() => decodeStateVectorStrict(full.slice(0, full.length - 1))).toThrow(
      /truncated|malformed/i,
    );
  });

  it("rejects an overflow (non-safe-integer) entry", () => {
    // count=1, client = a 9-byte varint (> 2^53), clock = 0.
    const bytes = new Uint8Array([
      0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f, 0x00,
    ]);
    // lib0 rejects the oversized varint; the strict parser surfaces it as a
    // typed YjsValidationError (message class: malformed/truncated/invalid).
    expect(() => decodeStateVectorStrict(bytes)).toThrow(YjsValidationError);
    expect(() => decodeStateVectorStrict(bytes)).toThrow(
      /invalid entry|malformed|truncated/i,
    );
  });

  it("rejects a non-binary vector", () => {
    expect(() => decodeStateVectorStrict("nope")).toThrow(/must be binary/i);
  });
});
