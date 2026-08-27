# Keystone database schema

PostgreSQL 16 is Keystone's system of record. Redis is delivery transport only. `init/001-enable-pgvector.sql` enables pgvector; migration `002_stretch_ops.sql` stores real `vector(64)` embeddings for semantic incident grouping, and migration `003_dashboard_lookup_indexes.sql` provides the dashboard's tenant/time and latest-proposal lookup paths. Do not substitute JSON, text, or Redis for vector storage.

## pgvector incident grouping

| Decision | Value |
|---|---|
| Model | `conflict-pattern-hash-v1` (deterministic feature-hash of conflict type, rule, sources, disagreeing field names, and entity **kinds** — never raw IDs or PII) |
| Dimension | 64, enforced by `vector(64)` and `CHECK (dimensions = 64)` |
| Distance | cosine, operator `<=>` / `vector_cosine_ops` |
| Index | HNSW on `incident_embeddings.embedding` (`m = 16`, `ef_construction = 64`) |
| Lineage | each row cites `conflict_id`, `grouping_run_id`, `feature_text`, and `feature_hash` |
| Refresh | each stretch grouping run deletes the tenant's embeddings, groups, and members, then rebuilds them |
| Deletion | embeddings/groups/members are replaced on refresh; `grouping_runs` remain as an audit of prior cluster jobs |

Nearest-group listing uses `ORDER BY other.centroid <=> groups.centroid` in SQL. Clustering itself is a greedy cosine threshold in the worker, persisted as group centroids for later pgvector lookup.

## Ownership and roles

- The Compose `POSTGRES_USER` owns migrations and fixture loading and is available only to the one-shot `init` service.
- `keystone_runtime` is used by API/worker. It has public-schema application DML, sequence use, and `SELECT` on `source_app`.
- Runtime `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, references, and triggers are revoked across `source_app`.
- Runtime update/delete/truncate are also revoked on immutable `source_records`, `field_observations`, and `audit_events`. Runtime may delete `incident_embeddings`, `incident_groups`, `incident_group_members`, and expired `alert_events` so stretch grouping and retention can refresh.
- Postgres is not published to the host by tracked Compose. For inspection, run `../../docker/compose.sh exec postgres psql` with the configured local owner, or add an explicit ignored local port override.

## Source and synchronization

| Table | Contract |
|---|---|
| `source_app.students`, `source_app.enrollments` | Synthetic App-DB source keyed by seed/generation/source ID; runtime SELECT-only. |
| `source_app.fixture_manifests` | Loaded generator manifest per seed. |
| `sync_runs` | Idempotent top-level sync state, source availability, summary, structured terminal code. |
| `source_runs` | One terminal attempt summary per source and sync with counts, latency, and safe error detail. |
| `source_snapshots` | Immutable staged snapshot identity, schema/adapter version, completeness, counts, payload hash. |
| `active_snapshots` | Exactly one active pointer per tenant/source. Application logic advances all required sources together only after a complete cross-source run. |
| `source_records` | Immutable occurrence-aware raw mirror with payload hash, source-observed time, and ingest time. |
| `field_observations` | Raw and normalized material value, normalization version, transformation trace, and source time. |
| `fixture_rejections` | Structured synthetic adapter rejects without raw PII logging. |

`source_records` is unique on `(snapshot_id, entity_kind, source_id, occurrence)`. This retains duplicate payments without collapsing them. JSONB is used only for source payload/evidence, not as a replacement for relational identity or vector behavior.

## Canonical identity and lineage

| Table | Contract |
|---|---|
| `canonical_entities` | Tenant-scoped unified students, leads, and unlinked payments with deterministic match status/score and cross-source summary. |
| `entity_links` | Each immutable source record's canonical target, match method, score, evidence, and rule version. |
| `households` | Hashed normalized guardian-email grouping. |
| `household_memberships` | Many child entities per household; household identity never merges siblings. |

Entity API queries join links through `active_snapshots`, so historical syncs do not duplicate the current view.

## Invariants and conflicts

| Table | Contract |
|---|---|
| `invariant_runs` | Rule-set version, exact source availability, status, and pass/fail/unchecked/error totals. |
| `invariant_results` | Per-rule, per-entity verdict and evidence; conflict key when failed; `unchecked` rows for source-unavailable rules on partial sync. |
| `conflicts` | Stable conflict identity, sources/fields/entities/evidence, status, generation, and oscillation count. |

Conflicts are unique by tenant and stable key. A complete run resolves active keys absent from the new set, including the all-clean case; partial runs never resolve on missing evidence. Reappearance increments oscillation count, crossing the configured threshold changes the conflict to `oscillation_hold` with an append-only audit event, and proposal action fingerprints prevent repeat proposals.

## Jobs, proposals, spend, and audit

| Table | Contract |
|---|---|
| `jobs` | Durable idempotency key, payload, request correlation, stream ID, bounded attempts/backoff, result, and terminal state. |
| `proposals` | Stable action fingerprint, evidence, confidence/signals, sensitive fields/hold, integer costs, version, explicit review status. |
| `proposal_decisions` | Reviewer decision, reason, actor, and proposal version. |
| `spend_buckets` | Tenant/UTC-day cap, reserved, actual, released; checks prevent negative or over-cap accounting. |
| `spend_runs` | Per-job cap and accounting. |
| `spend_reservations` | Unique action reservation, worst case, actual, provider-call timestamp, and settlement state. |
| `audit_events` | Append-only correlated action log with privacy-safe metadata and content hash. |
| `alert_events` | Observable severity/message/metadata; spend-cap stop uses `critical`. Deleted after `LOG_RETENTION_DAYS` (default 30). |
| `proposal_applications` | Keystone-internal auto-apply ledger with a rollback snapshot; never writes a source system. |
| `grouping_runs` | Stretch grouping job identity, model, dimension, cosine metric, and member/group counts. |
| `incident_embeddings` | 64-d `vector` embeddings for active conflicts. |
| `incident_groups` / `incident_group_members` | Cluster identity, centroid, membership, and cosine distance in basis points. |
| `extracted_tickets` | Joinable ticket fields: student, family, system, record id, issue type, status, owner, requested action, resolution, dates. |
| `log_retention_runs` | Recorded alert-deletion cutoffs and counts. |

Spend rows use `bigint` integer microcents. Reservations lock day and run ledgers before any provider call. Proposals cannot reference a different tenant's conflict; decisions cannot reference another tenant's proposal.

## Indexes

- scoped source lookup and field-lineage lookup;
- GIN on mirrored payloads and conflict source arrays;
- tenant/entity/update ordering for canonical queries;
- tenant/verdict/rule for invariant inspection;
- dashboard conflict status/type/time ordering and the unfiltered tenant/time cursor order;
- proposal status/confidence/time ordering plus tenant/conflict/recent lookup for the conflict-list lateral join;
- ready-job status/next-attempt ordering;
- audit object/time ordering;
- HNSW cosine on incident embeddings;
- incident group member/count ordering;
- extracted ticket issue/student lookup; and
- alert-event retention time.

Query pagination uses indexed stable ordering and opaque cursors. Benchmark the actual seeded plan before changing indexes.

## Privacy and retention

`privacy-v1` redacts stored log metadata: keys matching email/name/dob/payload/secret/token/password/key/reason/ssn/phone/address/`last_error` are hashed, and email-shaped substrings are replaced. Default `LOG_PRIVACY_MODE=redacted`. `audit_events` stay append-only; `alert_events` older than `LOG_RETENTION_DAYS` are deleted during the stretch retention pass. Raw source payloads remain in immutable `source_records` for lineage, not in logs.

## Migration policy

`migrations/001_keystone_core.sql` is immutable once applied. The runner records SHA-256 checksums in `schema_migrations` and aborts if an applied file changes. All evolution is an additive, validated next-numbered migration; initialization scripts are never a migration substitute. Do not delete data or volumes as a schema-change shortcut.
