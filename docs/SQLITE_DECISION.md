# SQLite Toolchain Decision

## Status
- **Implemented** for the current reconstruction server/persistence foundation (`node:sqlite`, WAL, `synchronous = FULL`, per-sheet write queue), through commit `3214cef`.
- **Scope:** local/repository persistence for the reconstruction — **not** a production-readiness claim. Future migration or deployment concerns remain outside current scope.
- **Origin:** decided in milestone M0b (SQLite / toolchain decision spike); the rationale below is unchanged.

## Context

- **Galley server shape:** a single hand-rolled Node process (`server/index.mjs`, ESM, `"type": "module"`) that will gain a persistence boundary in M2. One node, one process, no external service (`docs/RECONSTRUCTION_ARCHITECTURE.md` §7, §20).
- **Durability contract:** `Shared · saved` is legal only after a SQLite transaction has committed under WAL + `synchronous = FULL` and the committed state vector + metadata revision cover the client's current state (architecture §6–§8). The persistence layer must make a **truthful durable acknowledgement** — the commit must be complete before the ack is emitted.
- **Expected workload:** two-person collaboration, debounced writes, low write volume. One authoritative in-memory `Y.Doc` per sheet; the durable store holds one full encoded Yjs state blob per sheet, one metadata record, bounded text-only version rows, and idempotency records (architecture §7, §18).
- **Architecture constraints (already approved):** WAL + `synchronous = FULL`; parameterized statements only; a `schema_version` table + forward-only migrations; a **per-sheet serialized write queue/mutex**; monotonic server revision; startup reconstruction into an in-memory `Y.Doc`; corrupt-state handling; **file-backed** integration tests; configurable DB path under `TEST_MODE`.

## Requirements

The toolchain must support, verifiably:

1. **WAL** journal mode.
2. **`PRAGMA synchronous = FULL`.**
3. **Parameterized queries** (positional and/or named binding; no string interpolation).
4. **Transactions** with explicit begin/commit/rollback.
5. **Blob storage** for the encoded Yjs state (`Uint8Array` in and out).
6. **File-backed restart tests** (write → close → reopen → read; and hot-WAL recovery after abrupt exit).
7. **Migrations** (a schema-version table, forward-only, transactional).
8. **Deterministic integration testing** under a real `npm run test:integration` with a temporary file DB.
9. **Low operational complexity** — nothing to run or deploy beyond the Node process; ideally nothing to *build*.

## Options considered

### Option A — `node:sqlite` (Node built-in) — RECOMMENDED

- **Runtime requirements:** built into Node; **introduced in Node v22.5.0** as experimental, behind the `--experimental-sqlite` flag. The flag was **still required as of Node 22.12**, and `node:sqlite` became usable **without the flag starting in Node 22.13**. On the chosen Node 22 runtime it remains **experimental / in active development** (the API "might change at any time" and importing it emits an `ExperimentalWarning`). Not available on Node < 22.5, so it is unusable on Node 20 LTS.
- **API model:** **synchronous** — `DatabaseSync` and `StatementSync`. Native ESM named import: `import { DatabaseSync } from 'node:sqlite'`. Methods verified in-runtime (Node 22.22.2): `DatabaseSync` → `open, close, prepare, exec, function, aggregate, location, createSession, applyChangeset, enableLoadExtension, loadExtension`; `StatementSync` → `run, get, all, iterate, columns, setReadBigInts, …`.
- **Install characteristics:** **zero** — no npm dependency, no `node-gyp`, no `prebuild-install`, no native addon. It ships with Node.
- **Strengths:**
  - Nothing to install or compile for the database engine.
  - Synchronous API is the ideal fit for the per-sheet serialized write queue and the durable ack: when `exec('COMMIT')` returns successfully, the transaction is durably committed, so the ack can be emitted immediately with no async interleaving splitting a transaction.
  - Native ESM import (matches the `"type": "module"` server).
  - No third-party maintenance surface; it tracks the Node runtime.
  - **Verified in this runtime:** WAL on a real file (`journal_mode = wal`), `synchronous = FULL` (`= 2`), `Uint8Array` blob round-trip, prepared statements, `BEGIN`/`COMMIT`, explicit `close()`, and write→close→reopen restart persistence.
- **Weaknesses:**
  - **Experimental / in active development.** The API may change across Node versions; the `ExperimentalWarning` is expected and meaningful.
  - No built-in `db.transaction(fn)` helper — begin/commit/rollback must be wrapped in a small **synchronous** app-level helper.
  - Requires Node ≥ 22.13 to run flag-free, so the repo **must pin Node** (it currently does not).
  - **Coupling type: runtime / API-version.** Behavior is tied to the exact Node version, not to a package version.

### Option B — `better-sqlite3` (npm native addon) — documented fallback, not implemented

- **Runtime requirements (npm registry, verified 2026-07-11):** current published version **12.11.1** (`12.11.2` is **not** published — registry E404); `engines.node`: `20.x || 22.x || 23.x || 24.x || 25.x || 26.x`. Broader Node floor than `node:sqlite` (works on Node 20).
- **API model:** **synchronous** (`import Database from 'better-sqlite3'`; CJS consumed via ESM default-import interop). Mature and **actively maintained**; stable, well-documented API with a convenient `db.transaction(fn)` helper and `db.pragma()`.
- **Install characteristics:** native addon (depends on `bindings` + `prebuild-install`). On **common LTS platforms — including Apple Silicon (darwin-arm64) and linux-x64 — it generally installs from a prebuilt binary**; `node-gyp` compilation (needs Python + a C++ toolchain) is the **fallback path** used when no prebuilt matches the platform/Node ABI, not the normal path on supported combinations.
- **Strengths:** battle-tested, stable API; excellent transaction/pragma ergonomics; broad Node support; large production track record.
- **Weaknesses:**
  - **Coupling type: package / native ABI.** Each new Node major needs a matching prebuilt; a Node upgrade can require a matching `better-sqlite3` release.
  - **Prebuilt-binary fallback risk:** on an uncommon platform, or a brand-new Node major before a matching prebuilt is published, install falls back to a toolchain compile. This is a **bounded risk, not an inevitable failure** — supported LTS combinations get prebuilts.
  - Adds a dependency and a native surface to the project.

### Option C — other embedded SQLite packages (`sql.js`, `sqlite3`, `bun:sqlite`)

- **Not competitive here.** `sql.js` is WASM and does not persist to a real file with the WAL/`FULL` durability semantics the contract needs. `sqlite3` (node-sqlite3) is an **asynchronous** callback native addon — a worse fit for the synchronous write queue and durable ack, with the same native-build considerations. `bun:sqlite` requires the Bun runtime, which this project does not use. None are considered further.

## Decision matrix

| Criterion | `node:sqlite` (A) | `better-sqlite3` (B) |
|---|---|---|
| Runtime compatibility (this repo) | ✅ Node ≥ 22.13 flag-free (repo runs 22.22.2) | ✅ Node 20–26 |
| API stability | ⚠️ Experimental / active development | ✅ Stable, mature, actively maintained |
| Install reliability | ✅✅ Nothing to install/build | ✅ Prebuilt on common LTS incl. Apple Silicon; node-gyp is fallback |
| Coupling | Runtime / Node core API version | Package / native ABI |
| Sync/transaction ergonomics | ✅ Sync; manual (synchronous) begin/commit helper | ✅✅ Sync; built-in `transaction()` |
| Testability (file/restart/fault) | ✅ Explicit open/close | ✅ Equivalent |
| Native-build risk | ✅✅ None | ⚠️ Bounded prebuilt-fallback risk on unsupported combos |
| Maintenance / upgrade risk | ⚠️ Tracks experimental Node API | ⚠️ Node-ABI coupling; third-party release cadence |
| ESM fit | ✅ Native named import | ➖ CJS via default-import interop |
| Fit for this project | ✅✅ Single-node, low-volume, clone-and-run | ✅ Works; adds native surface |

Both meet every hard requirement (verified for A in-runtime; established for B). The differentiators are **zero install/native surface** (favor A) versus **API stability** (favors B). For a single-node, low-write-volume, portfolio-reviewed, clone-and-run project already on Node 22, the zero-build property outweighs the experimental status, which is bounded by pinning the exact Node runtime and isolating DB access behind one adapter. `better-sqlite3` is retained as a **contained fallback** — swapping to it changes one module, not the application contracts.

## Decision

**Adopt `node:sqlite` (the Node built-in).**

- **Package or built-in module:** built-in `node:sqlite`. **No dependency is added.**
- **Package version policy:** none (no package). Behavior is governed by the **Node version pin** (below); the experimental API is bounded to the pinned runtime.
- **Sync/async model:** **synchronous** (`DatabaseSync` / `StatementSync`). Writes block the single Node thread; at this workload that is negligible and simplifies transactional correctness and the durable ack.
- **Import style:** `import { DatabaseSync } from 'node:sqlite';` (native ESM).
- **Connection ownership:** **one `DatabaseSync` handle per server process**, owned by a single persistence adapter (§ Adapter boundary). WAL permits concurrent readers; the app-level per-sheet serialized write queue provides single-writer ordering. Open at startup, close on shutdown.
- **Transaction strategy:** see § Transaction semantics.
- **Prepared statement policy:** prepare once and reuse (cache statements on the adapter). **Parameterized only** — positional `?` or named parameters; never string interpolation.
- **WAL/FULL initialization:** immediately after opening the connection, run `PRAGMA journal_mode = WAL;`, `PRAGMA synchronous = FULL;`, and a small `PRAGMA busy_timeout = <ms>;` (robustness during test open/close churn). Optionally `PRAGMA foreign_keys = ON;` if FKs are used.
- **Shutdown behavior:** `db.close()` on `SIGINT`/`SIGTERM` and normal exit; a graceful last-connection close normally checkpoints and cleans up the WAL/SHM sidecars. An explicit shutdown checkpoint is **not** required (see § WAL durability). Idempotent close guard.
- **Test database strategy:** file-backed temp DB per integration run via `fs.mkdtemp`, path injected through an env var honored only in `TEST_MODE`; see § M2 integration-test contract.

## Transaction semantics

- The transaction helper takes a **synchronous** callback. **No `await` may appear inside `BEGIN … COMMIT`** — an async boundary inside a transaction risks interleaving other work between statements and breaks the "commit means durable" guarantee.
- Use explicit **`BEGIN IMMEDIATE`** to take the write lock upfront (correct for the write queue; avoids deferred-lock upgrade failures), then run the callback, then `COMMIT`.
- On any throw, `ROLLBACK` and rethrow. A **failed `COMMIT` must reject and propagate** — it is never swallowed, and the durable ack is not emitted.
- **A durable write is acknowledged only after a successful `COMMIT`.** No WAL checkpoint is required before acknowledging a committed transaction — under `synchronous = FULL`, a returned `COMMIT` is durable within SQLite's guarantees.
- All writes that must be coherent (current state + metadata + versions + retention + idempotency, per architecture §8/§10/§11) run inside one such transaction.

## WAL durability

- In WAL mode, the **`-wal` file is part of the durable database state until checkpointed.** Committed data may live in `-wal` (and the `-shm` index) rather than the main `.db` until a checkpoint folds it in.
- The `-wal` (and `-shm`) sidecars **must remain paired with the main database** after an abnormal exit; on reopen, SQLite recovers committed transactions from a hot `-wal`.
- **Never copy, move, reset, or delete only the main `.db`.** Operate on the whole set (`.db` + `-wal` + `-shm`) or none.
- A **graceful last-connection close normally checkpoints and cleans up** the WAL/SHM files — so the `-wal` need not still exist after a clean shutdown.
- An **explicit shutdown checkpoint is not required** for this project.
- "Durable" here means within SQLite / filesystem / VFS guarantees under `synchronous = FULL` — **not** protection from media failure, a broken/lying filesystem, or hardware loss. This is durable application state, not a backup.

## Node version policy

- **Exact Node requirement:** **Node 22.22.2**, bounded to the Node 22 line.
- **Pin files/fields (added in the first M2 bootstrap commit, not now):**
  - `.nvmrc`: `22.22.2`
  - `package.json`: `"engines": { "node": ">=22.22.2 <23" }`
  - `.node-version`: **not needed** (`.nvmrc` + `engines` are sufficient).
- **CI / runtime target:** Node **22.22.2** (the exact pinned runtime). Maintainers and CI should use it.
- **Why bounded to `<23`:** `node:sqlite` is **still experimental on Node 22** and its API may change; a floor at the tested `22.22.2` and a ceiling below `23` keeps the experimental surface on a single, tested runtime. **Node 24+ is unsupported until separately tested in CI** — it is further along but still not a stable `node:sqlite`, so it must be validated before the range is widened.
- **Why pinning is now required (not optional):** the built-in `node:sqlite` is experimental and requires Node ≥ 22.13 flag-free; the pin prevents an accidental Node 20 (no `node:sqlite`) or an untested newer major, and makes CI deterministic.
- **When to add:** at the **start of M2**, before any code imports `node:sqlite`.

## Experimental-warning policy

- **Do not suppress the Node experimental warning** — not in development, not in tests, not in server scripts. The earlier `--disable-warning=ExperimentalWarning` recommendation is **removed**.
- Contributors should **expect** the `ExperimentalWarning` when the server starts; it is relevant precisely because the selected API is not yet stable.
- Suppressing it would also hide **unrelated** warnings of the same category (`ExperimentalWarning`), reducing signal during development.

## Adapter boundary

- **Exactly one persistence adapter/module imports `node:sqlite`.** No other file in the codebase imports it.
- That adapter owns:
  - connection **open**,
  - connection **close**,
  - **synchronous transaction execution** (the `BEGIN IMMEDIATE … COMMIT` helper),
  - **migration execution**,
  - **repository operations** (the typed read/write methods used by the server).
- **SQL is centralized in the adapter and parameterized.** No SQL text or binding lives in higher layers.
- Higher application layers (sheet lifecycle, ack emission, versions, retention) call the adapter's typed methods and **remain independent of the selected binding**.
- **Replacing the adapter's internals with `better-sqlite3` must not change any higher-layer contract** — same method signatures, same behavior. This is the fallback seam.
- Keep it a plain module, not an elaborate abstraction framework.

## Security / correctness guarantees (required of M2)

- **Parameter binding for every dynamic value**; **no SQL string interpolation** anywhere.
- **Controlled DB path** — resolved by the server; only overridable via the `TEST_MODE` env seam.
- **Schema versioning** via a `schema_version` table; forward-only migrations run transactionally.
- **Clear surfacing of corruption and open failures** — open errors, migration errors, commit errors, and corrupt-state detection are propagated with actionable messages.
- **No silent in-memory fallback** — the server never quietly substitutes `:memory:` when a file DB is unavailable; it fails loudly.
- **No automatic destructive recovery** — a corrupt or schema-incompatible database is never silently deleted/recreated.
- **Reset is unavailable outside `TEST_MODE`** — the durable reset seam exists only under `TEST_MODE`.

## M2 implementation contract

M2 must:

1. **Install the selected dependency if external** — **not applicable**; `node:sqlite` is built in. No `package.json`/lockfile change for the DB engine.
2. **Introduce the Node pin** — add `.nvmrc` (`22.22.2`) and `engines.node` (`">=22.22.2 <23"`) as the first M2 change, before importing `node:sqlite`.
3. **Create `npm run test:integration`** — a Node-environment test runner plus the `vitest` include for server/integration tests. No persistence commit may precede this command's existence.
4. **Create a file-backed temporary DB harness** (see integration-test contract).
5. **Add a `schema_version` table** and forward-only migrations.
6. **Run migrations at startup, transactionally**; a migration failure **aborts startup**.
7. **Set WAL and `synchronous = FULL`** on every connection open.
8. **Verify pragmas in tests** — assert `journal_mode = wal` and `synchronous = 2` on a file-backed DB.
9. **Use prepared statements only** — parameter binding everywhere; no interpolation.
10. **Expose an explicit open/close lifecycle** on the adapter.
11. **Support restart testing** — graceful close/reopen persistence, and hot-WAL recovery after abrupt exit.
12. **Support persistence-failure injection** — a seam to force a commit/open failure with transport still live (architecture §6 storage-failure state).
13. **Keep the DB path configurable in `TEST_MODE`**, and ensure the durable reset clears the test database (only under `TEST_MODE`; never in normal mode).
14. **Isolate all DB access behind the single adapter** (§ Adapter boundary), so any future `node:sqlite` API change — or a swap to `better-sqlite3` — is contained to one file.

### M2 integration-test contract (mandatory)

- **File-backed DB only for durability/restart tests.** `:memory:` is **explicitly rejected** for any durability/restart test (it cannot exercise WAL, `-wal` recovery, or on-disk persistence). A guard/assertion enforces this.
- **Unique temporary directory per test worker/run** (`fs.mkdtemp`), so runs never share a file.
- **Retain the full directory** — main `.db`, `-wal`, and `-shm` — through reopen/recovery within a test.
- **Close all handles before cleanup**; then remove all DB sidecars and the directory during teardown.
- **Graceful close/reopen persistence test:** write under WAL+FULL, close cleanly, reopen, assert state (the `-wal` may be absent after a clean close — that is expected).
- **Child-process abrupt-exit recovery test (the hot-WAL recovery proof):** in a child process, commit a WAL+FULL transaction, then abruptly terminate the process **without** a graceful close; the parent reopens the same directory and must **recover the committed state** and pass **`PRAGMA integrity_check`**.
- **Migrations run transactionally; migration failure aborts startup.**
- **Surface open, migration, commit, and corruption errors**; **never silently fall back to in-memory**; **never destructively recreate** a corrupt or incompatible database.
- **Deterministic test isolation**; **`TEST_MODE`-only** configurable DB path and reset behavior.

## Rejected alternatives

- **`better-sqlite3` as the *primary* engine** — rejected for this project because it adds a native addon and Node-ABI/native-package coupling to a clone-and-run portfolio server; retained as the **documented, un-implemented fallback** behind the adapter seam.
- **`sqlite3` (node-sqlite3)** — asynchronous callback API (poor fit for the synchronous write queue and durable ack) plus a native addon. Rejected.
- **`sql.js` (WASM)** — no real file persistence with WAL/`FULL` durability semantics. Rejected.
- **`bun:sqlite`** — requires the Bun runtime, not used here. Rejected.
- **Any external database (Postgres/Redis/etc.)** — out of scope; violates the single-node, no-service constraint. Rejected.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Experimental `node:sqlite` API changes on a Node upgrade** | Pin Node to `22.22.2` bounded `<23`; isolate all DB access behind one adapter; integration tests assert pragmas, round-trip, and hot-WAL recovery and will catch regressions before merge. `better-sqlite3` is the contained fallback. |
| **Native-addon install failure** | Eliminated for the DB engine by choosing the built-in (no native addon). |
| **Node version drift (e.g., a Node 20 or untested 24+ environment)** | `engines.node ">=22.22.2 <23"` + `.nvmrc`; CI runs the exact pin; the server fails fast if `node:sqlite` is absent. Node 24+ requires separate CI validation before support. |
| **`await` inside a transaction** | Transaction helper takes a synchronous callback; no `await` inside `BEGIN…COMMIT`; reviewed and testable. |
| **Blocking synchronous calls stall the event loop** | Two-person, debounced, sub-millisecond small-blob writes; acceptable and simpler than async. Keep blobs bounded (architecture §7). |
| **Database corruption** | WAL + `synchronous = FULL`; corrupt-state handling marks a sheet unavailable rather than crashing; integration test covers a corrupt blob and `PRAGMA integrity_check`. |
| **Deleting only the `.db` / mishandling WAL sidecars** | Operate on the whole `.db`+`-wal`+`-shm` set; tests retain and recover the full directory. |
| **Locked files in tests** | One connection per process; `PRAGMA busy_timeout`; explicit `close()` before teardown; unique temp dir per run. |
| **CI variance** | No native binary to mismatch; the exact Node pin makes the runtime deterministic; file-backed temp DBs are hermetic. |
| **Accidental in-memory testing hiding durability bugs** | Durability/restart tests **must** use a file-backed DB; `:memory:` explicitly rejected by a guard; the abrupt-exit test proves real hot-WAL recovery. |

## Primary sources

Facts above were verified against primary sources on 2026-07-11:

- **`node:sqlite` introduction, flag history, stability (Node 22):** the Node.js documentation and release history — `node:sqlite` added in **v22.5.0** (experimental, `--experimental-sqlite`), flag **still required at v22.12**, usable **without the flag from v22.13**; the API is documented as experimental and emits an `ExperimentalWarning`. (Node.js docs: "SQLite" API reference and the v22 changelog.) Confirmed in-runtime that Node **v22.22.2** loads `node:sqlite` with no flag.
- **Node 24 `node:sqlite` stability:** the Node.js v24 documentation/changelog — `node:sqlite` is further along but not documented as a stable release feature; treat as unsupported here until CI-validated.
- **SQLite WAL behavior:** the official SQLite documentation, "Write-Ahead Logging" (`sqlite.org/wal.html`) — the `-wal`/`-shm` files hold committed data until checkpoint and are recovered on reopen.
- **SQLite `synchronous = FULL`:** the official SQLite documentation, "PRAGMA synchronous" (`sqlite.org/pragma.html#pragma_synchronous`) — `FULL` (2) syncs at critical moments so a committed transaction survives an application crash / power loss within filesystem guarantees.
- **`better-sqlite3` version and support:** the npm registry and the official GitHub repository (`WiseLibs/better-sqlite3`) — current published version **12.11.1** (verified; `12.11.2` not published), `engines` covering Node 20–26, prebuilt binaries for common LTS platforms with a `node-gyp` compile fallback.

## Required conclusion

**Approved recommendation: `node:sqlite` (Node built-in), pinned to Node 22.22.2 and bounded to `<23`, with `better-sqlite3` retained as a contained, un-implemented fallback behind a single persistence adapter.**

Every hard requirement (WAL, `synchronous = FULL`, parameterized queries, synchronous transactions, `Uint8Array` blobs, restart + hot-WAL recovery, prepared statements, explicit open/close) was verified in the repo's actual runtime or against primary sources. For a single-node, low-write-volume, clone-and-run portfolio server the zero-install / zero-native-build property outweighs the experimental status, which is bounded by the exact Node pin, the adapter isolation seam, and the durability/recovery test contract above. The fallback is documented, not implemented.
