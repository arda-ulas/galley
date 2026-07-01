import { useEffect, useState } from "react";
import type { SessionIdentity } from "./useSessionIdentity";
import { connectRoom, provider } from "./room";

export type PresenceUser = {
  id: string;
  name: string;
  color: string;
  status: "editing" | "viewing" | "idle" | "offline";
  isLocal?: boolean;
};

type AwarenessUser = {
  id: string;
  name: string;
  color: string;
  status: "editing" | "viewing" | "idle" | "offline";
};

function isAwarenessUser(v: unknown): v is AwarenessUser {
  if (typeof v !== "object" || v === null) return false;
  const u = v as Record<string, unknown>;
  return typeof u.id === "string" && typeof u.name === "string" && typeof u.color === "string";
}

function readUsers(localId: string): PresenceUser[] {
  const seen = new Set<string>();
  const users: PresenceUser[] = [];

  provider.awareness.getStates().forEach((state) => {
    const u = (state as Record<string, unknown>).user;
    if (!isAwarenessUser(u) || seen.has(u.id)) return;
    seen.add(u.id);
    users.push({
      id: u.id,
      name: u.name,
      color: u.color,
      status: u.status ?? "viewing",
      isLocal: u.id === localId,
    });
  });

  // Local user always appears first
  users.sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0));
  return users;
}

export function usePresence(localIdentity: SessionIdentity): PresenceUser[] {
  const { id, name, color } = localIdentity;

  const [users, setUsers] = useState<PresenceUser[]>(() => [
    { id, name, color, status: "editing", isLocal: true },
  ]);

  useEffect(() => {
    connectRoom();

    // Broadcast this tab's identity so other tabs can render our avatar.
    // isLocal is NOT broadcast — each tab derives it locally by comparing ids.
    provider.awareness.setLocalStateField("user", {
      id,
      name,
      color,
      status: "editing",
    });

    function onAwarenessChange() {
      setUsers(readUsers(id));
    }

    provider.awareness.on("change", onAwarenessChange);

    // Read immediately to pick up any states already present (e.g. on remount)
    onAwarenessChange();

    return () => {
      provider.awareness.off("change", onAwarenessChange);
      // Intentionally NOT calling setLocalState(null) here:
      // React StrictMode double-mounts would cause the local avatar to flicker
      // out of other tabs for a moment. The server cleans up stale awareness
      // states when the WebSocket closes.
    };
  }, [id, name, color]);

  return users;
}
