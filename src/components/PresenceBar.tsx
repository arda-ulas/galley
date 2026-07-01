type PresenceUser = {
  id: string;
  name: string;
  color: string;
  status: string;
};

type PresenceBarProps = {
  users: PresenceUser[];
};

export function PresenceBar({ users }: PresenceBarProps) {
  return (
    <div className="flex -space-x-2">
      {users.map((user) => (
        <div
          aria-label={`${user.name} · ${user.status}`}
          className="flex size-7 items-center justify-center rounded-full border-2 border-[var(--panel)] text-[10px] font-semibold text-[var(--bg)]"
          key={user.id}
          style={{ background: user.color }}
          title={`${user.name} · ${user.status}`}
        >
          {user.name.slice(0, 1)}
        </div>
      ))}
    </div>
  );
}
