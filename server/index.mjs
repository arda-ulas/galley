// Thin executable entry point. All lifecycle logic lives in server/app.mjs;
// this file only constructs the application, starts it, and translates process
// signals into a single graceful shutdown. Normal shutdown never calls
// process.exit() — it sets process.exitCode and lets the event loop drain.

import { createServerApplication } from "./app.mjs";

const app = await createServerApplication(process.env);
await app.start();

const { host, port, testMode } = app.config;
const boundPort = app.address()?.port ?? port;
console.log(
  `Echo/Rewind WS server → ws://${host}:${boundPort}${testMode ? " [test mode]" : ""}`,
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
