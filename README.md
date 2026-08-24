# Keystone

Keystone is a synthetic, end-to-end reconciliation trust layer for a CRM, an application Postgres database, and a payments system. It mirrors each source through a read-only adapter, preserves field-level lineage, evaluates 14 deterministic invariants, and creates proposal-only remediation plans behind hard spend and human-review gates.

No real PII, credentials, provider calls, or source-system writes are required. The default dataset, client keys, provider, and price table are deterministic fixtures.

## Quick start from a clean checkout

Prerequisites: Docker with Compose v2, Node.js 24+, and npm 11+.

```sh
npm ci
npm run seed -- --seed 424242
npm run compose:up
npm run suite
```

Open [http://localhost:4173](http://localhost:4173). The default direct API is [http://localhost:3000](http://localhost:3000); change `API_PORT` or `FRONTEND_PORT` in the ignored `backend/docker/.env` if those ports are occupied. The Compose wrapper creates that file from the runnable, secret-free `backend/docker/.env.example` when needed.

The first `suite` run submits a durable sync job, waits for all 120,000 records and their invariants, submits reconciliation, and prints a machine-readable pass/fail scorecard. Repeated runs use stable idempotency keys and return the same durable results.

### Synthetic demo credentials

| Scope | Header/value |
|---|---|
| Read-only dashboard/API | `x-keystone-client-key: fixture-demo-client-key-only` |
| Reviewer dashboard/API | `x-keystone-client-key: fixture-demo-reviewer-key-only` |
| Sync trigger | `x-keystone-trigger-secret: fixture-sync-trigger-secret-only` |
| Reconcile trigger | `x-keystone-trigger-secret: fixture-reconcile-trigger-secret-only` |

These values are deliberately public fixture credentials. The Cloudflare demo uses them only for synthetic data, so they are not production authentication. Replace every `fixture-*` value and terminate TLS before exposing a real tenant or any non-synthetic data.

## Acceptance commands

| Command | Proof |
|---|---|
| `npm run seed -- --seed 424242` | Rebuilds the 120,000-record, three-generation fixture corpus and committed golden oracles byte-for-byte. |
| `npm run suite` | Runs the live sync + invariant + reconciler path and prints throughput, accuracy, proposal, and mirror-integrity checks. |
| `npm run test:golden` | Compares detected conflicts to `golden/conflicts.json` 1:1 and checks the 1,000-row clean sample. |
| `npm run test:spend-cap` | Runs 20 concurrent Postgres reservations against a 50-microcent cap; exactly 5 reach the provider boundary and 15 stop with audits and alerts. |
| `npm run test:integration` | Exercises live Compose health, auth, 4xx behavior, 120k ingestion, entity join, lineage, reconciliation, tenant scope, idempotency, and partial-source degradation. |
| `npm run test:security` | Inspects the live PostgreSQL runtime role and proves source immutability, append-only evidence/audit tables, explicit mutable tables, and non-privileged role attributes. |
| `npm run test:worker-recovery` | Abandons and duplicates a delivery while the worker is stopped, restarts it, then proves reclaim, acknowledgement, and one durable execution for that duplicate-delivery scenario. |
| `npm run benchmark` | Measures 20 cross-source entity queries and 20 three-request dashboard bundles against seeded data. |
| `npm run test:e2e` | Runs desktop and narrow Chromium accessibility, keyboard, focus, security-header, responsive, and real-data dashboard checks. |
| `npm run test:coverage` | Enforces backend/frontend core coverage thresholds. |
| `npm run test:ratio` | Fails unless nonblank test lines are strictly greater than production lines. |
| `npm run lint && npm run typecheck && npm run build` | Static and production-build gates. |
| `npm run compose:config` | Validates the tracked Compose topology through its real wrapper. |

See [@docs/QA.md](@docs/QA.md) for the acceptance matrix and exact evidence boundaries.

## What runs

```text
Browser -> nginx frontend -> Fastify API -> PostgreSQL system of record
                                      \-> durable jobs table -> Redis stream -> worker

CRM JSONL -------- read only --\
source_app schema -- SELECT -----> immutable mirror -> canonical entities -> invariants
Payments JSONL --- read only --/                                      \-> conflicts
conflicts -> spend reservation -> deterministic provider -> pending proposal -> reviewer decision
```

- `frontend/` is the React/Vite review surface. Its nginx container proxies same-origin `/api` requests.
- `backend/services/api/` contains the API, worker, adapters, invariant/reconciliation policies, generator, and harnesses.
- PostgreSQL owns durable jobs, snapshots, lineage, entities, conflicts, proposals, spend, alerts, and audit history.
- Redis is transport only. A job is committed before publication, Redis delivery is acknowledged only after durable completion, and ready jobs are republished after interruption.
- A partial run persists diagnostics and any complete source payloads but never advances a mixed active snapshot set. All three sources cut over together only after a complete run.

The exact diagrams and enforcement boundaries are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Fixtures and correctness contract

Canonical seed: `424242`; schema: `fixtures-v1`; generations: `3`.

| Source | Records |
|---|---:|
| CRM contacts | 40,000 |
| CRM deals | 15,000 |
| App students | 25,000 |
| App enrollments | 22,000 |
| Payments | 18,000 |
| Total | 120,000 |

The manifest also proves 17,750 three-source students, 23,150 clean entities, 1,000 multi-child households, 15,100 legitimate orphan leads, 1,000 overlapping conflict rows, 25 reasserted fields, 324 reversed timestamps, and 21 malformed payloads. Generated bulk files live under ignored `fixtures/generated/`; the compact grading contracts `golden/conflicts.json`, `golden/clean-sample.json`, and `golden/entity-view.json` are committed.

Identity resolution is deterministic: a valid hard external ID wins; otherwise a unique normalized name + DOB match is considered; otherwise a unique normalized email match is used. Ambiguous matches remain ambiguous. Guardian emails group households but never merge siblings. Normalization records its version and transformations for every material field.

The committed rules are [config/invariants.v1.json](config/invariants.v1.json). Missing dependencies yield `unchecked`, never `pass`. The golden harness currently expects exactly 3,050 failures and zero extras.

## Guarded reconciliation

Core mode has no source writer. For each active conflict, the worker:

1. derives a stable action fingerprint;
2. deduplicates any prior proposal;
3. reserves worst-case cost under row locks before a provider call;
4. validates provider output against the action fingerprint;
5. settles token/cost accounting;
6. computes deterministic confidence from inspectable signals; and
7. inserts the action explicitly as `pending` with evidence, confidence, sensitive-field flags, and an append-only audit event.

Reviewer approval changes Keystone review state only. The disconnected `canAutoApply` policy helper requires approval, rollback, complete non-sensitive evidence, and confidence ≥0.95, but no apply function or source writer is wired in this MVP.

The default provider is local `keystone-deterministic-v1`; it needs no key and never claims to be an LLM. Prices use USD microcents from [config/prices.v1.json](config/prices.v1.json). `PROVIDER_MODE=external` fails closed because an external integration is intentionally not implemented.

## API contract

Successful responses use `{ "data": ..., "requestId": "..." }`; failures use `{ "error": { "code": "...", "message": "..." }, "requestId": "..." }`. Every response is `no-store` and carries `x-request-id`.

| Method/path | Scope | Purpose |
|---|---|---|
| `GET /health` | Public | Process, Postgres, Redis, and per-source readiness. |
| `GET /ready` | Public | `/health` plus successful deterministic demo bootstrap when the ephemeral Cloudflare image is in use. |
| `GET /api/v1/overview` | Viewer | Dashboard counts, active snapshots, latest invariant state, and spend. |
| `GET /api/v1/conflicts` | Viewer | Cursor-paginated conflicts filtered by source/type/status/proposal/confidence/time. |
| `GET /api/v1/conflicts/:id` | Viewer | Conflict, proposal, active-snapshot lineage, and correlated audit history. |
| `GET /api/v1/entities/:id` | Viewer | Unified person view: registration, payment, CRM stage, and source links. |
| `GET /api/v1/proposals` | Viewer | Filtered proposal queue. |
| `POST /api/v1/proposals/:id/decision` | Reviewer | Optimistic-versioned approve/reject/hold decision; no source mutation. |
| `POST /api/v1/jobs/sync` | Reviewer + sync secret | Idempotent durable sync submission. |
| `POST /api/v1/jobs/reconcile` | Reviewer + reconcile secret | Idempotent durable reconciliation submission. |
| `GET /api/v1/runs/:id` | Viewer | Durable job or sync run status and result. |
| `POST /api/v1/internal/fixtures/validate` | Reviewer + sync secret | Explicit fixture-schema 4xx contract. |

The request body limit defaults to 1 MiB, each fixture record to 256 KiB, list pages to 100, job triggers to 20/minute, and general requests to 120/minute. Details and examples are in [backend/services/api/README.md](backend/services/api/README.md).

## Configuration and ownership

- Shared topology: `backend/docker/compose.yaml`
- Compose entrypoint: `backend/docker/compose.sh`
- Runnable environment contract: `backend/docker/.env.example`
- Ignored developer state: `backend/docker/.env` and `backend/docker/compose.local.yaml`
- Immutable forward migrations: `backend/services/database/migrations/`
- New-volume-only initialization: `backend/services/database/init/`
- Invariants, sensitive fields, payment amounts, and prices: `config/*.json`
- Cloudflare demo Worker/Container: `backend/cloudflare/`
- Cloudflare Pages Direct Upload configuration and same-origin function bridge: `frontend/wrangler.jsonc`, `frontend/functions/api/[[path]].ts`

All sibling containers use service DNS (`postgres`, `queue`, `api`) and internal ports. PostgreSQL and Redis have no tracked host publication. The API runtime role can read the synthetic `source_app` schema but cannot insert, update, or delete it; it also cannot update/delete immutable mirror, lineage, or audit rows.

## Cloudflare synthetic demo

The optional Cloudflare deployment is a deliberately ephemeral, synthetic-data-only demonstration—not a durable production runtime. It serves the dashboard from `https://gt-school.pages.dev`; the Pages Function proxies same-origin `/api/*` traffic through a service binding to the `gt-school-demo-api` Worker. The Worker exposes only `/ready`, `/health`, and `/api/v1/*`, which are forwarded to one named Container instance.

That Linux/amd64 Container runs the existing API, PostgreSQL/pgvector, Redis, and worker in one network namespace. PostgreSQL and Redis bind only to loopback in this exceptional all-in-one topology; the API alone listens on port 8080 for Container ingress. Its filesystem is reset when it stops, is evicted, scales to zero, restarts, or rolls out. Startup applies the immutable migrations, loads fixtures, starts the worker, runs deterministic sync/reconcile bootstrap, and writes the `/ready` sentinel only after the baseline is complete. Decisions, audits, jobs, and spend state therefore disappear intentionally after every restart and rebuild from the canonical 120,000-record / 3,050-conflict baseline.

This single-instance demo does not scale and provides no durability, availability, backup, or production security guarantee. It requires a Cloudflare Workers Paid account with Containers entitlement. There is no D1, R2, Queue, Durable Object application storage, custom domain, or Git-integrated Pages deployment. See [@docs/CLOUDFLARE_DEMO.md](@docs/CLOUDFLARE_DEMO.md) for the manually authorized release and rollback workflow.

## Security, privacy, and retention

- Fixtures are synthetic `example.test` data only. Never replace them with production exports.
- Request secrets are redacted by structured Fastify logging and are never returned.
- `LOG_PRIVACY_MODE=redacted` hashes sensitive audit metadata. Full mode is explicit and intended only for isolated fixtures.
- Application logs are retained for `LOG_RETENTION_DAYS` (default 30); immutable business audit rows follow the owning tenant's documented retention/export process and are not automatically deleted by runtime code.
- Containers run non-root with dropped capabilities, no-new-privileges, bounded PIDs/resources, read-only app filesystems, health checks, and graceful worker shutdown.
- Local HTTP is for loopback development. Any deployed endpoint must terminate TLS at a trusted ingress and replace fixture credentials.
- Multi-tenant reads always bind the authenticated tenant ID in SQL; reviewer state changes also require reviewer scope and optimistic versioning.

## Verified local benchmark snapshot

On 2026-08-22, Apple Silicon/Docker Desktop, canonical seed 424242:

| Target | Observed | Gate |
|---|---:|---:|
| Cross-source entity query, 20 runs | 42.90 ms p95 | <1,000 ms |
| Dashboard API bundle, 20 runs | 512.85 ms p95 | <1,000 ms |
| Full 120k sync + invariants | 22.72 s; 5,281 records/s | <30 s; ≥500 records/s |
| Full reconciliation / idempotent replay | 6.45 s / 0.58 s | <30 s |
| Golden accuracy | 3,050/3,050; 0 false positive/negative | exact |
| Concurrent spend burst | 5 allowed, 15 denied at exact cap | exact, no bypass |

These are local source/runtime results, not deployed or production claims. Re-run `npm run suite`, `npm run benchmark`, and `npm run test:spend-cap` on the target machine rather than treating the snapshot as portable.

## Further documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — matching data-flow and sequence diagrams, confidence, safety boundaries, and 10M-record plan.
- [AI_USAGE.md](AI_USAGE.md) — coding-assistant and reconciler-provider disclosure.
- [backend/services/database/SCHEMA.md](backend/services/database/SCHEMA.md) — durable schema, grants, indexes, and migration rules.
- [@docs/QA.md](@docs/QA.md) — acceptance matrix, Gherkin scenarios, and verification procedure.
- [@docs/CLOUDFLARE_DEMO.md](@docs/CLOUDFLARE_DEMO.md) — Cloudflare topology, reset contract, release gates, and manual rollback.
