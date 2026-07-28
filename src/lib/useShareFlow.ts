import { useCallback, useEffect, useRef, useState } from "react";
import { createDraftSession, type DraftSession } from "./draftSession";
import type { SharedSessionController } from "./sharedSessionOwnership";
import {
  shareDraftSession as defaultShare,
  type ShareDraftSessionInput,
  type ShareSuccess,
} from "./shareCoordinator";
import { replaceUrlWithSharedSheet as defaultReplaceUrl } from "./route";
import { sheetPath } from "./route";
import type { ShareReceipt } from "./shareCoordinator";
import {
  clearCreationToken as defaultClearToken,
  getOrCreateCreationToken as defaultGetToken,
} from "./creationToken";
import { fetchSheetBootstrap, type SheetBootstrap } from "./sheetSession";
import type { LanguageId } from "./languages";

/**
 * Visible Share flow (M4 S6) — the sharer half of the M4 gate.
 *
 * Owns the local draft session AND drives the one-way Share gesture:
 *   local → Sharing… → (Shared | Connecting… | Connection stopped.) | failed.
 *
 * Invariants that make this safe:
 * 1. NO editor remount: `shareDraftSession` attaches a provider to the session's
 *    EXISTING doc/awareness/undo (S4), so the CodeMirror view is never rebuilt.
 * 2. An in-flight unmount LEASE: the session is never destroyed out from under an
 *    in-flight Share. On unmount mid-share the attempt is abandoned and the
 *    settle handlers dispose the right owner. The creation token is retained
 *    across every non-adopted outcome and cleared ONLY after a still-mounted
 *    adoption has replaced the URL.
 * 3. Storage/history failures never strand the UI: a creation-token acquisition
 *    failure keeps the draft LOCAL (no POST) and shows the failed state; a
 *    `replaceState` failure keeps the durable success but exposes the URL through
 *    the fallback; a token-clear failure after adoption does not undo the share.
 * 4. Authoritative metadata: a stale token can idempotently recover an existing
 *    durable sheet whose title/language differ from the fresh local draft, so on
 *    adoption we fetch authoritative bootstrap metadata and present THAT (never
 *    fresh local metadata) for the locked shared view.
 *
 * Legal S6 wording only.
 */

/** Clipboard sub-state, independent of durability/connection. */
type Clip = "idle" | "copied" | "failed";

/**
 * Authoritative metadata for the locked shared view.
 * - `pending` — the reconciliation fetch is in flight (optimistically identical
 *   to the just-submitted local values for a first-time create).
 * - `ready` — authoritative title/language fetched from the durable sheet.
 * - `unavailable` — reconciliation failed; present neutral metadata, never fresh
 *   local values (ownership has transferred, so local values are not authoritative).
 */
export type ShareMeta =
  | { status: "pending" }
  | { status: "ready"; title: string; language: LanguageId }
  | { status: "unavailable" };

type PostShare = {
  sheetId: string;
  url: string;
  clip: Clip;
  /** Force the selectable URL fallback even when not connection-pending — set
   *  when `replaceState` or token-clear failed (the address bar can't be trusted). */
  forceUrl: boolean;
  meta: ShareMeta;
};

export type ShareState =
  | { kind: "local" }
  | { kind: "sharing" }
  | ({ kind: "shared" } & PostShare)
  | ({ kind: "connecting" } & PostShare)
  | ({ kind: "stopped" } & PostShare);

// `failed` is separate so the union above can share the post-share url shape.
export type ShareStateAny = ShareState | { kind: "failed" };

type ShareLease = { abandoned: boolean; settled: boolean };
type ShareFn = (input: ShareDraftSessionInput) => Promise<ShareSuccess>;

export type UseShareFlowSeams = {
  createSession?: () => DraftSession;
  share?: ShareFn;
  replaceUrl?: (receipt: Readonly<ShareReceipt>) => void;
  copyText?: (text: string) => Promise<boolean>;
  /** Creation-token acquisition (may throw on storage failure). */
  getToken?: () => string;
  /** Creation-token clear (may throw on storage failure). */
  clearToken?: () => void;
  /** Authoritative metadata reconciliation for the shared sheet id. Never rejects. */
  fetchBootstrap?: (sheetId: string) => Promise<SheetBootstrap | null>;
};

/** A post-share state that carries a shareable URL. */
function hasUrl(s: ShareStateAny): s is Extract<ShareState, PostShare> {
  return s.kind === "shared" || s.kind === "connecting" || s.kind === "stopped";
}

/** The welded status phrase for a share state (exact approved copy). */
export function shareStatusPhrase(s: ShareStateAny): string {
  switch (s.kind) {
    case "local":
      return "Local draft — not uploaded";
    case "sharing":
      return "Sharing…";
    case "shared":
      return s.clip === "copied" ? "Shared · link copied" : "Shared";
    case "connecting":
      return "Connecting…";
    case "stopped":
      return "Connection stopped.";
    case "failed":
      return "Couldn’t share — your draft is safe here";
  }
}

/** Title/language are editable only while local or after a pre-transfer failure;
 *  any durable success locks them read-only for S6 (M6 owns mutation). */
export function metadataEditable(s: ShareStateAny): boolean {
  return s.kind === "local" || s.kind === "failed";
}

/**
 * The metadata to DISPLAY given the current share state and the local draft's
 * editable values. While editable (or during the optimistic reconciliation
 * window) the local values are shown; once authoritative metadata is available
 * it REPLACES them; when reconciliation is unavailable a neutral placeholder is
 * shown rather than presenting fresh local metadata as authoritative.
 */
export function displayedMetadata(
  s: ShareStateAny,
  localTitle: string,
  localLanguage: LanguageId,
): { title: string; language: LanguageId } {
  if (!hasUrl(s)) return { title: localTitle, language: localLanguage };
  switch (s.meta.status) {
    case "ready":
      return { title: s.meta.title, language: s.meta.language };
    case "pending":
    case "unavailable":
      // Ownership has transferred, so the fresh local title/language are NOT
      // authoritative and must never be shown as the durable sheet's metadata —
      // not even briefly while the authoritative bootstrap is still pending. Show
      // the neutral placeholder until authoritative metadata arrives (`ready`);
      // `plaintext` makes no highlighting claim.
      return { title: "", language: "plaintext" };
  }
}

async function defaultCopyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Absolute shared URL, derived deterministically (not read from the address bar,
 *  so it is correct even when `replaceState` failed). Falls back to a bare path
 *  in a non-browser environment. */
function absoluteShareUrl(sheetId: string): string {
  const path = sheetPath(sheetId);
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

const COPIED_SETTLE_MS = 1500;

export function useShareFlow(seams: UseShareFlowSeams = {}) {
  const {
    createSession = createDraftSession,
    share: shareImpl = defaultShare,
    replaceUrl = defaultReplaceUrl,
    copyText = defaultCopyText,
    getToken = () => defaultGetToken(),
    clearToken = () => defaultClearToken(),
    fetchBootstrap = (id: string) => fetchSheetBootstrap(id),
  } = seams;

  const [session, setSession] = useState<DraftSession | null>(null);
  const [state, setState] = useState<ShareStateAny>({ kind: "local" });

  const sessionRef = useRef<DraftSession | null>(null);
  const stateRef = useRef<ShareStateAny>(state);
  stateRef.current = state;
  const leaseRef = useRef<ShareLease | null>(null);
  const controllerRef = useRef<SharedSessionController | null>(null);
  const mountedRef = useRef(false);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const s = createSession();
    sessionRef.current = s;
    mountedRef.current = true;
    setSession(s);
    return () => {
      mountedRef.current = false;
      if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
      const lease = leaseRef.current;
      if (lease && !lease.settled) {
        // In-flight Share is using the session: abandon; the settle handlers
        // dispose the correct owner. Do NOT destroy the session now (S4 reads it).
        lease.abandoned = true;
        return;
      }
      if (controllerRef.current) {
        // Adopted + mounted: the controller owns provider+session disposal.
        try {
          controllerRef.current.dispose();
        } catch {
          /* idempotent, failure-safe */
        }
        return;
      }
      // Local (or post-rejection): normal draft disposal.
      s.disposeUnlessTransferred();
    };
    // Created once per committed mount; Strict Mode's remount disposes the
    // speculative one via this cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleCopiedSettle = useCallback(() => {
    if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
    clipTimerRef.current = setTimeout(() => {
      setState((prev) => (hasUrl(prev) ? { ...prev, clip: "idle" } : prev));
    }, COPIED_SETTLE_MS);
  }, []);

  const runCopy = useCallback(
    (url: string) => {
      copyText(url).then((ok) => {
        if (!mountedRef.current) return;
        setState((prev) => (hasUrl(prev) ? { ...prev, clip: ok ? "copied" : "failed" } : prev));
        if (ok) scheduleCopiedSettle();
      });
    },
    [copyText, scheduleCopiedSettle],
  );

  /**
   * After adoption, fetch authoritative bootstrap metadata and replace the
   * displayed title/language. Runs for EVERY adoption because the S4 result
   * cannot distinguish a first-time create (201) from a stale-token idempotent
   * recovery (200) — see the module header. For a first-time create the fetched
   * values equal the submitted ones (a no-op); for a recovery they correct a
   * mismatched title/language. On failure the state moves to `unavailable`
   * (neutral) rather than re-presenting fresh local metadata as authoritative.
   */
  const reconcileMetadata = useCallback(
    (sheetId: string) => {
      fetchBootstrap(sheetId).then(
        (boot) => {
          if (!mountedRef.current) return;
          setState((prev) =>
            hasUrl(prev) && prev.sheetId === sheetId
              ? {
                  ...prev,
                  meta: boot
                    ? { status: "ready", title: boot.title, language: boot.language }
                    : { status: "unavailable" },
                }
              : prev,
          );
        },
        () => {
          // Defensive: the default never rejects, but an injected seam might.
          if (!mountedRef.current) return;
          setState((prev) =>
            hasUrl(prev) && prev.sheetId === sheetId
              ? { ...prev, meta: { status: "unavailable" } }
              : prev,
          );
        },
      );
    },
    [fetchBootstrap],
  );

  const onFulfilled = useCallback(
    (lease: ShareLease, result: ShareSuccess) => {
      lease.settled = true;
      if (lease.abandoned) {
        // Abandoned success: dispose the controller; RETAIN the token.
        try {
          result.controller.dispose();
        } catch {
          /* idempotent */
        }
        return;
      }
      // Adopt (still mounted): retain the controller FIRST so no failure below can
      // strand ownership.
      controllerRef.current = result.controller;

      // The absolute URL is computed deterministically, so it is correct whether
      // or not the address bar was actually updated.
      const url = absoluteShareUrl(result.sheetId);

      // Attempt the URL replacement. A `replaceState` failure does NOT undo the
      // durable share: keep the controller + token, expose the URL fallback, and
      // do not touch the clipboard (the address bar can't be trusted).
      let navReplaced = false;
      try {
        replaceUrl(result.receipt);
        navReplaced = true;
      } catch {
        navReplaced = false;
      }

      // Clear the token ONLY after a successful URL adoption. A clear failure must
      // not strand the UI in Sharing… nor undo the (already successful) share; it
      // just surfaces the URL fallback.
      let tokenCleared = false;
      if (navReplaced) {
        try {
          clearToken();
          tokenCleared = true;
        } catch {
          tokenCleared = false;
        }
      }

      const kind: ShareState["kind"] =
        result.status === "connected"
          ? "shared"
          : result.retryable
            ? "connecting"
            : "stopped";
      const forceUrl = !navReplaced || !tokenCleared;
      setState({
        kind,
        sheetId: result.sheetId,
        url,
        clip: "idle",
        forceUrl,
        meta: { status: "pending" },
      });

      // Clipboard is independent of the durable/connection outcome, but is only
      // meaningful once the URL is in the address bar.
      if (navReplaced) runCopy(url);

      // Reconcile authoritative metadata for the locked shared view.
      reconcileMetadata(result.sheetId);
    },
    [replaceUrl, clearToken, runCopy, reconcileMetadata],
  );

  const onRejected = useCallback((lease: ShareLease, s: DraftSession) => {
    lease.settled = true;
    if (lease.abandoned) {
      // Abandoned rejection (always pre-transfer ⇒ still local): dispose the
      // session; RETAIN the token so a same-token retry can recover.
      try {
        s.destroy();
      } catch {
        /* idempotent */
      }
      return;
    }
    // Mounted rejection: stay local, retain token, re-enable metadata, allow retry.
    setState({ kind: "failed" });
  }, []);

  const share = useCallback(
    (title: string, language: LanguageId) => {
      const s = sessionRef.current;
      if (!s) return;
      const kind = stateRef.current.kind;
      if (kind !== "local" && kind !== "failed") return; // suppress duplicate/while-sharing/after-success

      // Acquire the creation token BEFORE moving to Sharing…/issuing a POST. A
      // storage read/write failure keeps the draft fully LOCAL (no POST, session
      // untouched and editable) and surfaces the failed state — never an
      // unhandled rejection.
      let token: string;
      try {
        token = getToken();
      } catch {
        setState({ kind: "failed" });
        return;
      }

      setState({ kind: "sharing" });
      const lease: ShareLease = { abandoned: false, settled: false };
      leaseRef.current = lease;
      shareImpl({
        session: s,
        title,
        language,
        creationToken: token,
        onTerminal: () => {
          // A terminal callback may be queued by the provider and fire AFTER this
          // component unmounts (or after the attempt was abandoned): guard the
          // current mounted/adopted identity before any state update. A legitimate
          // terminal while still mounted + adopted flips a live shared/connecting
          // state to stopped, keeping the editor mounted; it never claims future
          // sync or reconnect.
          if (lease.abandoned) return;
          if (!mountedRef.current) return;
          setState((prev) =>
            prev.kind === "shared" || prev.kind === "connecting"
              ? { ...prev, kind: "stopped" }
              : prev,
          );
        },
      }).then(
        (result) => onFulfilled(lease, result),
        () => onRejected(lease, s),
      );
    },
    [shareImpl, getToken, onFulfilled, onRejected],
  );

  const copyLink = useCallback(() => {
    const cur = stateRef.current;
    if (!hasUrl(cur)) return;
    runCopy(cur.url);
  }, [runCopy]);

  return { session, state, share, copyLink };
}
