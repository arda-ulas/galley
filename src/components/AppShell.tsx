import { useState } from "react";
import type { ReactNode } from "react";

type AppShellProps = {
  roomId: string;
  connection: ReactNode;
  presence: ReactNode;
  timeline: ReactNode;
  isPast?: boolean;
  children: ReactNode;
};

export function AppShell({
  roomId,
  connection,
  presence,
  timeline,
  isPast = false,
  children,
}: AppShellProps) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
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
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4">
          <span className="font-mono text-xs tracking-wide text-[var(--muted)]">
            <span className="text-[var(--accent)]">↻</span> echo / {roomId}
          </span>
          <div className="flex items-center gap-3">
            {connection}
            {presence}
            <button
              className="rounded border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
              onClick={handleShare}
              type="button"
            >
              {copied ? "Copied" : "Share"}
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
