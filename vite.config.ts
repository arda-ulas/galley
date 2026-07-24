import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Same-origin dev topology (M4 S2). The browser talks ONLY to the Vite origin
// (127.0.0.1:5173); Vite forwards the collaboration traffic to the local server
// on :1234. `src/lib/topology.ts` produces the matching relative `/api` paths
// and the `/ws` WebSocket base, so the later y-websocket provider resolves to
// exactly `/ws/{sheetId}` — the server's strict canonical route.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:1234",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:1234",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
