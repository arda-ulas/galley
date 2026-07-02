import { useState } from "react";
import type { ReactNode } from "react";
import { Check, GitBranch, Link as LinkIcon } from "lucide-react";

type AppShellProps = {
  roomId: string;
  connection: ReactNode;
  presence: ReactNode;
  timeline: ReactNode;
  isPast?: boolean;
  children: ReactNode;
};

function HeaderDivider() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 1,
        height: 14,
        background: "var(--border)",
        opacity: 0.9,
        flexShrink: 0,
      }}
    />
  );
}

export function AppShell({
  roomId,
  connection,
  presence,
  timeline,
  isPast = false,
  children,
}: AppShellProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  }

  return (
    <>
      <div className="flex lg:hidden h-dvh items-center justify-center bg-[var(--bg)]">
        <span className="text-sm text-[var(--muted)]">
          Best viewed on desktop
        </span>
      </div>

      <main className="hidden lg:grid h-dvh overflow-hidden grid-rows-[36px_1fr_52px] bg-[var(--bg)] text-[var(--text)]">
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--panel)] px-3">
          {/* Room identity — echo://demo */}
          <div
            aria-label={`echo://${roomId}`}
            className="flex items-center gap-1.5 select-none"
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 12,
              letterSpacing: 0.2,
            }}
          >
            <GitBranch
              aria-hidden
              size={12}
              strokeWidth={1.75}
              style={{ color: "var(--muted)", opacity: 0.7, flexShrink: 0 }}
            />
            <span style={{ color: "var(--muted)" }}>echo</span>
            <span style={{ color: "var(--border)" }}>://</span>
            <span style={{ color: "var(--text)", opacity: 0.9 }}>{roomId}</span>
          </div>

          {/* Right cluster: Live · Presence · Copy link */}
          <div className="flex items-center gap-3">
            {connection}
            <HeaderDivider />
            {presence}
            <HeaderDivider />
            <button
              aria-label={
                copied ? "Room link copied to clipboard" : "Copy room link"
              }
              aria-live="polite"
              className={[
                "inline-flex select-none items-center gap-1.5 rounded-full border transition-colors",
                copied
                  ? "border-[rgba(245,166,35,0.55)] bg-[rgba(245,166,35,0.08)] text-[var(--accent)]"
                  : [
                      "border-[var(--border)] bg-transparent text-[var(--muted)]",
                      "hover:border-[var(--accent)] hover:bg-[rgba(245,166,35,0.04)] hover:text-[var(--text)]",
                      "active:bg-[rgba(245,166,35,0.06)] active:border-[var(--accent)]",
                      "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2",
                      "focus-visible:outline-[rgba(245,166,35,0.35)] focus-visible:border-[rgba(245,166,35,0.9)]",
                    ].join(" "),
              ].join(" ")}
              onClick={handleCopy}
              style={{
                height: 22,
                padding: "0 10px",
                fontSize: 11,
                letterSpacing: 0.4,
                fontFamily: "ui-monospace, monospace",
                fontWeight: 500,
              }}
              type="button"
            >
              {copied ? (
                <Check aria-hidden size={11} strokeWidth={2} />
              ) : (
                <LinkIcon aria-hidden size={11} strokeWidth={2} />
              )}
              <span>{copied ? "copied" : "copy link"}</span>
            </button>
          </div>
        </header>

        <section
          className={`min-h-0 overflow-hidden transition-colors duration-700 ${
            isPast ? "bg-[var(--past-bg)]" : "bg-[var(--editor-bg)]"
          }`}
        >
          {children}
        </section>

        <footer className="border-t border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          {timeline}
        </footer>
      </main>
    </>
  );
}
