import { DraftPage } from "./pages/DraftPage";
import { UnavailableLink } from "./components/UnavailableLink";

/**
 * M1 route resolution. Only the root path is a local draft. There is no
 * shared-sheet route yet (Share is M3/M4), so every non-root path renders a
 * neutral unavailable state — no draft editor, no server contact, no
 * expired-vs-invalid cause claim, and no silent redirect to `/`. The prototype
 * room/timeline/presence source remains in the tree, unimported, for M1c.
 */
export function App() {
  if (window.location.pathname === "/") {
    return <DraftPage />;
  }
  return <UnavailableLink />;
}
