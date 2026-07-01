import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Single worker: all tests share the same y-websocket server and the same
  // in-memory Yjs room. Parallel execution causes cross-test awareness
  // contamination — open pages from concurrent tests inflate the avatar count.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run server",
      port: 1234,
      reuseExistingServer: false,
      timeout: 10_000,
      env: { ECHO_REWIND_TEST: "1" },
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5173/r/demo",
      reuseExistingServer: !process.env.CI,
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
