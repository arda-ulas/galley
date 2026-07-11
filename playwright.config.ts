import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Single worker is retained for deterministic ordering; multi-client tests
  // arrive with M4/M7. The M1 local draft never connects, so no collaboration
  // server is started here. In dev, Vite may open its own same-origin HMR
  // socket; the app opens no collaboration/application socket (see draft.spec).
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: [
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
