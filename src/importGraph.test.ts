import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The T1 import-graph gate (M4.5 §5.1).
 *
 * T1's desired invariant: *every file under `src/` is reachable from
 * `src/main.tsx` or is a test of something that is.* Eleven unreachable files
 * plus the legacy `tokens.css` were deleted to satisfy it; this test is what
 * keeps it true, so a second dead island cannot accumulate silently.
 *
 * It walks the static import graph from the real entry point rather than
 * grepping for the deleted names — a name list only catches the eleven files we
 * already know about, while a reachability walk catches the twelfth. The name
 * assertion is kept as a second, cheaper check so a regression names itself.
 *
 * Deliberately static-only: it resolves `import`/`export … from` specifiers by
 * source text. `main.tsx` has no dynamic imports, and adding one would be an
 * architectural change, not a silent edit — if that ever happens, this walk must
 * be taught about it rather than relaxed.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY = path.join(SRC, "main.tsx");

/** Files exempt from reachability, with the reason each is legitimately unreachable. */
const EXEMPT = new Map<string, string>([
  ["vite-env.d.ts", "ambient type declarations — never imported"],
  ["test/setup.ts", "vitest setupFiles entry (vitest.config.ts)"],
  ["test/websocketProbe.ts", "test-only helper, imported by tests"],
]);

/** The eleven files and one stylesheet deleted in T1. None may return. */
const DELETED = [
  "lib/room",
  "lib/usePresence",
  "lib/useProviderStatus",
  "lib/useSessionIdentity",
  "components/AppShell",
  "components/PresenceBar",
  "components/ConnectionStatus",
  "components/ui/button",
  "components/ui/badge",
  "lib/cn",
  "lib/codeMirrorTheme",
  "styles/tokens.css",
];

/** The six npm dependencies that existed only to serve the deleted island. */
const REMOVED_DEPS = [
  "framer-motion",
  "class-variance-authority",
  "lucide-react",
  "@radix-ui/react-slot",
  "clsx",
  "tailwind-merge",
];

const SOURCE_EXT = [".ts", ".tsx", ".css"];

/** Every source file under `src/`, as paths relative to `src/`. */
function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) {
      listSourceFiles(abs, acc);
    } else if (SOURCE_EXT.includes(path.extname(abs))) {
      acc.push(path.relative(SRC, abs));
    }
  }
  return acc;
}

const isTestFile = (rel: string) => /\.test\.tsx?$/.test(rel);

/** This gate file itself, which necessarily quotes every name it forbids. */
const SELF = "importGraph.test.ts";

/**
 * Relative import specifiers in a source file. Bare specifiers (`react`,
 * `yjs`, …) are package imports and are intentionally skipped — this walk maps
 * first-party reachability, not the dependency tree.
 */
function relativeImports(source: string): string[] {
  const specifiers: string[] = [];
  // Two forms, matched on the SPECIFIER position so a multi-line import clause
  // (`import {\n  a,\n  b,\n} from "./x"`) is not missed the way an
  // `import`-anchored, newline-bounded pattern would miss it:
  //   `… from "x"`      — covers `import … from` and `export … from`
  //   `import "x"`      — bare side-effect import (e.g. the global stylesheet)
  const patterns = [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g];
  for (const pattern of patterns) {
    for (const [, spec] of source.matchAll(pattern)) {
      if (spec.startsWith(".")) specifiers.push(spec);
    }
  }
  return specifiers;
}

/** Resolve a relative specifier the way the bundler does: exact, then extensions. */
function resolve(fromRel: string, spec: string): string | null {
  const base = path.normalize(path.join(path.dirname(fromRel), spec));
  const candidates = [base, ...SOURCE_EXT.map((e) => base + e), path.join(base, "index.ts")];
  for (const candidate of candidates) {
    try {
      if (statSync(path.join(SRC, candidate)).isFile()) return candidate;
    } catch {
      /* not this candidate */
    }
  }
  return null;
}

/** Transitive closure of relative imports starting at `main.tsx`. */
function reachableFromEntry(): Set<string> {
  const seen = new Set<string>();
  const queue = [path.relative(SRC, ENTRY)];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (path.extname(current) === ".css") continue; // leaf; no TS imports to follow
    for (const spec of relativeImports(readFileSync(path.join(SRC, current), "utf8"))) {
      const target = resolve(current, spec);
      if (target) queue.push(target);
    }
  }
  return seen;
}

describe("T1 import graph — no dead island under src/", () => {
  it("reaches every non-test source file from main.tsx", () => {
    const reachable = reachableFromEntry();
    const orphans = listSourceFiles(SRC)
      .filter((rel) => !isTestFile(rel))
      .filter((rel) => !EXEMPT.has(rel))
      .filter((rel) => !reachable.has(rel));

    expect(orphans).toEqual([]);
  });

  it("has no live module importing a deleted name", () => {
    const offenders: string[] = [];
    for (const rel of listSourceFiles(SRC).filter((f) => f !== SELF)) {
      const source = readFileSync(path.join(SRC, rel), "utf8");
      for (const spec of relativeImports(source)) {
        const normalized = path
          .normalize(path.join(path.dirname(rel), spec))
          .replace(/\.tsx?$/, "");
        if (DELETED.some((d) => normalized === d.replace(/\.css$/, "") || normalized === d)) {
          offenders.push(`${rel} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no source file importing a removed dependency", () => {
    const offenders: string[] = [];
    for (const rel of listSourceFiles(SRC).filter((f) => f !== SELF)) {
      const source = readFileSync(path.join(SRC, rel), "utf8");
      for (const dep of REMOVED_DEPS) {
        // Match the specifier position only, so prose in a comment cannot trip it.
        if (new RegExp(`["']${dep.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}(/[^"']*)?["']`).test(source)) {
          offenders.push(`${rel} → ${dep}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares none of the removed dependencies in package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(SRC, "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(REMOVED_DEPS.filter((d) => d in declared)).toEqual([]);
  });
});
