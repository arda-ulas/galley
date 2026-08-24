import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareButton, ShareStatus } from "./ShareControl";
import { shareStatusPhrase, type ShareStateAny } from "../lib/useShareFlow";

/**
 * DEF-4 (M4.5 §5.2): Share must not drop focus.
 *
 * Two separate drops existed. The button was `disabled` during `sharing`, and a
 * disabled element is blurred and removed from the tab order by the browser. Then
 * on success `ShareButton` returned `null`, destroying the focused element
 * outright. Either one lands focus on `<body>`, which strands a keyboard or
 * screen-reader user at the top of the document with no announcement of what just
 * happened to their draft.
 */

const POST_SHARE = {
  sheetId: "abcdefghij123456",
  url: "https://example.test/abcdefghij123456",
  clip: "idle" as const,
  forceUrl: false,
  meta: { status: "pending" as const },
};

const LOCAL: ShareStateAny = { kind: "local" };
const SHARING: ShareStateAny = { kind: "sharing" };
const SHARED: ShareStateAny = { kind: "shared", ...POST_SHARE };
const STOPPED: ShareStateAny = { kind: "stopped", ...POST_SHARE };

/** The header pair as DraftPage composes it: the status phrase, then the button. */
function Header({ state, onShare = () => {} }: { state: ShareStateAny; onShare?: () => void }) {
  return (
    <div>
      <ShareStatus phrase={shareStatusPhrase(state)} state={state} />
      <ShareButton onShare={onShare} state={state} />
    </div>
  );
}

afterEach(cleanup);

describe("ShareButton — focus survives the sharing transition", () => {
  it("keeps the button focused while sharing instead of disabling it", () => {
    const { rerender } = render(<Header state={LOCAL} />);
    const button = screen.getByRole("button", { name: "Share" });
    button.focus();
    expect(document.activeElement).toBe(button);

    rerender(<Header state={SHARING} />);

    // Same element, still focused — not blurred to <body>.
    const sharing = screen.getByRole("button", { name: "Sharing" });
    expect(sharing).toBe(button);
    expect(document.activeElement).toBe(sharing);
  });

  it("marks the sharing button aria-disabled rather than disabled", () => {
    render(<Header state={SHARING} />);
    const button = screen.getByRole("button", { name: "Sharing" });
    // `disabled` would remove it from the tab order; `aria-disabled` does not.
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("ignores a click while sharing, so a second share is impossible", () => {
    const onShare = vi.fn();
    render(<Header onShare={onShare} state={SHARING} />);
    fireEvent.click(screen.getByRole("button", { name: "Sharing" }));
    expect(onShare).not.toHaveBeenCalled();
  });

  it("still shares on click while local", () => {
    const onShare = vi.fn();
    render(<Header onShare={onShare} state={LOCAL} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it("carries no aria-disabled while local", () => {
    render(<Header state={LOCAL} />);
    expect(screen.getByRole("button", { name: "Share" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });
});

describe("ShareStatus — focus lands on the state phrase after Share", () => {
  it("moves focus to the status phrase, not to <body>, when the button unmounts", () => {
    const { rerender } = render(<Header state={LOCAL} />);
    screen.getByRole("button", { name: "Share" }).focus();

    rerender(<Header state={SHARED} />);

    // The button is gone…
    expect(screen.queryByRole("button", { name: /Share|Sharing/ })).toBeNull();
    // …and focus went somewhere deliberate.
    const status = screen.getByTestId("draft-state");
    expect(document.activeElement).toBe(status);
    expect(document.activeElement).not.toBe(document.body);
    expect(status).toHaveTextContent("Shared");
  });

  it("announces the transition via role=status without becoming a tab stop", () => {
    render(<Header state={SHARED} />);
    const status = screen.getByTestId("draft-state");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("tabindex", "-1");
  });

  it("takes focus on the sharing → shared edge too", () => {
    const { rerender } = render(<Header state={SHARING} />);
    screen.getByRole("button", { name: "Sharing" }).focus();

    rerender(<Header state={SHARED} />);

    expect(document.activeElement).toBe(screen.getByTestId("draft-state"));
  });

  it("claims focus exactly once, so a later state change does not yank it back", () => {
    const { rerender } = render(<Header state={LOCAL} />);
    rerender(<Header state={SHARED} />);
    expect(document.activeElement).toBe(screen.getByTestId("draft-state"));

    // The user moves on to something else…
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);

    // …and the connection later drops. The phrase updates; focus does not move.
    rerender(<Header state={STOPPED} />);
    expect(screen.getByTestId("draft-state")).toHaveTextContent("Connection stopped.");
    expect(document.activeElement).toBe(elsewhere);

    elsewhere.remove();
  });

  it("does not steal focus while the draft is still local", () => {
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    render(<Header state={LOCAL} />);

    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});
