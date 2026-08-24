# Deployment Record — M4.5 T4 gate

**Purpose.** Evidence that Galley can be deployed under the architecture the approved plan assumes.
This is a gate record, not documentation of a public service. Every claim below was executed and its
output captured; nothing here is inferred.

**Authority:** `docs/IMPLEMENTATION_PLAN.md` §5.4 (T4) and §15.1 (stop condition).
**Executed:** 2026-08-24, HEAD `7d1efed` + the T4 working tree.
**Verdict:** see §7.

> **T4 proves deployment and storage feasibility only.** It does **not** prove live-edit durability.
> Post-creation WebSocket edits are still relayed and never persisted — that is milestone M5, which
> has not been implemented. §6 records that gap empirically rather than leaving it implied.

---

## 1. Target host and topology

T4 was executed against a **local containerised deployment** that reproduces the two architectural
properties the gate exists to test — a persistent volume and a single writer — behind a real
TLS-terminating reverse proxy.

| Aspect | Value |
|---|---|
| Platform | Docker Engine 29.0.1 (Docker Desktop, darwin/arm64) |
| Orchestrator | Docker Compose v2.40.3 — `deploy/docker-compose.yml`, project `galley-t4` |
| App image | `Dockerfile` (multi-stage), `node:22.22.2-bookworm-slim`, PID 1 = `node server/index.mjs` |
| App replicas | **1** (`deploy.replicas: 1`, `restart: "no"`) |
| Deploy strategy | **stop-then-start** (`docker compose up -d --force-recreate`) |
| TLS proxy | Caddy 2.10-alpine, `local_certs`, `https://galley.localhost:8443` |
| Proxy address | **static `172.31.77.10`** on a fixed `172.31.77.0/24` bridge network |
| Persistent volume | Docker named volume `galley-t4_galley-data` → `/data` |
| Host volume path | `/var/lib/docker/volumes/galley-t4_galley-data/_data` (driver `local`) |

**Routing topology.** One origin. Caddy terminates TLS and reverse-proxies everything to `app:8080`.
The Node process dispatches `/__test/*` (test mode only) → `POST /api/sheets` →
`GET /api/sheets/:id` → **static client** → `404`. WebSocket upgrades never enter that chain at all:
`ws` consumes the HTTP server's `upgrade` event, which is a separate channel from the request
listener. The static handler additionally refuses the reserved `/api`, `/ws`, and `/__test` prefixes
outright, so precedence does not depend on ordering alone.

**Public host.** Not applied. `deploy/fly.toml` encodes the same guarantees (one machine,
`strategy = "immediate"`, `/data` volume, no autoscale, no scale-to-zero) and is ready for
`fly deploy`. It is unapplied because no cloud CLI on this machine is authenticated — see §8.

### Environment variables

| Variable | Value used | Meaning |
|---|---|---|
| `GALLEY_DB_PATH` | `/data/galley.db` | SQLite location; new in T4 |
| `GALLEY_STATIC_DIR` | `/app/dist` | Built client root |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Bind |
| `GALLEY_TRUSTED_PROXIES` | `172.31.77.10` | Exact proxy address — **not** a subnet (§5) |
| `GALLEY_TRUST_PROXY_HOPS` | `1` | One proxy in front |

---

## 2. Boot record (auditable, from the running container)

```
Galley server → http://0.0.0.0:8080
  pid          : 1
  database     : /data/galley.db
  static client: /app/dist
  trust proxy  : enabled (1 rule(s), 1 hop(s))
```

The resolved **absolute** database path is printed at boot specifically so A1 can be checked without
shelling into the container. No secrets, no database contents, and no credential material are logged.

---

## 3. Restart / redeploy procedure used

```bash
docker compose -f deploy/docker-compose.yml up -d --build --force-recreate app
```

For a single-replica service this is stop → remove → create → start. §5/A5 measures that it never
overlaps.

**Pre-redeploy probe sheet:** `7dKYZy061OyOYxzU`
**Content:** `"T4 PERSISTENCE PROBE — created before redeploy\n"` at `server_revision = 1`
**Created:** over HTTPS through the proxy (`POST https://galley.localhost:8443/api/sheets` → `201`)

---

## 4. Acceptance results

| # | Check | Result |
|---|---|---|
| **A1** | `GALLEY_DB_PATH` resolves inside the persistent mount | **PASS** |
| **A2** | db + `-wal` + `-shm` all on that volume | **PASS** |
| **A3** | A real redeploy recreates/restarts the process | **PASS** |
| **A4** | A sheet created before the redeploy is readable after | **PASS** |
| **A5** | Exactly one writer at all times, including mid-deploy | **PASS** |
| **A6** | No stale writer survives a deploy | **PASS** |
| **A7** | Direct `/{sheetId}` navigation serves the SPA | **PASS** |
| **A8** | `/api` and `/ws` win over the SPA fallback | **PASS** |
| **A9** | External HTTPS upgrades to WSS | **PASS** |
| **A10** | Trusted-proxy parsing bounded to configured peers/hops | **PASS** |
| **A11** | A direct `X-Forwarded-For` cannot spoof the client address | **PASS** |

---

## 5. Evidence

### A1 — database path inside the mount

```
boot log        : database : /data/galley.db
container env   : GALLEY_DB_PATH=/data/galley.db
docker mounts   : TYPE=volume NAME=galley-t4_galley-data DEST=/data RW=true
/proc/mounts    : /dev/vda1 /data ext4 rw,relatime,discard 0 0
```

`/data` is a real mount point and the configured path is inside it.

### A2 — db, WAL and SHM colocated on the volume

```
-rw-r--r-- 1 node node  4096 galley.db
-rw-r--r-- 1 node node 32768 galley.db-shm
-rw-r--r-- 1 node node 86552 galley.db-wal

/data/galley.db          dev=65025
/data/galley.db-wal      dev=65025
/data/galley.db-shm      dev=65025
/data (mount)            dev=65025
```

All three share the mount's device id. This holds by construction: SQLite always creates the `-wal`
and `-shm` siblings alongside the database file, so aiming one path into the volume colocates all
three — which is why `GALLEY_DB_PATH` is a single file path and not a directory plus a filename.

### A3 / A6 — process identity across the deploy

```
old container : fa9c649c3f66   host pid 1575
new container : bdde6be314bf   host pid 1874
new started   : 2026-08-24T17:50:24.672916842Z
old writer process is GONE
running app containers: 1
```

Container id and host PID both changed; the old PID is not alive.

### A4 — durability across the redeploy

```
BEFORE  server_revision: 1
        text: "T4 PERSISTENCE PROBE — created before redeploy\n"

AFTER   GET /api/sheets/7dKYZy061OyOYxzU  →  http=200
        {"sheetId":"7dKYZy061OyOYxzU","title":"t4-probe","language":"typescript",
         "schemaVersion":0,"serverRevision":1,"metadataRevision":1}

AFTER   (read directly from the volume)
        server_revision: 1
        text: "T4 PERSISTENCE PROBE — created before redeploy\n"
        rows in sheets: 62
```

Verified two independent ways: through the public HTTPS API, and by decoding the stored Yjs blob
straight out of the mounted volume.

### A5 — no writer overlap, measured during a live redeploy

A poller sampled the running app-container count every 50 ms across a full `--force-recreate`:

```
SAMPLES=36  MAX_CONCURRENT_APP_CONTAINERS=1  SAMPLES_WITH_ZERO=1
distinct sample values observed: 0 1
```

The count goes **1 → 0 → 1**. It never reaches 2. This is the positive measurement the plan asks
for, not an inference from configuration: the deploy is genuinely stop-before-start.

### A7 — direct deep link serves the SPA

```
GET https://galley.localhost:8443/7dKYZy061OyOYxzU
  status=200 type=text/html; charset=utf-8
  <div id="root"></div>
  references: /assets/index-DJI2QzyZ.js , /assets/index-MhfPdNL3.css

GET /assets/index-DJI2QzyZ.js
  status=200 type=text/javascript; charset=utf-8 bytes=753405
```

The shell is served for a route that is not a file, and the asset it references actually loads.

### A8 — API and WebSocket precedence

```
GET /api/sheets/{id}   → 200 application/json
   {"sheetId":"7dKYZy061OyOYxzU","title":"t4-probe",...}
GET /ws/{id}           → 404, body length 0, no SPA shell
GET /api/nope          → 404, no SPA shell
```

A missing asset also 404s rather than receiving the shell (`/favicon.ico` → 404), so a broken asset
reference surfaces as an error instead of a 200 of HTML with the wrong MIME type.

### A9 — HTTPS upgrades to WSS, two real browsers

Two independent Chromium browser contexts (Playwright, `ignoreHTTPSErrors` for the local CA) opened
the public HTTPS URL and converged in both directions:

```
WebSocket URLs observed:
  A: wss://galley.localhost:8443/ws/7dKYZy061OyOYxzU
  B: wss://galley.localhost:8443/ws/7dKYZy061OyOYxzU
A->B converged: true
B->A converged: true
all sockets are wss: true
pre-existing content still present: true
```

Note the client required **no build-time configuration**: the bundle contains zero hardcoded hosts
and derives `wss://<host>/ws` from `window.location` at call time, so the same artifact works on any
origin.

### A10 / A11 — bounded, non-spoofable client address

Both were measured black-box through the **rate limiter as the observable** (per-IP limit 30 per 60 s),
because it is the only consumer of the client address.

**A11 — forged header from an untrusted direct peer.** 31 requests sent directly to the app,
each carrying a *different* forged `X-Forwarded-For`:

```
mode=direct requests=31 created=30 rateLimited=1  first429At=31
```

All 31 collapsed into a single bucket. Had the forged headers been honoured, there would have been
31 distinct buckets and zero rate-limited responses. The header was ignored entirely.

**A10 — header honoured only for the configured peer.** A discriminator that distinguishes
"honoured" from "ignored" on the proxy leg:

- app's socket peer on the proxy leg = `172.31.77.10` (trusted)
- Caddy sets `X-Forwarded-For` = `172.31.77.1` (the gateway it observed)
- direct leg socket peer = `172.31.77.1` (untrusted)

```
step 1: 30 DIRECT requests           → created=30 rateLimited=0
step 2: 1 request THROUGH THE PROXY  → created=0  rateLimited=1  (429 immediately)
```

The proxy-leg request landed in the **same** bucket the direct requests filled. It could only do so
by reading Caddy's forwarded value; had it fallen back to its socket peer (`172.31.77.10`) it would
have been a fresh bucket and returned 201.

> **Configuration finding, corrected during the run.** The first topology trusted the whole compose
> subnet `172.31.77.0/24`. That is **wrong**: the Docker bridge gateway `172.31.77.1` is inside that
> range and is the source address for anything arriving through a published port — so a direct
> client would have been treated as trusted and could have spoofed freely. The fix was to give the
> proxy a static address and trust exactly `172.31.77.10`. **Any host deployment must identify the
> proxy's actual peer address and trust the tightest possible rule; never a range that could include
> client-reachable addresses.** `deploy/fly.toml` therefore ships with `GALLEY_TRUSTED_PROXIES`
> deliberately unset, which is the safe (non-spoofable, globally-bucketed) default.

---

## 6. Scope boundary — live edits are NOT durable

Measured explicitly so this record cannot be read as more than it is. A marker was typed into the
live sheet in a real browser, confirmed visible, then the app was restarted:

```
typed and visible in browser: true

durable text on the volume (server still up):
  server_revision: 1
  durable text   : "T4 PERSISTENCE PROBE — created before redeploy\n"
  contains marker: false

after restart:
  marker survived: false            <-- expected: live persistence is M5
  create-time content survived: true
```

Creation-time state is durable; post-creation WebSocket edits are not. `server_revision` stays at 1
because `db.persistState` still has no production caller. This is precisely the gap M5 exists to
close, and T4 makes no claim about it.

---

## 7. Verdict

**T4 PASS — durability assumptions supported.**

All eleven acceptance items pass. The two architectural properties M5 depends on are demonstrated,
not assumed:

1. **Persistent storage** — the SQLite database and both of its WAL/SHM siblings live on a mounted
   volume and survive a full image rebuild and container recreation (A1, A2, A4).
2. **A single writer** — measured at 1 → 0 → 1 across a live redeploy, with no sampled interval
   containing two live app containers, and the previous process confirmed dead (A3, A5, A6).

The stop condition in `IMPLEMENTATION_PLAN.md` §15.1 is **not** triggered. M5 is unblocked on the
architecture. See §8 for the one carried risk.

---

## 8. Residual risks and required follow-up

1. **The public host is not yet chosen or applied.** T4 was executed on a local containerised
   reproduction, not a hosted platform with a public URL. No deployment CLI on this machine
   (`flyctl`, `render`, `railway`, `vercel`, `netlify`, `doctl`, `heroku`, `gcloud`, `aws`, `az`) is
   installed or authenticated, so a real deploy could not be performed. The architecture is proven;
   the specific vendor is not. **Before M12, re-run §4's checks against the real host** — in
   particular A1/A2 (does the volume actually persist across a machine replacement?) and A5 (does the
   platform ever run two machines during a deploy?). `deploy/fly.toml` is the starting point.
2. **`GALLEY_TRUSTED_PROXIES` must be re-derived per host.** It is intentionally unset in
   `fly.toml`. Leaving it unset is safe but collapses the create rate limit into one global bucket.
   Setting it wrong is worse than leaving it unset — see the finding in §5.
3. **The published app port in `docker-compose.yml` is evidence-only.** `127.0.0.1:8080:8080` exists
   so the run could hit the app directly and prove A11. A real deployment must expose only the proxy.
4. **Local CA, not a public certificate.** A9 used Caddy's internal CA with
   `ignoreHTTPSErrors`/`NODE_TLS_REJECT_UNAUTHORIZED=0` on the client side. That proves the
   TLS-termination and upgrade path; it does not exercise public ACME issuance or HSTS.
5. **Bundle size.** The client ships a single 753 kB (247 kB gzip) JavaScript chunk. Not a T4 gate,
   but it is the first thing a reviewer will see over a real network. Candidate for M11.
6. **`node:sqlite` remains experimental** on Node 22 and emits an `ExperimentalWarning` at boot. This
   is the accepted, documented position of `docs/SQLITE_DECISION.md`, bounded by the pinned runtime.

---

## 9. Reproducing this record

```bash
docker compose -f deploy/docker-compose.yml up -d --build
# create a sheet over HTTPS, note its id, then:
docker compose -f deploy/docker-compose.yml up -d --build --force-recreate app
curl -sk https://galley.localhost:8443/api/sheets/{id}
docker compose -f deploy/docker-compose.yml down -v   # -v also drops the volume
```
