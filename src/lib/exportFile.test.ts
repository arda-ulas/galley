import { afterEach, describe, expect, it, vi } from "vitest";
import { LANGUAGES, type LanguageId } from "./languages";
import {
  FALLBACK_BASENAME,
  downloadFilename,
  downloadText,
  extensionForLanguage,
  sanitizeBasename,
} from "./exportFile";

/**
 * T5 unit coverage (M4.5 §5.5). Filename derivation, sanitization, and the
 * download mechanics — all pure client, no server, no persistence.
 */

describe("extensionForLanguage — one canonical extension per allowlisted language", () => {
  it.each([
    ["javascript", "js"],
    ["typescript", "ts"],
    ["python", "py"],
    ["plaintext", "txt"],
  ] as const)("maps %s → .%s", (language, ext) => {
    expect(extensionForLanguage(language)).toBe(ext);
  });

  it("covers every language the picker offers, with no empty extension", () => {
    // Guards the mapping against a language being added to LANGUAGES without an
    // extension being chosen for it.
    for (const { id } of LANGUAGES) {
      const ext = extensionForLanguage(id);
      expect(ext, `no extension for ${id}`).toBeTruthy();
      expect(ext).not.toContain(".");
    }
  });
});

describe("sanitizeBasename — a title can never escape the download folder", () => {
  it("flattens path separators rather than producing a traversal", () => {
    // Separators become dashes, then the leading dot/dash run is stripped, so
    // neither a traversal nor a leading-dash "option" name can come out.
    expect(sanitizeBasename("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeBasename("a/b")).toBe("a-b");
    expect(sanitizeBasename("a\\b")).toBe("a-b");
  });

  it("never yields a name containing a path separator", () => {
    for (const title of ["/", "//", "a/b/c", "C:\\Windows\\system32", "..", "../.."]) {
      const result = sanitizeBasename(title);
      expect(result, `separator survived in ${JSON.stringify(title)}`).not.toMatch(
        /[/\\]/,
      );
    }
  });

  it("drops control characters, including a NUL that would truncate the name", () => {
    expect(sanitizeBasename("we\u0000ird")).toBe("weird");
    expect(sanitizeBasename("a\u001Fb\u007Fc")).toBe("abc");
  });

  it("turns whitespace control characters into a space instead of dropping them", () => {
    // Dropping them would glue the words together and silently change the name.
    expect(sanitizeBasename("a\tb")).toBe("a b");
    expect(sanitizeBasename("a\u000Bb")).toBe("a b");
    expect(sanitizeBasename("a\rb")).toBe("a b");
  });

  it("drops C1 control characters, which used to survive the sweep entirely", () => {
    // The C0 range stops at U+001F and JavaScript's `\s` matches no C1
    // character, so before this the whole U+0080–U+009F block passed straight
    // through into the filename as raw control bytes.
    expect(sanitizeBasename("a\u009Bb")).toBe("ab"); // CSI — terminal control
    expect(sanitizeBasename("a\u0080b")).toBe("ab"); // PAD — first C1
    expect(sanitizeBasename("a\u009Fb")).toBe("ab"); // APC — last C1
    expect(sanitizeBasename("a\u0090b")).toBe("ab"); // DCS — mid-range
  });

  it("treats U+0085 NEL as a line break, not as a droppable control", () => {
    // NEL is a line terminator like LF, so it separates words rather than
    // gluing them — the same reason tab and newline become a space.
    expect(sanitizeBasename("line\u0085break")).toBe("line break");
    expect(sanitizeBasename("a\u0085b")).toBe("a b");
  });

  it("leaves no control character anywhere in the C0/DEL/C1 range in the result", () => {
    // Exhaustive: every control code point, one at a time, embedded in a title.
    const controls = [
      ...Array.from({ length: 0x20 }, (_, i) => i), // C0  U+0000–U+001F
      0x7f, // DEL
      ...Array.from({ length: 0x20 }, (_, i) => 0x80 + i), // C1  U+0080–U+009F
    ];
    const survivors: string[] = [];
    for (const cp of controls) {
      const result = sanitizeBasename(`a${String.fromCharCode(cp)}b`);
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001F\u007F-\u009F]/.test(result)) {
        survivors.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
      }
      // Whichever branch it took, the words must not have been glued together.
      expect(result === "ab" || result === "a b", `U+${cp.toString(16)} → ${result}`).toBe(
        true,
      );
    }
    expect(survivors).toEqual([]);
  });

  it("keeps NBSP working as ordinary whitespace (it is not C1)", () => {
    // U+00A0 sits just past the C1 block and IS matched by `\s`, so it collapses
    // through the whitespace rule rather than being dropped.
    expect(sanitizeBasename("a\u00A0b")).toBe("a b");
  });

  it("replaces characters Windows reserves so the file stays portable", () => {
    expect(sanitizeBasename('a<b>c:d"e|f?g*h')).toBe("a-b-c-d-e-f-g-h");
  });

  it("strips leading dots so a title cannot produce a hidden file", () => {
    expect(sanitizeBasename(".bashrc")).toBe("bashrc");
    expect(sanitizeBasename("...hidden")).toBe("hidden");
  });

  it("strips a leading dash, which most CLIs would read as an option", () => {
    expect(sanitizeBasename("-rf")).toBe("rf");
    expect(sanitizeBasename("/leading/slash")).toBe("leading-slash");
  });

  it("strips trailing dots and spaces, which Windows silently drops", () => {
    expect(sanitizeBasename("report.")).toBe("report");
    expect(sanitizeBasename("report   ")).toBe("report");
    expect(sanitizeBasename("report. . ")).toBe("report");
  });

  it("collapses whitespace runs and trims", () => {
    expect(sanitizeBasename("  my    sheet  ")).toBe("my sheet");
    expect(sanitizeBasename("line\nbreak")).toBe("line break");
  });

  it("falls back to untitled for an empty or whitespace-only title", () => {
    expect(sanitizeBasename("")).toBe(FALLBACK_BASENAME);
    expect(sanitizeBasename("   ")).toBe(FALLBACK_BASENAME);
    expect(sanitizeBasename("\n\t ")).toBe(FALLBACK_BASENAME);
  });

  it("falls back to untitled for a title that sanitizes away entirely", () => {
    // All control characters — nothing survives step 2.
    expect(sanitizeBasename("\u0000\u0001\u0002")).toBe(FALLBACK_BASENAME);
    // All-symbols: every character maps to a dash, leaving a legal but
    // meaningless name, so it is treated as no title at all.
    expect(sanitizeBasename("<>:|?*")).toBe(FALLBACK_BASENAME);
    expect(sanitizeBasename("///")).toBe(FALLBACK_BASENAME);
    // Only dots — stripped as leading, then nothing remains.
    expect(sanitizeBasename("...")).toBe(FALLBACK_BASENAME);
  });

  it("caps the basename length without leaving a trailing space", () => {
    const long = "x".repeat(500);
    expect(sanitizeBasename(long)).toHaveLength(120);
    // A cut landing on a space must not leave the name ending in one.
    const cutOnSpace = `${"y".repeat(119)} tail`;
    expect(sanitizeBasename(cutOnSpace)).toBe("y".repeat(119));
  });

  it("preserves ordinary titles, including unicode, unchanged", () => {
    expect(sanitizeBasename("binary search")).toBe("binary search");
    expect(sanitizeBasename("quick-sort_v2")).toBe("quick-sort_v2");
    expect(sanitizeBasename("naïve café 変数")).toBe("naïve café 変数");
  });
});

describe("downloadFilename — title-derived name, language-derived extension", () => {
  it("joins the sanitized basename to the canonical extension", () => {
    expect(downloadFilename("binary search", "python")).toBe("binary search.py");
    expect(downloadFilename("utils", "typescript")).toBe("utils.ts");
    expect(downloadFilename("notes", "plaintext")).toBe("notes.txt");
  });

  it("uses the fallback basename when the title is empty", () => {
    expect(downloadFilename("", "javascript")).toBe("untitled.js");
    expect(downloadFilename("   ", "plaintext")).toBe("untitled.txt");
  });

  it("produces exactly one extension separator at the end", () => {
    const name = downloadFilename("v1.2.3 release", "javascript");
    expect(name).toBe("v1.2.3 release.js");
    expect(name.endsWith(".js")).toBe(true);
  });
});

/** jsdom's Blob implements no `.text()`, so read it the way the platform always has. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("downloadText — blob, filename, and object-URL lifecycle", () => {
  // Fake timers are enabled per-test, NOT for the whole block: they stall
  // jsdom's FileReader, so the blob-content tests must run on real timers.
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Records the anchor the module creates so the test can inspect it. */
  function seamsWithSpy() {
    const created: HTMLAnchorElement[] = [];
    const clicked: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    const doc = {
      createElement: (tag: string) => {
        const el = realCreate(tag) as HTMLAnchorElement;
        if (tag === "a") {
          created.push(el);
          el.click = () => {
            clicked.push(el);
          };
        }
        return el;
      },
      body: document.body,
    } as unknown as Document;

    const revoked: string[] = [];
    const blobs: Blob[] = [];
    return {
      created,
      clicked,
      revoked,
      blobs,
      seams: {
        document: doc,
        createObjectURL: (b: Blob) => {
          blobs.push(b);
          return "blob:galley/test";
        },
        revokeObjectURL: (u: string) => {
          revoked.push(u);
        },
      },
    };
  }

  it("clicks an anchor carrying the derived filename and returns it", () => {
    const spy = seamsWithSpy();
    const name = downloadText("const a = 1;\n", "utils", "typescript", spy.seams);

    expect(name).toBe("utils.ts");
    expect(spy.clicked).toHaveLength(1);
    expect(spy.clicked[0].download).toBe("utils.ts");
    expect(spy.clicked[0].href).toBe("blob:galley/test");
  });

  it("puts exactly the supplied text in the blob", async () => {
    const spy = seamsWithSpy();
    downloadText("line one\nline two\n", "notes", "plaintext", spy.seams);

    expect(spy.blobs).toHaveLength(1);
    expect(spy.blobs[0].type).toBe("text/plain;charset=utf-8");
    await expect(readBlob(spy.blobs[0])).resolves.toBe("line one\nline two\n");
  });

  it("removes the temporary anchor from the document", () => {
    const spy = seamsWithSpy();
    downloadText("x", "t", "plaintext", spy.seams);
    expect(spy.created[0].isConnected).toBe(false);
  });

  it("does NOT revoke the object URL in the same tick as the click", () => {
    // A synchronous revoke can cancel the download before the browser has read
    // the blob, producing a silent zero-byte file.
    const spy = seamsWithSpy();
    downloadText("x", "t", "plaintext", spy.seams);
    expect(spy.revoked).toEqual([]);
  });

  it("revokes the object URL on a later tick", () => {
    vi.useFakeTimers();
    const spy = seamsWithSpy();
    downloadText("x", "t", "plaintext", spy.seams);
    vi.runAllTimers();
    expect(spy.revoked).toEqual(["blob:galley/test"]);
  });

  it("still revokes the object URL when the click throws", () => {
    vi.useFakeTimers();
    const spy = seamsWithSpy();
    const realCreate = document.createElement.bind(document);
    const throwingDoc = {
      createElement: (tag: string) => {
        const el = realCreate(tag) as HTMLAnchorElement;
        if (tag === "a") {
          el.click = () => {
            throw new Error("click blocked");
          };
        }
        return el;
      },
      body: document.body,
    } as unknown as Document;

    expect(() =>
      downloadText("x", "t", "plaintext", { ...spy.seams, document: throwingDoc }),
    ).toThrow("click blocked");
    vi.runAllTimers();
    expect(spy.revoked).toEqual(["blob:galley/test"]);
  });

  it("exports the current text for every allowlisted language", async () => {
    for (const { id } of LANGUAGES) {
      const spy = seamsWithSpy();
      const name = downloadText("body", "sheet", id as LanguageId, spy.seams);
      expect(name).toBe(`sheet.${extensionForLanguage(id)}`);
      await expect(readBlob(spy.blobs[0])).resolves.toBe("body");
    }
  });
});
