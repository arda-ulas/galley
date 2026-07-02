import type { PresenceUser } from "../lib/usePresence";

type PresenceBarProps = {
  users: PresenceUser[];
};

export function PresenceBar({ users }: PresenceBarProps) {
  return (
    <div className="flex items-center" style={{ paddingLeft: 2 }}>
      {users.map((user, i) => {
        const label = user.isLocal
          ? `${user.name} · You`
          : `${user.name} · ${user.status}`;
        return (
          <div
            aria-label={label}
            className="grid place-items-center rounded-full transition-transform duration-[120ms] ease-in-out hover:-translate-y-px"
            key={user.id}
            style={{
              width: 20,
              height: 20,
              marginLeft: i === 0 ? 0 : -4,
              background: user.color,
              color: "#0D0B09",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 0.2,
              boxShadow: user.isLocal
                ? "0 0 0 1.5px var(--panel), 0 0 0 3px var(--accent)"
                : "0 0 0 1.5px var(--panel)",
              zIndex: users.length - i,
              position: "relative",
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
