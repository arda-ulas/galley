import { Wifi } from "lucide-react";

type ConnectionStatusProps = {
  status: "connecting" | "synced" | "offline";
};

const statusCopy = {
  connecting: "Connecting",
  synced: "Synced",
  offline: "Offline",
};

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-1.5 text-xs text-[var(--muted)]">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-[var(--success)] opacity-30" />
        <span className="relative inline-flex size-2 rounded-full bg-[var(--success)]" />
      </span>
      <Wifi size={13} strokeWidth={1.8} />
      <span>{statusCopy[status]}</span>
    </div>
  );
}
