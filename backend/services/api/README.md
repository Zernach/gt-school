# Keystone API and worker

Node 24, TypeScript, Fastify, Zod, `pg`, and Redis implement the trusted backend. The API owns authentication, validation, tenant scope, durable job creation, and reviewer decisions. The worker owns adapters, synchronization, invariant evaluation, provider calls, spend reservations, and pending proposal creation.

## Local commands

```sh
npm run typecheck --workspace @keystone/api
npm run test:unit --workspace @keystone/api
npm run test:coverage --workspace @keystone/api
npm run test:golden
npm run test:integration
npm run suite
npm run reconcile -- --idempotency-key reviewer-demo-001
```

Host-side CLIs read `backend/docker/.env` whether invoked from the repository root or the API workspace. Set `API_BASE_URL` to override discovery. The cap harness runs inside the `init` image because its isolated fixture tenant needs owner privileges for setup and exact cleanup; production spend operations still run through the constrained runtime pool.

## Headers and scopes

- `x-keystone-client-key` authenticates a tenant-scoped viewer or reviewer. Keys are SHA-256 hashed at rest.
- Job endpoints additionally require their own `x-keystone-trigger-secret`.
- Proposal decisions require reviewer scope.
- `x-request-id` may be supplied and is truncated to 128 characters; otherwise the API generates it. It is returned on every response and audit correlation path.

Credentials and bodies are redacted from structured logs. Client and trigger secrets are never returned.

## Endpoint details

`GET /api/v1/conflicts` accepts `type`, `source`, `status`, `proposalStatus`, `minimumConfidence` (`0..1`), RFC 3339 `from`, opaque `cursor`, and `limit` (`1..100`). Its cursor binds the descending `(last_seen_at,id)` ordering. Invalid/forged cursors return a safe 400.

`POST /api/v1/proposals/:id/decision` accepts:

```json
{"decision":"approve|reject|hold","reason":"at least 3 characters","version":1}
```

Only `pending` may transition. The row is locked; a stale version returns 409; decision, actor, reason, and audit event commit in one transaction. Approval is review state, not source application.

Both job endpoints accept:

```json
{"idempotencyKey":"at-least-8-characters","generation":3}
```

The synthetic failure harness additionally accepts `faultSource` (`crm|app|payments`) and `faultMode` (`none|timeout|5xx|partial`). Those controls operate only on committed fixtures and are used by acceptance tests.

`POST /api/v1/internal/fixtures/validate` validates the Payments fixture schema. Invalid shape returns 422, malformed JSON 400, and over-limit bodies 413. Zod issues expose only field path and issue code.

Common safe error codes: `unauthorized`, `unauthorized_trigger`, `forbidden`, `invalid_request`, `invalid_json`, `body_too_large`, `not_found`, `stale_version`, `illegal_transition`, and `internal_error`.

## Source and sync contract

All adapters implement `ReadOnlySourceAdapter` with only `health()` and `readSnapshot()`. Each read is bounded by `SOURCE_TIMEOUT_MS` and `SOURCE_RETRY_LIMIT`. Outcomes are `complete`, `partial`, or `failed` with latency and structured error detail.

Accepted records and material-field observations are immutable. Complete payloads are staged even if another source fails, but a mixed source set is never activated. Canonical projection, C1-C14, conflict upsert, and the three-source active-pointer cutover occur only for a complete run. Partial dependencies become `unchecked`.

## Reconciler contract

The worker takes one tenant advisory lock, loads active conflicts in stable order, deduplicates stable action fingerprints, reserves worst-case cost, validates provider schema/fingerprint, settles cost, computes `confidence-v1`, and inserts explicit `pending` proposals plus audits. Provider timeout or invalid output charges the reserved worst case and records `proposal_generation_failed` without weakening later gates.

Daily and run caps use integer microcents. Both ledgers are locked before reservation. Cap denial writes `spend_cap_reached` audit and critical alert inside the same transaction; the loop halts without calling the provider.

## Test layout

- `tests/unit/`: property tables and scenario matrices for normalization, identity, schemas, lineage, projection, source faults, all invariants, sync atomicity, policy, confidence, provider validation, reconciliation, and spend settlement.
- `tests/golden/`: deterministic generation, manifest minima, 1:1 conflict comparison, clean sample, malformed inputs, reassertion, and byte stability.
- `tests/integration/`: live API/worker/Postgres/Redis/source path.

Core coverage thresholds are 80% lines/functions/statements and 75% branches; current core evidence is substantially higher. The root ratio gate independently requires more nonblank test lines than production lines.
