import { useEffect, useState } from "react";
import * as Y from "yjs";
import type { Snapshot } from "./snapshots";

export function useSnapshots(ySnapshots: Y.Array<Snapshot>): Snapshot[] {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(() =>
    ySnapshots.toArray(),
  );

  useEffect(() => {
    function onObserve() {
      setSnapshots(ySnapshots.toArray());
    }

    ySnapshots.observe(onObserve);
    onObserve();

    return () => {
      ySnapshots.unobserve(onObserve);
    };
  }, [ySnapshots]);

  return snapshots;
}
