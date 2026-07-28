import { DraftPage } from "./pages/DraftPage";
import { SheetPage } from "./pages/SheetPage";
import { UnavailableLink } from "./components/UnavailableLink";
import { parseRoute } from "./lib/route";

/**
 * M4 S6 route resolution. The pathname is resolved through the typed route model
 * (`parseRoute`): the root path is the local draft; a well-formed `/{sheetId}`
 * is the shared-sheet join page; every other path renders the neutral unavailable
 * surface.
 *
 * App is intentionally STATELESS and holds no route subscription: after Share
 * replaces the URL with `/{sheetId}`, App does not re-render, so the sharer stays
 * mounted on DraftPage (no remount). Direct navigation to `/{sheetId}` (new tab /
 * refresh) resolves here to SheetPage.
 */
export function App() {
  const route = parseRoute(window.location.pathname);
  if (route.kind === "draft") {
    return <DraftPage />;
  }
  if (route.kind === "sheet") {
    return <SheetPage sheetId={route.sheetId} />;
  }
  return <UnavailableLink />;
}
