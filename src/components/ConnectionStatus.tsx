type ConnectionStatusProps = {
  status: "connecting" | "live" | "offline";
};

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  if (status === "live") {
    return (
      <div
        className="flex select-none items-center gap-1.5 rounded-full border"
        style={{
          height: 22,
          padding: "0 8px",
          borderColor: "var(--border)",
          background: "transparent",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "var(--text)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            flexShrink: 0,
            background: "var(--success)",
            boxShadow: "0 0 6px rgba(111,207,151,0.55)",
          }}
        />
        <span>Live</span>
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
