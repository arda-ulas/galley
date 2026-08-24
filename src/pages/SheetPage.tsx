import { useEffect, useRef, useState } from "react";
import { DownloadControl } from "../components/DownloadControl";
import { DraftEditor } from "../components/DraftEditor";
import { DraftShell } from "../components/DraftShell";
import { UnavailableLink } from "../components/UnavailableLink";
import { PAPER } from "../lib/paperTheme";
import type { DraftSession } from "../lib/draftSession";
import type { SharedSessionController } from "../lib/sharedSessionOwnership";
import { openSheetSession, type SheetBootstrap } from "../lib/sheetSession";

/**
 * Direct-load shared-sheet page (M4 S6). A thin effect drives the standalone
 * `openSheetSession()` lifecycle and mounts the editor ONLY after the first
 * authoritative sync (never starter/inert content). Ownership is explicit and
 * Strict-Mode safe: each run has its own AbortController and mounted flag; a
 * stale/aborted READY result is disposed, never published; on unmount the
 * current open is aborted and any published controller disposed exactly once.
 */

type Phase = "connecting" | "ready" | "unavailable" | "error" | "stopped";

type Ready = {
  controller: SharedSessionController;
  session: DraftSession;
  bootstrap: SheetBootstrap;
};

export function SheetPage({ sheetId }: { sheetId: string }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [ready, setReady] = useState<Ready | null>(null);
  const publishedRef = useRef<SharedSessionController | null>(null);
  // Monotonic generation identity: each open invocation (mount, Strict-Mode
  // re-run, or `sheetId` change) claims a fresh generation. A result/callback is
  // ignored — and any READY controller it carries disposed — unless it is still
  // the current generation, so a stale open can never publish into a newer one.
  const genRef = useRef(0);

  useEffect(() => {
    const myGen = ++genRef.current;
    const abort = new AbortController();
    let published = false;
    const isCurrent = () => genRef.current === myGen && !abort.signal.aborted;

    // Leaving any prior ready rendering IMMEDIATELY: a `sheetId` change shows
    // Connecting… for the new id instead of continuing to show the old sheet.
    setReady(null);
    setPhase("connecting");

    openSheetSession({
      sheetId,
      signal: abort.signal,
      onStopped: () => {
        // Terminal close AFTER first sync: keep the editor mounted + editable,
        // just tell the truth. A stale-generation terminal cannot mutate state.
        if (isCurrent() && published) setPhase("stopped");
      },
    })
      .then((outcome) => {
        if (!isCurrent()) {
          // Stale/aborted: dispose a READY controller rather than publish it.
          if (outcome.status === "ready") {
            try {
              outcome.controller.dispose();
            } catch {
              /* idempotent, failure-safe */
            }
          }
          return;
        }
        switch (outcome.status) {
          case "ready":
            published = true;
            publishedRef.current = outcome.controller;
            setReady({
              controller: outcome.controller,
              session: outcome.session,
              bootstrap: outcome.bootstrap,
            });
            setPhase("ready");
            break;
          case "unavailable":
            setPhase("unavailable");
            break;
          case "error":
            setPhase("error");
            break;
          case "stopped":
            setPhase("stopped");
            break;
          case "aborted":
            break;
        }
      })
      .catch(() => {
        // Defensive: openSheetSession totalizes and should never reject, but a
        // rejection must still never surface as an unhandled promise or a
        // misleading UI — treat it as an open error for the current generation.
        if (isCurrent()) setPhase("error");
      });

    return () => {
      // Invalidate this generation so a late result/callback becomes stale.
      genRef.current++;
      abort.abort();
      const ctrl = publishedRef.current;
      publishedRef.current = null;
      if (ctrl) {
        try {
          ctrl.dispose();
        } catch {
          /* idempotent, failure-safe */
        }
      }
    };
  }, [sheetId]);

  // Once ready, the editor stays mounted even if the connection later stops.
  if (ready) {
    return (
      <DraftShell
        language={ready.bootstrap.language}
        onLanguageChange={() => {}}
        onTitleChange={() => {}}
        readOnly
        statusPhrase={phase === "stopped" ? "Connection stopped." : "Shared"}
        title={ready.bootstrap.title}
        trailing={
          <DownloadControl
            getText={() => ready.session.text.toString()}
            language={ready.bootstrap.language}
            title={ready.bootstrap.title}
          />
        }
      >
        <DraftEditor language={ready.bootstrap.language} session={ready.session} />
      </DraftShell>
    );
  }

  if (phase === "unavailable") return <UnavailableLink />;

  const message =
    phase === "error"
      ? "This sheet couldn’t be opened."
      : phase === "stopped"
        ? "Connection stopped."
        : "Connecting…";
  return <StatusSurface message={message} />;
}

/** A neutral centered surface for pre-editor states (connecting / error / stopped). */
function StatusSurface({ message }: { message: string }) {
  return (
    <div
      className="flex h-dvh items-center justify-center"
      style={{
        background: PAPER.canvas,
        color: PAPER.inkMuted,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 14,
      }}
    >
      <p>{message}</p>
    </div>
  );
}
