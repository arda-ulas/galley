import { DraftPage } from "./pages/DraftPage";
import { UnavailableLink } from "./components/UnavailableLink";
import { parseRoute } from "./lib/route";

/**
 * M4 S5 route resolution. The pathname is resolved through the typed route model
 * (`parseRoute`): the root path is the local draft; every other path renders the
 * neutral unavailable surface. A well-formed `/{sheetId}` is RECOGNIZED as a
 * sheet route but stays DORMANT in this build — it renders the same neutral
 * surface, makes no server contact, and asserts no existence or connection
 * state. S6 activates shared routes (join, provider attach, live view); the
 * prototype provider/presence source remains unimported for those milestones.
 */
export function App() {
  const route = parseRoute(window.location.pathname);
  if (route.kind === "draft") {
    return <DraftPage />;
  }
  // `sheet` (dormant until S6) and `unavailable` share the neutral surface.
  return <UnavailableLink />;
}
