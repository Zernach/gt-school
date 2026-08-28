# Keystone — One-Shot Implementation Contract

**Status:** implementation plan only. This document is not being executed in
the current planning turn.

**Intended use:** after this plan is approved, give the “Implementation Agent
Prompt” below to one autonomous coding agent from the repository root. The
prompt is deliberately explicit because a one-shot build must preserve a
cross-layer contract instead of producing an API, database, dashboard, and
worker that only work independently.

**Current repository:** `/Users/zernach/code/gt-school`

**Authoritative inputs:**

- [`AGENTS.md`](../AGENTS.md) — system contract and repository ownership;
- [`@docs/REQUIREMENTS.md`](./REQUIREMENTS.md) — normative product and
  assessment acceptance criteria;
- [`@docs/RESEARCH.md`](./RESEARCH.md) — architectural rationale, evidence
  model, conflict semantics, and risk decisions;
- existing root/backend/frontend READMEs, tracked Compose files, and database
  schema notes.

## Implementation Agent Prompt

### Mission

You are the implementation agent for Keystone, “The Reconciliation Trust
Layer.” Starting from the current scaffold, build and verify a complete,
self-hostable vertical slice that runs end-to-end against deterministic,
synthetic CRM-shaped, app-Postgres-shaped, and payments-shaped fixtures.

Do not stop at a scaffold, a placeholder API, a seed script, or a visual mock.
The completed system must mirror sources read-only, retain field-level
lineage, evaluate versioned invariants exactly against the committed golden
set, expose a reconciled query/dashboard, and produce proposal-only guarded
automation with deterministic confidence, hard spend caps, idempotency, and
audit history.

This prompt is a future implementation instruction. In the current planning
turn, do not execute it and do not write application code.

### Operating rules

1. Begin by reading `AGENTS.md`, `README.md`, all relevant backend/frontend
   READMEs, `@docs/REQUIREMENTS.md`, and `@docs/RESEARCH.md`. Inspect the real
   current files before making assumptions.
2. Preserve unrelated worktree changes and the ignored local
   `backend/docker/.env`. Never run destructive volume or git commands.
3. Use the repo-local `add-backend-service` guidance for the API/worker/Compose
   integration and `edit-frontend` guidance for the dashboard.
4. Make reasonable implementation choices without pausing for broad
   clarification; document any remaining policy choice in `ARCHITECTURE.md`.
   Do not invent live-provider or production claims that the requirements do
   not support.
5. Synthetic data is mandatory. Never add real PII, credentials, private keys,
   provider tokens, or production data. A local demo credential must be
   clearly labeled as a fixture-only value and must never be treated as a
   production secret.
6. Browsers talk only to the API. They must not connect to PostgreSQL, Redis,
   fixture files, source adapters, or an LLM provider.
7. PostgreSQL is the system of record. Redis is at-least-once transport only;
   it must not become the durable home of jobs, conflicts, proposals, spend,
   or audit events.
8. Source adapters expose read operations only. There must be no source
   `write`, `update`, `delete`, or direct production mutation path in the Core
   build. Reviewer approval changes Keystone review state and audit history,
   not source systems.
9. Use internal Compose DNS and service ports (`postgres`, `queue`, `api`),
   never `localhost` for sibling containers. Do not add privileged mode, host
   networking, Docker socket mounts, or broad host mounts.
10. Keep the Core path ahead of Stretch work. Do not add live connectors,
    OAuth/SSO, a polished brand, or semantic embeddings until the exact golden
    set, failure-mode, proposal-safety, spend-cap, and performance gates pass.

### Fixed implementation choices

Use these choices unless a hard repository constraint proves them impossible;
record any substitution and its effect in `ARCHITECTURE.md`.

| Concern | Choice |
|---|---|
| API/worker | TypeScript on Node with Fastify |
| Runtime validation | Zod or an equivalent explicit runtime schema library |
| Database client | `pg` with parameterized SQL and forward-only SQL migrations |
| Frontend | TypeScript/React with Vite |
| Queue | Redis Streams with consumer group, acknowledgement after database commit, and pending-entry recovery |
| Scheduler | Worker-owned bounded scheduler plus authenticated job-trigger routes; keep the job contract replaceable by pg_cron later |
| Database | Existing PostgreSQL/pgvector Compose image; PostgreSQL remains authoritative even when pgvector is not used by Core |
| Reconciler default | Deterministic local provider with the same interface as an optional real provider |
| Canonical seed | `424242`, recorded in README and benchmark output |
| Currency/cost | Integer minor units or micro-cents; never floating-point money |
| API path | `/api/v1`; same-origin dashboard requests in the production-like Compose path |

### Definition of done

The build is complete only when all of these are true:

- `./backend/docker/compose.sh config --quiet` succeeds from a clean checkout
  after the documented environment bootstrap.
- `./backend/docker/compose.sh up --build --wait` starts healthy PostgreSQL,
  Redis, API, worker, and frontend services.
- A clean checkout can install dependencies, run the canonical deterministic
  seed, start the stack, and execute the committed end-to-end suite in a few
  documented commands.
- The seed validator proves the required source volumes, clean ratio, 70%
  three-source student representation, household/orphan counts, all C1–C14
  minimums, 10% overlap, three generations, three reasserted fields, malformed
  records, and byte-stable output for a repeated `--seed 424242` run.
- The invariant suite detects `golden/conflicts.json` exactly with zero false
  negatives and zero false positives, while the 1,000-entity clean sample
  remains conflict-free.
- A completed sync writes source IDs, timestamps, normalized values, and
  field-level lineage without a source writer; a failed/partial source is
  visible and produces `unchecked` dependent rules rather than false absence.
- The cross-source entity API, conflict API, proposal API, and dashboard show
  values that reconcile with the database records for the selected scope and
  window.
- N conflict keys create N stable `pending` proposals with evidence and
  deterministic confidence, subject to explicit deduplication for repeated
  identical actions. The source-mirror hash is unchanged after reconciliation.
- The spend burst test proves that concurrent workers cannot reserve or call
  beyond the per-run or hard daily cap; reaching the cap stops, audits, and
  alerts without a retry bypass.
- Duplicate Redis delivery, process restart, source timeout/5xx, malformed
  payload, stale pointer, source outage, oscillating source, and invalid model
  output have bounded and observable behavior.
- Core logic has at least 80% coverage, and the repository has lint, typecheck,
  unit, integration, browser/accessibility, and benchmark commands.
- `ARCHITECTURE.md`, `AI_USAGE.md`, updated README files, `SCHEMA.md`, the
  committed rule/config/price table, golden exports, and clean-checkout
  instructions are present and describe what was actually built.

Do not claim browser, Docker, deployment, or production proof unless you ran
that exact layer. Report unavailable proof and residual risk in the handoff.

## Phase 0 — Inspect and freeze the contract

Before editing application files:

- inspect the current tree, `git status`, existing `.gitignore`, Compose
  wrapper, tracked Compose topology, and ignored local override behavior;
- preserve `backend/docker/compose.yaml` as the shared topology and use
  `backend/docker/compose.local.yaml` only for developer-machine overrides;
- confirm application migrations go under
  `backend/services/database/migrations/`, while
  `backend/services/database/init/` remains for new-volume extension setup;
- record the current API placeholder and frontend placeholder in the
  architecture notes so the transition is auditable;
- choose package versions, create a lockfile, and pin base image major/runtime
  choices sufficiently for reproducible local builds;
- update the plan if the current worktree contains user changes, but do not
  reset or overwrite them.

The first implementation commit should establish package/workspace structure,
environment validation, migration execution, and health checks. Do not build a
dashboard against unverified tables.

## Phase 1 — Establish the vertical runtime

### Required tracked topology

Replace the placeholder API image with a tracked application build and add the
minimum services needed for a complete local path:

- `postgres`: existing pgvector image, health check, persistent named volume;
- `queue`: existing Redis image with AOF, health check, persistent named
  volume, no default host publication;
- `api`: application image, non-root process, internal port (default 3000),
  database and queue dependency health conditions;
- `worker`: same application build or a dedicated worker target, non-root
  process, scheduler/consumer command, dependency health conditions;
- `frontend`: static React build served by a small web server, with same-origin
  `/api` proxy to `api` or an explicitly documented development origin.

Keep host port mappings configurable through `.env`; publish only the API and
frontend ports needed for local use. Never put language-specific application
requirements in the ignored local Compose override.

### Environment contract

Update `backend/docker/.env.example` so every variable is documented and
secret-free or explicitly fixture-only. Include, as applicable:

- API and frontend host/container ports;
- PostgreSQL image/database/user/password for local development;
- Redis image and stream names;
- tenant/demo scope identifier;
- fixture-only client credential and per-job trigger credential, clearly marked
  non-production;
- request/body/timeout/retry limits;
- daily and per-run spend caps;
- provider mode (`local` by default), model name, and versioned price-table
  identifier;
- source fixture root, canonical seed, and fault-injection flags used only by
  tests;
- log privacy/redaction mode and retention setting.

The API must fail clearly on missing production secrets when a real provider or
live connector is enabled. The default synthetic/local mode must run without
external keys. Do not log environment values.

### Application layout

Use a small npm workspace with the existing root package as the command
facade. A reasonable layout is:

```text
backend/services/api/
  Dockerfile
  package.json
  tsconfig.json
  src/
    config/
    http/
    domain/
      normalization/
      identity/
      invariants/
      proposals/
      spend/
    persistence/
    sources/
    jobs/
    worker/
    fixtures/
  tests/
frontend/
  Dockerfile
  package.json
  vite.config.*
  src/
backend/services/database/migrations/
fixtures/
golden/
ARCHITECTURE.md
AI_USAGE.md
```

The exact names may vary, but keep separate modules for HTTP, persistence,
source adapters, normalization/identity, invariants, reconciliation policy,
spend accounting, jobs, and UI. Do not place SQL, provider calls, or source
writes inside React components or route handlers.

Add root scripts with stable names. At minimum:

```text
npm run install:all       # documented alias if useful; normal npm install is valid
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
npm run seed -- --seed 424242
npm run reconcile -- --seed 424242 --provider local
npm run test:golden
npm run test:integration
npm run test:e2e
npm run benchmark
```

Do not leave scripts that silently do nothing. If a script needs Docker, state
that in its help output and README.

## Phase 2 — Build the deterministic fixture system first

### Generator requirements

Implement a repository-owned generator, not hand-authored random fixtures.
Use a fixed integer PRNG or deterministic hash derivation, fixed epoch/date
rules, stable key ordering, stable JSON serialization, and streaming/batched
output. The same command and seed must produce byte-for-byte identical source
fixtures and golden exports.

The default seed is `424242`. The generator must produce at least:

| Source | Required records |
|---|---:|
| CRM contacts | 4,000 |
| CRM deals | 1,500 |
| App students | 2,500 |
| App enrollments | 2,200 |
| Payments including refunds | 1,800 |
| **Total** | **12,000** |

Meet the requirements’ ratios and structural data before conflict injection:

- approximately 70% of students represented across CRM, app, and payments;
- at least 85% clean entities;
- at least 1,000 households with 2–4 children sharing guardian emails;
- at least 3,000 legitimate CRM deal-less, unpaid, unenrolled leads;
- realistic null `guardian2_email` values around 60%;
- dirty but clean-safe names, Gmail aliases, enum variations, out-of-order
  timestamps, and nullable fields.

The source records must include all minimum required fields from
`@docs/REQUIREMENTS.md`. Add synthetic role/DOB/relationship fields needed to
make C4 and C10 deterministic and explain them in `ARCHITECTURE.md`. Do not
use guardian email alone as a child identity.

### Conflict injection and generations

Implement a deterministic conflict planner that reserves anchors and records
each mutation in the golden manifest. It must meet or exceed every C1–C14
minimum, including C3 pairs, and make at least 10% of conflicts overlap in two
causes. Generate at least three snapshots per source. At least three fields must
reassert an older stale value in a later generation. Generate at least 20
malformed records through the adapter validation path, including missing field,
wrong type, truncated JSON, and oversized body cases.

The generator must fail loudly if a minimum is missed. It must write:

- `golden/conflicts.json` with required fields `{type, entity_refs,
  sources_involved, disagreeing_fields, expected_verdict}` plus stable key and
  rule metadata where useful;
- `golden/clean-sample.json` with 1,000 deterministic clean entities;
- deterministic source snapshots to the documented local fixture workspace.

Treat the golden export as a required checked-in grading artifact. Keep large
runtime/build outputs and secrets ignored according to `AGENTS.md`; do not
commit opaque build artifacts merely because a generator produced them. The
README must explain exactly how a clean checkout recreates source snapshots.

### Source adapters

Define one read-only adapter contract with methods equivalent to:

- source identity and schema version;
- bounded `readSnapshot`/streaming record enumeration;
- source health and timeout behavior;
- payload validation and structured rejection;
- source record ID and observed timestamp extraction.

There must be no write method in the shared interface. Implement:

- a CRM fixture adapter reading HubSpot-shaped JSONL/snapshot data;
- an app-Postgres adapter reading a seeded source schema or fixture-backed
  equivalent through internal PostgreSQL DNS and a read-only query path;
- a payments fixture adapter reading Stripe-shaped payment/refund data;
- a fault-injecting wrapper for timeout, 5xx, malformed, and partial-source
  integration tests.

Do not allow arbitrary URLs or live credentials in the default fixture mode.
The adapter must report source latency, accepted count, rejected count,
snapshot generation, and completeness. Source outage is not record absence.

## Phase 3 — Persistence and snapshot semantics

Create forward-only migrations and update `backend/services/database/SCHEMA.md`.
Do not edit an applied migration. The schema must include the following
conceptual ownership, with names adapted consistently:

- tenant/client scope;
- sync and per-source runs;
- immutable source snapshots and raw source records;
- field observations/lineage;
- canonical entities, entity links, and household memberships;
- invariant runs/results;
- deduplicated conflicts;
- proposals and reviewer decisions;
- durable jobs and stream metadata;
- daily/per-run spend reservations and actual costs;
- append-only audit events.

Every user-visible relation must carry tenant scope. Use foreign keys,
nonnegative cost checks, confidence range checks, legal status values, unique
idempotency keys, stable evidence fingerprints, and indexes for scoped,
filtered, paginated dashboard queries.

Implement this activation behavior:

1. Record a sync request and per-source run.
2. Validate and stage source observations into a new generation.
3. Preserve raw payload, hash, ingest time, source time, and field lineage.
4. Activate only complete source snapshots; preserve last good data when a
   source fails.
5. Run dependent invariants with a source-availability vector.
6. Mark unavailable dependencies `unchecked` with a visible reason; never
   invent absence from an outage.

The database role used by the application must have no source mutation path in
the Core design. The seed/migration path may populate local synthetic source
fixtures, but the source adapter and runtime worker must only read them.

If a vector table is not implemented, retain the pgvector extension and state
that Stretch semantic grouping is deferred. If a vector table is implemented,
update `SCHEMA.md` with exact model, dimensions, distance/operator, index type,
source/chunk lineage, refresh policy, and deletion behavior before use.

## Phase 4 — Normalization, identity, and invariant engine

### Normalization

Implement a pure, versioned, idempotent normalization module:

- Unicode/case/trim/quote/backtick/whitespace handling for names;
- provider-aware email normalization, with Gmail dots/plus aliases applied
  only to Gmail policy;
- canonical enum/state/grade mappings with unknown-value rejection or
  `unchecked` behavior;
- integer currency minor units and strict currency/type validation;
- strict timestamp parsing to UTC while preserving the original and flagging
  `updated_at < created_at`.

Store original and normalized values. Every transformed material field gets a
lineage trace and normalization rule version. Running normalization twice must
produce the same output.

### Identity resolution

Use this evidence order:

1. compatible exact hard external ID;
2. exact canonical email where source role permits;
3. Gmail canonical email with alias evidence;
4. exact name plus DOB;
5. ambiguous/unlinked outcome, never a forced merge.

Keep person identity separate from household membership. Siblings sharing
guardians must never merge. A duplicate CRM email can be a conflict without
making all records with that email one person. Persist match method, evidence,
score, and rule version.

### Versioned invariant registry

Each rule must declare ID/version, dependencies, required evidence, outcome
semantics, evidence shape, sensitivity policy, and deterministic evaluation.
Implement the full C1–C14 matrix from the research document and requirements:

- paid-but-no-deal;
- payment-with-no-person;
- duplicate-by-normalized-email in source;
- same person with materially different cross-source emails;
- required one-source-only record;
- material field disagreement;
- paid-implying enrollment without active payment;
- dropped sibling;
- stale or misassociated CRM pointer;
- merge-collapsed CRM record;
- duplicate payment;
- wrong amount by configured payment type/currency;
- refund not reflected downstream;
- sensitive-field-only fix classification.

The rules must not read the golden export at runtime. The test harness compares
independent detected conflict keys with the golden manifest. Normalize and
sort evidence deterministically. A missing/undefined invariant is `unchecked`,
not a crash or implicit pass.

## Phase 5 — Worker, Redis transport, and guarded reconciler

### Durable job contract

Create a PostgreSQL job row before enqueueing a Redis Stream event. Include
tenant, job type, idempotency key, requested generation/window, request ID,
status, attempt count, next attempt, and last error. Use a unique constraint
for duplicate requests.

The worker must:

- consume with a named Redis consumer group;
- use bounded polling/read timeouts;
- acknowledge only after the database transaction commits;
- reclaim abandoned pending entries after a bounded idle time;
- make duplicate delivery safe through database idempotency;
- shut down gracefully and leave unfinished work recoverable;
- log structured request/job/run IDs without raw payload PII.

Redis is not allowed to be the only record of work or outcome.

### Reconciliation pipeline

For each active, failed conflict not already terminal or deduplicated:

1. acquire a per-tenant/reconcile lock;
2. read complete snapshot and invariant evidence;
3. derive an allowlisted candidate action;
4. classify changed fields against the immutable sensitive-field set;
5. compute deterministic evidence confidence outside the model;
6. reserve maximum possible cost before any provider call;
7. call the local or configured provider with bounded timeout/output schema, or
   use deterministic local evidence;
8. reject malformed/unsupported/sensitive model actions;
9. insert one `pending` proposal per stable conflict/action fingerprint;
10. insert the audit event and commit;
11. acknowledge Redis after commit.

The LLM/provider can summarize evidence, but it cannot change the conflict
verdict, confidence formula, sensitive classification, tenant scope, or
allowlisted action. A provider failure produces an audited proposal-generation
failure or safe deterministic fallback according to documented policy; it must
not trigger an unbounded retry loop.

### Confidence policy

Use a deterministic `[0,1]` evidence score based on inspectable signals such as
hard-ID agreement, exact email, exact name+DOB, agreeing-field ratio,
disagreement ratio, missing evidence, and sensitivity. Store the signal
breakdown and policy version. Do not persist a raw model-emitted confidence as
the gate. The threshold `0.95` is relevant only to optional future apply logic;
Core proposals remain pending.

### Sensitive-field hard hold

Never auto-apply, and mark `sensitive_hold`, for any action touching:

- legal/identity name, DOB, government/student identifier;
- payer or billing owner;
- enrollment/deal/payment status with financial consequence;
- marketing consent, communication opt-out, or compliance/privacy state.

The field classification must be applied to the proposed diff, not inferred
from the proposal’s prose. A high confidence score never overrides it.

### Spend reservation protocol

Use integer costs and a versioned price table. Before a provider call, in one
short database transaction:

- lock the tenant/day bucket;
- calculate worst-case cost from configured input/output bounds;
- enforce both per-run and hard daily caps;
- reserve the maximum before the call;
- on rejection, write `spend_cap_reached`, alert through a stub, halt the run,
  and do not call/retry the provider;
- after the call, record actual usage and release only unused reservation;
- charge worst-case when usage is unavailable.

The cap test must use concurrent workers and a fake provider with a known cost.
The count of provider calls and committed reservations must never exceed the
cap. A post-hoc counter is not an acceptable implementation.

### Oscillation and idempotency

Derive stable keys from conflict rule/version/entity refs/relevant evidence.
Derive action fingerprints from target field and proposed action/policy, not
from generation alone. Unique-index identical pending/resolved actions, link
later observations, increment oscillation count, and escalate to an audited
`oscillation_hold` after a configured threshold. Do not delete prior proposals
or bypass the cap on a retry.

## Phase 6 — API contract

Implement `/health` and `/api/v1` with explicit schemas, request IDs, bounded
bodies, safe error envelopes, and tenant/object authorization checks.

At minimum implement:

- `GET /health` — process, PostgreSQL, Redis, and source readiness;
- `GET /api/v1/overview` — scoped counts, freshness, source status, invariant
  status, pending count, and spend/cap;
- `GET /api/v1/conflicts` — cursor pagination and type/source/status/window
  filters;
- `GET /api/v1/conflicts/:id` — exact lineage, evidence, invariant version,
  related proposal, and audit history;
- `GET /api/v1/proposals` — scoped proposal queue and filters;
- `POST /api/v1/proposals/:id/decision` — approve/reject/hold with reason,
  optimistic version, legal transition check, and audit event;
- `GET /api/v1/entities/:id` — hand-checkable cross-source entity view;
- `POST /api/v1/jobs/sync` — trigger-protected bounded sync request returning a
  durable run/job reference;
- `POST /api/v1/jobs/reconcile` — trigger-protected idempotent reconcile job;
- `GET /api/v1/runs/:id` — source statuses, counts, latency, errors, and
  invariant/reconciliation progress;
- a trigger-protected internal fixture-validation seam that maps malformed
  adapter payloads to a clear 4xx without becoming a source write route.

Malformed JSON, invalid fields, oversized bodies, missing scope, illegal
decision transitions, and malformed provider output must never become silent
passes or generic 500 responses. Do not expose stack traces, credentials, raw
source payloads, or trigger secrets to the client.

Use a simple fixture/demo client scope and per-job shared trigger secret as
allowed by the requirements. No OAuth, SSO, login UI, or user-management
system is needed. Enforce tenant scope in repository queries and test object
level cross-scope access explicitly.

## Phase 7 — Accessible dashboard

Build a table-first React dashboard that makes the reconciler auditable in
seconds. Include:

- overview counts and source freshness/availability;
- conflict table with type, entity, sources, fields, status, confidence, and
  stable pagination;
- filters for source, conflict type, proposal status, confidence, and window;
- conflict detail view with raw/normalized field evidence, lineage, invariant
  rule/version, proposed action, sensitivity explanation, oscillation count,
  and audit events;
- pending proposal review controls with explicit approve/reject/hold reason,
  stale/disabled state, and confirmation;
- loading, empty, retryable error, malformed-data, partial-source, and success
  states.

Apply the existing frontend baseline where applicable: semantic HTML, clear
surface hierarchy, named Arctic Cyan (`#00E5FF`) and Royal Purple (`#7851A9`)
tokens only when useful, readable typography, visible keyboard focus, WCAG AA
contrast, reduced motion, and no color-only status. Do not spend the timebox
on a brand kit. Use text labels/icons/shapes in addition to color for pending,
rejected, applied, low-confidence, stale, and unchecked.

Abort stale fetches or otherwise prevent an older filter response from
overwriting newer state. Keep trigger secrets out of browser code. Confirm the
browser network path reaches only the API/frontend origin.

## Phase 8 — Documentation and operational contract

Write or update:

- root `README.md`: clone/install, environment, Compose start, seed, demo
  scope, dashboard URL, API examples, test/reconcile/benchmark commands,
  canonical seed, provider mode, and known limitations;
- `backend/README.md`, `backend/services/api/README.md`,
  `backend/services/queue/README.md`, and `frontend/README.md` with actual
  commands and ownership;
- `backend/services/database/SCHEMA.md`: tables, constraints, indexes,
  migration policy, source permissions, and vector decision;
- `ARCHITECTURE.md`: a data-flow Mermaid diagram and reconcile sequence Mermaid
  diagram that exactly match the implemented service names/routes/tables, plus
  the required one-page rationale, holds-before-writes enforcement, cap
  enforcement, and 100k-to-10M scaling change;
- `AI_USAGE.md`: coding tools, reconciler provider/model demonstrated, local
  provider, price table, prompts/configuration that materially shaped the
  build, and a clear synthetic-data statement;
- committed versioned invariant rules, sensitivity policy, price table, and
  golden exports.

Do not write “production-ready” or “deployed” unless the relevant runtime,
deployment, and authenticated-browser proof exists.

## Phase 9 — Verification order

Run the narrowest checks while implementing, then the complete gates in this
order:

1. `git diff --check` and shell/Compose/YAML/SQL syntax checks;
2. dependency install from the lockfile;
3. typecheck and lint;
4. unit tests for normalization, identity, every invariant, confidence,
   sensitive fields, cost arithmetic, locks/idempotency, and redaction;
5. generator determinism/manifest validator and golden comparison;
6. `./backend/docker/compose.sh config --quiet`;
7. `./backend/docker/compose.sh up --build --wait`;
8. migration idempotency and `/health` dependency checks;
9. seeded 12k end-to-end sync, query, invariant, proposal, and source-hash
   proof;
10. duplicate Redis delivery, worker restart/reclaim, partial source, timeout,
    malformed 4xx, stale pointer, reassertion/oscillation, and cap burst tests;
11. dashboard browser/accessibility checks at representative wide/narrow
    sizes, keyboard-only flow, focus, reduced motion, and console/network
    inspection;
12. 20-run p95 dashboard/query benchmark, full-pass timing, and 500-record/s
    ingestion measurement;
13. final diff/status/secrets/generated-output review.

For every unavailable check, state the exact missing dependency and residual
risk. Do not substitute a local unit test for Docker or browser proof.

## Final handoff required from the implementation agent

Report concisely but completely:

- user-visible result and dashboard/API entrypoints;
- files changed and authoritative ownership updates;
- migration/schema/fixture/golden changes;
- source read-only, tenant isolation, secret, privacy, and accessibility
  decisions;
- commands run and their actual outputs/measurements;
- local Docker, browser, deployment, and production proof separated by layer;
- test coverage and benchmark results;
- deferred Stretch work and residual risks;
- one valid completed-response row appended only to `@docs/JOURNAL.csv`, with
  the exact implementation prompt summary, original user prompt, ISO timestamp
  with UTC offset, runtime token count (or literal `unavailable` if telemetry
  is not exposed), and measured elapsed seconds.

Never claim that this planning document itself implemented the application.
