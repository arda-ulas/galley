import { PAPER } from "../lib/paperTheme";
import type { ShareStateAny } from "../lib/useShareFlow";

/**
 * The visible Share control (M4 S6). While local (or after a pre-transfer
 * failure) it is the one filled, emphasized control on screen; while sharing it
 * becomes its own in-place progress statement; after any durable success it is
 * replaced by the standing shared state (the URL surfaces only when the clipboard
 * copy failed or the connection is pending — the URL is never hidden then).
 */

const ACCESS_TRUTH_1 = "Anyone with this link can read and change this sheet.";
const ACCESS_TRUTH_2 = "Nothing was uploaded before you shared.";

export function ShareButton({
  state,
  onShare,
}: {
  state: ShareStateAny;
  onShare: () => void;
}) {
  if (state.kind === "sharing") {
    return (
      <button
        type="button"
        disabled
        aria-label="Sharing"
        style={buttonStyle(true)}
      >
        Sharing…
      </button>
    );
  }
  if (state.kind === "local" || state.kind === "failed") {
    return (
      <button type="button" onClick={onShare} style={buttonStyle(false)}>
        Share
      </button>
    );
  }
  // Post-share: no button; the standing state lives in the status phrase / info.
  return null;
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
  const post =
    state.kind === "shared" || state.kind === "connecting" || state.kind === "stopped";
  if (!post) return null;

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
