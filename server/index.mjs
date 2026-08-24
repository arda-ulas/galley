// Thin executable entry point. All lifecycle logic lives in server/app.mjs;
// this file only constructs the application, starts it, and translates process
// signals into a single graceful shutdown. Normal shutdown never calls
// process.exit() — it sets process.exitCode and lets the event loop drain.

import { createServerApplication } from "./app.mjs";

const app = await createServerApplication(process.env);
await app.start();

const { host, port, testMode, resolvedDbPath, staticDir, trustProxy } = app.config;
const boundPort = app.address()?.port ?? port;

// Auditable boot record (M4.5 T4 acceptance A1). The resolved DATABASE PATH is
// printed so a deployment check can compare it against the mount point without
// shelling into the container. Only paths and policy shape are logged — never
// database contents, never the trusted-proxy list's provenance, never secrets.
console.log(
  `Galley server → http://${host}:${boundPort}${testMode ? " [test mode]" : ""}`,
);
console.log(`  pid          : ${process.pid}`);
console.log(`  database     : ${resolvedDbPath}`);
console.log(`  static client: ${staticDir ?? "(disabled — API/WS only)"}`);
console.log(
  `  trust proxy  : ${
    trustProxy.enabled
      ? `enabled (${trustProxy.trusted.length} rule(s), ${trustProxy.hops} hop(s))`
      : "disabled (client address = socket peer)"
  }`,
);

let shuttingDown = false;
function onSignal() {
  if (shuttingDown) return; // a second signal during shutdown is a no-op
  shuttingDown = true;
  app.shutdown().then(
    () => {
      process.exitCode = 0;
    },
    (err) => {
      console.error("shutdown failed:", err);
      process.exitCode = 1;
    },
  );
}

process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
