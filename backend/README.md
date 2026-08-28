# Keystone backend

The backend is a six-container Compose application:

| Service | Ownership |
|---|---|
| `init` | Applies checksum-verified forward migrations, loads synthetic App fixtures, provisions the constrained runtime role, and exits. |
| `api` | Fastify auth, validation, tenant-scoped queries, proposal decisions, and durable job submission. |
| `worker` | Redis consumer-group delivery, stale-message reclaim, bounded job attempts, sync, invariants, reconciliation, and structured health/logging. |
| `postgres` | System of record for mirror, lineage, canonical data, conflicts, jobs, proposals, spend, alerts, and audit. |
| `queue` | Redis Stream transport with AOF; never the durable source of job truth. |
| `frontend` | Non-root nginx static server and same-origin `/api` reverse proxy. |

Use only the backend-owned wrapper from the repository root:

```sh
./backend/docker/compose.sh config --quiet
./backend/docker/compose.sh up --detach --build --wait
./backend/docker/compose.sh ps
./backend/docker/compose.sh logs api worker
```

The wrapper uses tracked `docker/compose.yaml`, creates ignored `docker/.env` from `.env.example` if absent, and optionally reads ignored `docker/compose.local.yaml`. Do not put shared requirements into either ignored file.

Postgres and Redis are internal-only in tracked topology. App containers run non-root, read-only, with all Linux capabilities dropped, no-new-privileges, bounded PIDs/resources, tmpfs scratch space, explicit health checks, and graceful worker shutdown. Sibling connections use `postgres`, `queue`, and `api`, never `localhost`.

## Lifecycle

1. Run `npm run seed -- --seed 424242` before building from a clean checkout.
2. `init` waits for Postgres, checks migration hashes, loads all three synthetic App generations, creates the demo tenant, and re-applies least-privilege grants.
3. API and worker wait for successful initialization and healthy Redis.
4. Frontend waits for API health.
5. A job is inserted in Postgres before Redis publication. The worker acknowledges its stream message only after a durable terminal update; queued/retry-wait jobs are republished and idle messages reclaimed.

The worker exposes an internal health listener on port 3001. API `/health` reports DB, queue, and all adapters separately. Logs are structured JSON and redact trigger/client headers.

## Ephemeral Cloudflare demo image

`../backend/cloudflare/Dockerfile` is intentionally separate from the six-container Compose topology. It is a Linux/amd64 all-in-one image for the synthetic Cloudflare demo only: it starts Postgres/pgvector, Redis, the current API, and the current worker in one namespace. The exception to normal service-DNS guidance is explicit and contained: Postgres and Redis bind to `127.0.0.1` so neither is reachable through Container ingress; only the API listens on 8080.

The entrypoint removes its own fixed `/tmp/keystone-*` data roots on every process start, initializes a new Postgres cluster, applies the existing forward migrations through `init`, starts dependencies, runs the deterministic sync/reconcile bootstrap, and only then creates the sentinel required by public `/ready`. The bootstrap asserts the fixed 12,000-record and 305-conflict representative baseline without applying the portable-runtime performance threshold from `suite`; the release workflow separately runs that gate. A startup failure prints bounded Postgres/bootstrap logs and exits; it never marks a partial bootstrap ready. This image has no volumes and must never be described as durable.

Run the isolated image regression with:

```sh
npm run test:cloudflare-image
```

It proves the Linux/amd64 build, readiness, live sync/reconcile totals, reviewer-state loss on restart, and deterministic baseline restoration. It creates and removes only its own test container.

## Data ownership

Initialization SQL under `services/database/init/` runs only for a new volume. Never edit it to simulate an application migration. Immutable migrations live under `services/database/migrations/` and are checksum-verified by `init`; add the next numbered file for changes.

The synthetic source schema `source_app` is deliberately separate. The runtime role receives `SELECT` only there. Its public-schema writes are limited to Keystone-owned state; update/delete are revoked on source mirror, lineage, and audit tables. The API exposes no arbitrary SQL or source write route.

See [services/api/README.md](services/api/README.md), [services/database/SCHEMA.md](services/database/SCHEMA.md), and the root [ARCHITECTURE.md](../ARCHITECTURE.md).
