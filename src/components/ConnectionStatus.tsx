type ConnectionStatusProps = {
  status: "connecting" | "synced" | "offline";
};

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  if (status === "synced") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--success)]">
        <span className="size-1.5 rounded-full bg-[var(--success)]" />
        Live
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
        <span className="size-1.5 rounded-full border border-[var(--muted)]" />
        Connecting
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--danger)]">
      <span className="size-1.5 rounded-full bg-[var(--danger)]" />
      Offline
    </div>
  );
}
