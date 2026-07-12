import { defineConfig } from "vitest/config";

// Server/database integration tests. Node environment (no jsdom, no React
// plugin, no client setup file), kept fully separate from the jsdom unit suite
// (`vitest.config.ts`). Run via `npm run test:integration`.
//
// Each test uses its own `fs.mkdtemp` directory, so file-level parallelism is
// safe. Durability tests are file-backed only; `:memory:` is rejected by the
// harness guard.
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.mjs"],
    globals: false,
  },
});
