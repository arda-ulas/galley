# Galley production image (M4.5 T4).
#
# One process serves BOTH the built client and the API/WebSocket surface, so the
# deployed app is a single origin — which is what src/lib/topology.ts assumes
# when it derives wss://<host>/ws from window.location.
#
# The SQLite database is NOT in the image. It lives on a mounted volume pointed
# at by GALLEY_DB_PATH, so the file and its -wal/-shm siblings survive a redeploy.

# Pinned to the repo's engines range (>=22.22.2 <23); node:sqlite is a built-in
# on this runtime, so there is no native module to compile.
FROM node:22.22.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.22.2-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Production deps only: the server needs ws / yjs / y-protocols / lib0 at runtime.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server

# Durable state lives here; the platform mounts a persistent volume at /data.
ENV GALLEY_DB_PATH=/data/galley.db
ENV GALLEY_STATIC_DIR=/app/dist
ENV HOST=0.0.0.0
ENV PORT=8080
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080

# Exec form: PID 1 is node itself, so SIGTERM reaches the graceful shutdown in
# server/index.mjs rather than a shell that would swallow it.
CMD ["node", "server/index.mjs"]
