import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// A unique, throwaway file-backed database per Playwright launch — never the
// developer database. The collaboration-server LAUNCHER (e2e/collabServer.mjs)
// owns its deletion, deferred until the server process has fully exited, so DB
// removal is never attempted while SQLite still holds the file open. This avoids
// relying on globalTeardown running after webServer teardown (which Playwright
// does not guarantee).
const E2E_DB = path.join(os.tmpdir(), `galley-e2e-${process.pid}-${Date.now()}.sqlite`);

export default defineConfig({
  testDir: "./e2e",
  // Single worker for deterministic ordering and to keep durable reset between
  // tests race-free (M4/M7 multi-client flows share one collaboration server).
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      // Collaboration server in TEST MODE (durable reset + health endpoint on),
      // started through the launcher so the throwaway DB is deleted only AFTER
      // the server process exits. Started first so Vite's `/api` + `/ws` proxy
      // targets are already up.
      command: "node e2e/collabServer.mjs",
      env: {
        ECHO_REWIND_TEST: "1",
        GALLEY_TEST_DB_PATH: E2E_DB,
        GALLEY_E2E_DB_PATH: E2E_DB,
        HOST: "127.0.0.1",
        PORT: "1234",
      },
      // Deterministic readiness: the test-only health endpoint returns 200 only
      // once the app is fully constructed and listening (no sleep-based waits).
      url: "http://127.0.0.1:1234/__test/health",
      reuseExistingServer: false,
      timeout: 120_000,
      // Send SIGTERM (not the default SIGKILL) so the launcher can drain the
      // collaboration server, wait for its exit, and THEN delete the throwaway DB
      // before exiting. Without this the process group is hard-killed and the DB
      // (and its WAL/SHM siblings) leak.
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5173/",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
