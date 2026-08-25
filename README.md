# Keystone

Keystone is a synthetic reconciliation trust layer for CRM, application, and payment data. It ingests sources read-only, preserves field-level lineage, evaluates deterministic invariants, and creates auditable, reviewer-gated remediation proposals.

**Live frontend:** [gt-school.pages.dev](https://gt-school.pages.dev)

**Backend URL:** [gt-school-demo-api.rough-base-9dc1.workers.dev/ready](https://gt-school-demo-api.rough-base-9dc1.workers.dev/ready)

## Why it exists

Data reconciliation should be explainable and safe. Keystone makes discrepancies visible without silently changing source systems:

- mirrors three sources into a durable, lineage-aware model;
- identifies entities conservatively and leaves ambiguity unresolved;
- evaluates 14 versioned invariants, where unavailable evidence is `unchecked`, never a pass;
- turns conflicts into deduplicated proposals behind spend caps, sensitive-field holds, and explicit reviewer decisions; and
- optionally groups related failures with pgvector, extracts joinable tickets, auto-applies only ≥0.95 non-sensitive allowlisted cases with a recorded rollback, and redacts stored logs.

Everything uses deterministic synthetic fixtures: no real PII, credentials, provider calls, or source-system writes are required.

## Architecture

```text
Browser -> frontend -> Fastify API -> PostgreSQL (durable state)
                                  -> Redis stream -> worker

read-only CRM + application + payments -> mirror -> entities -> invariants -> proposals
```

PostgreSQL is the system of record for jobs, snapshots, lineage, entities, conflicts, proposals, spend, alerts, and audit history. Redis is transport only: intent is committed before publication and delivery is acknowledged only after durable completion. A partial source run keeps the previous active snapshot set; all sources cut over together only after a complete run.

## Run locally

Requires Docker Compose v2, Node.js 24+, and npm 11+.

```sh
npm ci
npm run seed -- --seed 424242
npm run compose:up
npm run suite
```

Open [http://localhost:4173](http://localhost:4173). The local API is [http://localhost:3000](http://localhost:3000). The Compose wrapper creates the ignored `backend/docker/.env` from the runnable, secret-free example when needed.

### Fixture credentials

These are intentionally public credentials for synthetic data only. They must be replaced, and TLS terminated, before any real deployment.

| Purpose | Header/value |
|---|---|
| Dashboard/API read | `x-keystone-client-key: fixture-demo-client-key-only` |
| Reviewer actions | `x-keystone-client-key: fixture-demo-reviewer-key-only` |
| Sync trigger | `x-keystone-trigger-secret: fixture-sync-trigger-secret-only` |
| Reconcile trigger | `x-keystone-trigger-secret: fixture-reconcile-trigger-secret-only` |
| Stretch trigger | `x-keystone-trigger-secret: fixture-stretch-trigger-secret-only` |

## Correctness and safety

- The canonical fixture seed is `424242`: 120,000 records across three generations, with a committed 3,050-conflict golden set.
- Identity matching prefers a valid hard external ID, then unique normalized name + date of birth, then unique normalized email. Guardian email is household evidence, not child identity.
- Reconciliation never writes to a source. Before a provider call, Keystone reserves the worst-case cost transactionally; every resulting proposal is `pending` until a reviewer approves, rejects, or holds it. Stretch auto-apply is a separate gated function that can mark Keystone-internal `applied` rows with a rollback snapshot; it still never writes a source system and never touches sensitive fields.
- The default `keystone-deterministic-v1` provider needs no key. `PROVIDER_MODE=external` fails closed because no external provider is implemented.
- The API enforces tenant-scoped reads, reviewer authorization, request limits, optimistic proposal decisions, `no-store` responses, and request IDs. See the [API contract](backend/services/api/README.md) for routes and examples.

## Verify changes

Use the narrowest command that covers the change, then the relevant gates:

```sh
npm run test:golden       # exact conflict and clean-sample oracle
npm run test:integration  # live API, persistence, worker, and source behavior
npm run test:spend-cap    # concurrent transactional reservation boundary
npm run test:security     # database privilege and immutability checks
npm run test:worker-recovery
npm run test:e2e
npm run lint && npm run typecheck && npm run build
```

`npm run suite` exercises the live sync, invariants, reconciliation, and stretch flow. `npm run compose:config` validates the shared Compose topology. The complete acceptance matrix and evidence boundaries are in [@docs/QA.md](@docs/QA.md).

## Cloudflare demo boundary

The live demo is an intentionally ephemeral, synthetic-only showcase. Pages proxies same-origin `/api/*` traffic to one Worker-backed Container that runs the API, PostgreSQL/pgvector, Redis, and worker in a single network namespace. It bootstraps the canonical fixture baseline before `/ready` succeeds.

State disappears when that container stops, is evicted, restarts, or rolls out; it is rebuilt from fixtures on the next startup. This demo does not provide production durability, availability, backups, scaling, or security guarantees. It requires a Cloudflare Workers Paid account with Containers entitlement. The release and rollback procedure is documented in [@docs/CLOUDFLARE_DEMO.md](@docs/CLOUDFLARE_DEMO.md).

## Project map

- `frontend/` — React/Vite review surface and Pages bridge
- `backend/services/api/` — API, worker, adapters, reconciliation policy, fixtures, and harnesses
- `backend/services/database/` — immutable forward migrations, schema, and initialization
- `backend/services/queue/` — Redis transport
- `backend/docker/compose.yaml` — shared local topology
- `config/` — versioned invariants, sensitive-field rules, and price table

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — data flow, safety boundaries, and scale plan
- [backend/services/database/SCHEMA.md](backend/services/database/SCHEMA.md) — schema, grants, indexes, and migration rules
- [@docs/QA.md](@docs/QA.md) — acceptance matrix and verification procedure
- [@docs/CLOUDFLARE_DEMO.md](@docs/CLOUDFLARE_DEMO.md) — demo topology, reset contract, release, and rollback
- [AI_USAGE.md](AI_USAGE.md) — coding-assistant and provider disclosure
