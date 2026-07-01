import { Clock3 } from "lucide-react";
import type { ReactNode } from "react";

type AppShellProps = {
  roomId: string;
  connection: ReactNode;
  presence: ReactNode;
  timeline: ReactNode;
  children: ReactNode;
};

export function AppShell({
  roomId,
  connection,
  presence,
  timeline,
  children,
}: AppShellProps) {
  return (
    <main className="min-h-dvh overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <div className="grid h-dvh grid-rows-[52px_1fr_108px]">
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--panel)_84%,transparent)] px-4 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--accent)] shadow-[0_0_32px_rgba(115,215,255,0.08)]">
              <Clock3 size={16} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium tracking-[0.01em]">
                Echo/Rewind
              </div>
              <div className="truncate text-xs text-[var(--muted)]">
                /r/{roomId}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {presence}
            {connection}
          </div>
        </header>

        <section className="min-h-0 bg-[radial-gradient(circle_at_18%_0%,rgba(115,215,255,0.08),transparent_32%),linear-gradient(180deg,rgba(18,24,36,0.62),rgba(7,9,13,1))] p-4">
          <div className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-[0_24px_80px_rgba(0,0,0,0.34)]">
            {children}
          </div>
        </section>

        <footer className="border-t border-[var(--border-subtle)] bg-[var(--panel)] px-4 py-3">
          {timeline}
        </footer>
      </div>
    </main>
  );
}
