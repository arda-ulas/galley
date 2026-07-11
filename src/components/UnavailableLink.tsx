import { PAPER } from "../lib/paperTheme";

/**
 * Neutral state for any non-root path in M1. There is no shared-sheet route yet
 * (Share is M3/M4), so a non-root link resolves to nothing this build can serve.
 *
 * It deliberately makes no technical claim about *why* (never "expired" vs
 * "invalid"), contacts no server, creates no remote object, and shows none of:
 * a draft editor, Share, Live/Connecting/Saved, presence, or timeline.
 */
export function UnavailableLink() {
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
      <p>This link is unavailable</p>
    </div>
  );
}
