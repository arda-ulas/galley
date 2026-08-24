import { useEffect, useRef } from "react";
import { PAPER } from "../lib/paperTheme";
import type { ShareStateAny } from "../lib/useShareFlow";

/**
 * The visible Share control (M4 S6). While local (or after a pre-transfer
 * failure) it is the one filled, emphasized control on screen; while sharing it
 * becomes its own in-place progress statement; after any durable success it is
 * replaced by the standing shared state (the URL surfaces only when the clipboard
 * copy failed or the connection is pending — the URL is never hidden then).
 *
 * Focus continuity (M4.5 T2 / DEF-4). Sharing used to destroy the focused element
 * twice over: the button was `disabled` during `sharing`, and on success the
 * component returned `null`. Both drop focus to `<body>`, which strands keyboard
 * and screen-reader users at the top of the document with no announcement. Two
 * coupled fixes keep a real focus target at every step:
 *
 * 1. **During `sharing`** the same button element is KEPT MOUNTED and marked
 *    `aria-disabled` with a no-op click handler, rather than `disabled`. An
 *    `aria-disabled` control is still focusable, so focus never leaves it, while
 *    assistive technology still reports it as unavailable and the no-op handler
 *    makes a second Share impossible.
 * 2. **On durable success** focus moves deliberately to the post-share status
 *    phrase (`ShareStatus`, a `tabIndex={-1}` `role="status"` element) — the
 *    element that carries the new truth — before the button unmounts.
 */

const ACCESS_TRUTH_1 = "Anyone with this link can read and change this sheet.";
const ACCESS_TRUTH_2 = "Nothing was uploaded before you shared.";

/**
 * The post-share states in which the Share button is gone and focus must land.
 * A type predicate, so callers narrow to the states that actually carry a URL
 * instead of asserting it.
 */
function isPostShare(
  state: ShareStateAny,
): state is Extract<ShareStateAny, { url: string }> {
  return (
    state.kind === "shared" || state.kind === "connecting" || state.kind === "stopped"
  );
}

export function ShareButton({
  state,
  onShare,
}: {
  state: ShareStateAny;
  onShare: () => void;
}) {
  const sharing = state.kind === "sharing";

  if (sharing || state.kind === "local" || state.kind === "failed") {
    return (
      <button
        type="button"
        // NOT `disabled`: a disabled element is removed from the tab order and
        // blurred by the browser. `aria-disabled` keeps focus and the tab order
        // intact while still announcing the unavailable state.
        aria-disabled={sharing || undefined}
        aria-label={sharing ? "Sharing" : undefined}
        onClick={sharing ? undefined : onShare}
        style={buttonStyle(sharing)}
      >
        {sharing ? "Sharing…" : "Share"}
      </button>
    );
  }
  // Post-share: no button; the standing state lives in the status phrase / info.
  // `ShareStatus` has already taken focus by this point.
  return null;
}

/**
 * The welded state phrase, and the focus target after Share.
 *
 * It is `role="status"` so the transition is announced rather than silently
 * swapped, and `tabIndex={-1}` so it can receive programmatic focus without
 * entering the tab order (a static phrase should not be a tab stop). Focus is
 * moved exactly once, on the local/sharing → post-share edge, so a later
 * `Shared · link copied` → `Shared` settle or a `shared` → `stopped` transition
 * does not yank focus back from wherever the user has since moved it.
 *
 * This owns the phrase element that `DraftShell` renders in its header row.
 */
export function ShareStatus({
  state,
  phrase,
}: {
  state: ShareStateAny;
  phrase: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const claimedRef = useRef(false);

  const post = isPostShare(state);
  useEffect(() => {
    if (!post || claimedRef.current) return;
    claimedRef.current = true;
    ref.current?.focus();
  }, [post]);

  return (
    <span
      data-testid="draft-state"
      ref={ref}
      role="status"
      tabIndex={-1}
      style={{ color: PAPER.inkMuted, outlineOffset: 2, whiteSpace: "nowrap" }}
    >
      {phrase}
    </span>
  );
}

/**
 * Post-share info line: the locked access-truth pair, and — when the clipboard
 * copy failed or the connection is pending — the selectable absolute URL plus an
 * inline `Copy link` action. The URL stays visible/selectable even if a manual
 * copy also fails.
 */
export function ShareInfo({
  state,
  onCopyLink,
}: {
  state: ShareStateAny;
  onCopyLink: () => void;
}) {
  if (!isPostShare(state)) return null;

  const showUrl =
    state.forceUrl ||
    state.clip === "failed" ||
    state.kind === "connecting" ||
    state.kind === "stopped";

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1"
      style={{
        background: PAPER.sheet,
        borderBottom: `1px solid ${PAPER.rule}`,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        color: PAPER.inkMuted,
      }}
    >
      <span>{ACCESS_TRUTH_1}</span>
      <span>{ACCESS_TRUTH_2}</span>
      {showUrl ? (
        <>
          <input
            aria-label="Shared URL"
            readOnly
            value={state.url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent outline-none"
            style={{ color: PAPER.ink, fontFamily: "inherit", fontSize: 12 }}
          />
          <button
            type="button"
            onClick={onCopyLink}
            style={{
              background: "transparent",
              border: "none",
              color: PAPER.accentYou,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              textDecoration: "underline",
            }}
          >
            Copy link
          </button>
        </>
      ) : null}
    </div>
  );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? PAPER.rule : PAPER.accentYou,
    color: disabled ? PAPER.inkMuted : PAPER.sheet,
    border: "none",
    borderRadius: 3,
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    padding: "4px 12px",
    whiteSpace: "nowrap",
  };
}
