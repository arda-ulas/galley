type PresenceUser = {
  id: string;
  name: string;
  color: string;
  status: string;
  isLocal?: boolean;
};

type PresenceBarProps = {
  users: PresenceUser[];
};

export function PresenceBar({ users }: PresenceBarProps) {
  return (
    <div className="flex -space-x-2">
      {users.map((user) => {
        const label = user.isLocal
          ? `${user.name} · You`
          : `${user.name} · ${user.status}`;
        return (
          <div
            aria-label={label}
            className="flex size-7 items-center justify-center rounded-full border-2 text-[10px] font-semibold text-[var(--bg)]"
            key={user.id}
            style={{
              background: user.color,
              borderColor: user.isLocal ? "var(--accent)" : "var(--panel)",
            }}
            title={label}
          >
            {user.name.slice(0, 1)}
          </div>
        );
      })}
    </div>
  );
}
