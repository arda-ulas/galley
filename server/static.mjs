// Production static serving for the built Vite client (M4.5 T4).
//
// In production one Node process serves BOTH the API/WebSocket surface and the
// built SPA, so `https://host/{sheetId}` is a single origin — which is exactly
// what `src/lib/topology.ts` assumes when it derives `wss://<host>/ws` from
// `window.location`. In development Vite serves the client and proxies `/api`
// and `/ws`, so this handler is not used.
//
// Precedence is a hard requirement: this handler is installed AFTER every
// `/api` route in the dispatch chain and refuses reserved prefixes outright, so
// an API or WebSocket path can never be answered with the HTML shell.
//
// SPA fallback is deliberately narrow. A path that LOOKS like an asset (it has
// a file extension) and does not exist returns 404 — serving `index.html` there
// would turn a broken asset reference into a silent 200 of HTML, masking the
// error and producing confusing MIME-type failures in the browser.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

/** Extension → Content-Type for everything the Vite build can emit. */
const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
});

/** Path prefixes this handler must never answer, at any depth. */
export const RESERVED_PREFIXES = Object.freeze(["/api", "/ws", "/__test"]);

/** Vite emits content-hashed files under /assets — safe to cache immutably. */
const IMMUTABLE_PREFIX = "/assets/";

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function isReserved(pathname) {
  return RESERVED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

/**
 * Strip the query/hash and percent-decode a request target into a pathname.
 * Returns null for anything malformed or containing a NUL, so a bad target is
 * refused rather than guessed at.
 */
export function safePathname(url) {
  if (typeof url !== "string" || url === "") return null;
  const cut = url.search(/[?#]/);
  const raw = cut === -1 ? url : url.slice(0, cut);
  if (!raw.startsWith("/")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes("\0")) return null;
  return decoded;
}

/**
 * Map a pathname to an absolute file path strictly inside `root`.
 * Returns null if the result would escape the root (traversal defence).
 */
export function resolveWithinRoot(root, pathname) {
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, "." + pathname);
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return candidate;
}

async function statFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

function sendFile(req, res, filePath, info, cacheControl) {
  const headers = {
    "Content-Type": contentTypeFor(filePath),
    "Content-Length": String(info.size),
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  };
  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  const stream = createReadStream(filePath);
  // A read error after headers are sent can only be contained by destroying the
  // response; the client sees a truncated body rather than a hung request.
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

/**
 * Build the static handler, or return null when `root` is not a usable
 * directory (e.g. the client was never built) so the caller can fall through to
 * its normal 404 instead of failing to boot.
 *
 * The returned function answers the request and resolves `true`, or resolves
 * `false` without touching the response when the request is not its business.
 *
 * @param {{ root: string }} options
 * @returns {Promise<((req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<boolean>) | null>}
 */
export async function createStaticHandler({ root }) {
  const rootResolved = path.resolve(root);
  let indexInfo;
  try {
    const dir = await stat(rootResolved);
    if (!dir.isDirectory()) return null;
    indexInfo = await statFile(path.join(rootResolved, "index.html"));
  } catch {
    return null;
  }
  if (!indexInfo) return null; // a directory without index.html cannot serve an SPA
  const indexPath = path.join(rootResolved, "index.html");

  return async function handleStatic(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;

    const pathname = safePathname(req.url);
    if (pathname === null) return false;
    // API / WebSocket / test routes are never the static handler's business.
    if (isReserved(pathname)) return false;

    const filePath = resolveWithinRoot(rootResolved, pathname);
    if (filePath === null) {
      // Traversal attempt — refuse explicitly rather than falling through to a
      // route that might interpret it.
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("bad request");
      return true;
    }

    const info = await statFile(filePath);
    if (info) {
      const immutable = pathname.startsWith(IMMUTABLE_PREFIX);
      sendFile(
        req,
        res,
        filePath,
        info,
        immutable ? "public, max-age=31536000, immutable" : "no-cache",
      );
      return true;
    }

    // No such file. Only application ROUTES fall back to the SPA shell; a
    // missing asset stays a 404 so build/reference errors surface honestly.
    const looksLikeAsset = path.extname(pathname) !== "";
    if (looksLikeAsset) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return true;
    }

    const freshIndex = (await statFile(indexPath)) ?? indexInfo;
    sendFile(req, res, indexPath, freshIndex, "no-cache");
    return true;
  };
}
