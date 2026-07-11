import { DraftPage } from "./pages/DraftPage";
import { UnavailableLink } from "./components/UnavailableLink";

/**
 * M1 route resolution. Only the root path is a local draft. There is no
 * shared-sheet route yet (Share is M3/M4), so every non-root path renders a
 * neutral unavailable state — no draft editor, no server contact, no
 * expired-vs-invalid cause claim, and no silent redirect to `/`. The dormant
 * prototype provider/presence/shell source remains in the tree, unimported, for
 * later milestones (M4/M5/M7); the prototype timeline architecture was removed
 * in M1c.
 */
export function App() {
  if (window.location.pathname === "/") {
    return <DraftPage />;
  }
  return <UnavailableLink />;
}
