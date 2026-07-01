import type { SessionIdentity } from "./useSessionIdentity";

export type PresenceUser = {
  id: string;
  name: string;
  color: string;
  status: "editing" | "viewing" | "idle" | "offline";
  isLocal?: boolean;
};

const COLLABORATOR_COLOR = "#5BB8A0";
const COLLABORATOR_FALLBACK = "#F5A623";

// Step 10 will replace the static collaborator with Yjs awareness users.
export function usePresence(localIdentity: SessionIdentity): PresenceUser[] {
  const localUser: PresenceUser = {
    id: localIdentity.id,
    name: localIdentity.name,
    color: localIdentity.color,
    status: "editing",
    isLocal: true,
  };

  const collaboratorColor =
    localIdentity.color === COLLABORATOR_COLOR
      ? COLLABORATOR_FALLBACK
      : COLLABORATOR_COLOR;

  const demoCollaborator: PresenceUser = {
    id: "demo-collaborator",
    name: "Lin",
    color: collaboratorColor,
    status: "viewing",
    isLocal: false,
  };

  return [localUser, demoCollaborator];
}
