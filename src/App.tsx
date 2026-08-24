import { useEffect, useState } from "react";
import { DraftPage } from "./pages/DraftPage";
import { SheetPage } from "./pages/SheetPage";
import { UnavailableLink } from "./components/UnavailableLink";
import { parseRoute } from "./lib/route";

/**
 * Route resolution (M4 S6; `popstate` added in M4.5 T2 / DEF-8). The pathname is
 * resolved through the typed route model (`parseRoute`): the root path is the
 * local draft; a well-formed `/{sheetId}` is the shared-sheet join page; every
 * other path renders the neutral unavailable surface.
 *
 * **The no-remount Share invariant is preserved.** App subscribes to `popstate`
 * ONLY — the event the browser fires for Back/Forward. It does not poll the
 * address bar and does not observe `history.replaceState`, which is what Share
 * calls (`replaceUrlWithSharedSheet`) and which by specification dispatches no
 * `popstate`. So after Share swaps the URL to `/{sheetId}` the pathname in state
 * is deliberately stale, App does not re-render, and the sharer stays mounted on
 * DraftPage with its editor, selection, and undo history intact.
 *
 * The subscription exists for the case the S6 build could not handle: a user who
 * navigates away and presses Back, or who moves between two sheet URLs in
 * history. Before this, `window.location.pathname` was read at render time only,
 * so Back/Forward changed the address bar while the page kept rendering the
 * previous route.
 */
export function App() {
  // Seeded from the pathname at mount and advanced ONLY by `popstate`. Reading
  // `window.location.pathname` on every render would defeat the invariant above.
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const route = parseRoute(pathname);
  if (route.kind === "draft") {
    return <DraftPage />;
  }
  if (route.kind === "sheet") {
    // Not keyed: Back/Forward BETWEEN two sheet URLs is handled inside SheetPage,
    // whose open effect already claims a fresh generation per `sheetId` change,
    // aborts the prior open, and disposes any controller it published.
    return <SheetPage sheetId={route.sheetId} />;
  }
  return <UnavailableLink />;
}
