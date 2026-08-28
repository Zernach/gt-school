# Keystone — Research Dossier and Architecture Findings

**Status:** planning and research only. No application implementation was
performed as part of this report.

**Date:** 2026-08-22

**Subject:** `gt-school`, the Keystone cross-source reconciliation trust layer

**Evidence boundary:** This report separates facts observed in the repository,
normative requirements, derived design decisions, and hypotheses that must be
validated during implementation. The authoritative product brief is
[`@docs/REQUIREMENTS.md`](./REQUIREMENTS.md); the repository contract is
[`AGENTS.md`](../AGENTS.md).

## Abstract

Keystone is not primarily an ingestion application, a dashboard, or an LLM
wrapper. It is a controlled epistemic system: it must preserve what each
source observed, make deterministic claims about whether those observations
violate declared invariants, and produce reversible human-reviewable
proposals without confusing a plausible explanation with authority to change
data. The distinction matters because the sources are intentionally
inconsistent, identity is deliberately imperfect, and the adversarial fixture
set contains a source that reasserts stale values after a later correction.

The central finding is that correctness depends on keeping four layers separate:

1. **Observations:** immutable, source-scoped records captured at a named
   generation with raw payload and field-level provenance.
2. **Normalized evidence:** deterministic transformations and identity links
   that make observations comparable without erasing their source values.
3. **Claims:** versioned invariant evaluations over a well-defined snapshot,
   including `pass`, `fail`, `unchecked`, and `error` outcomes.
4. **Actions:** proposals, reviewer decisions, budget reservations, and audit
   events. These are never implicit consequences of a model response.

The recommended implementation is a TypeScript monorepo with a Fastify API,
a separate worker process, a React dashboard, PostgreSQL 16 with the existing
pgvector extension, and Redis Streams for wake-up and work transport. The
database remains authoritative for sync runs, source snapshots, normalized
facts, invariant results, conflicts, proposals, spend reservations, and audit
events. Redis may redeliver work; it may not define truth. CRM, app-DB, and
payments adapters expose reads only. A deterministic local reconciler provider
is the default so a clean checkout needs no external key; a real provider can
be added behind the same interface without changing the safety boundary.

The implementation should deliberately optimize for the six Core requirements
and their observable tests before attempting Stretch features. Semantic
incident grouping is a credible use of pgvector, but it is not necessary to
prove exact conflict detection and it introduces model, dimension, index,
refresh, and deletion decisions that would compete with the three-day
assessment timebox. It should therefore remain a documented extension point,
not a substitute for deterministic invariants.

## 1. Research method and repository baseline

### 1.1 Evidence classes

The following vocabulary is used throughout this dossier.

| Label | Meaning | Example |
|---|---|---|
| **Observed** | Directly established by checked-in files or a safe read-only inspection | The API Compose service currently runs `traefik/whoami` |
| **Normative** | Required by the product brief or system contract | No writer may target a source system |
| **Derived** | A design conclusion that follows from observed and normative facts | A completed snapshot pointer is needed to prevent partial sync data becoming active |
| **Hypothesis** | A performance, product, or operational assumption requiring measurement | Indexed keyset queries can meet the one-second p95 target on the seeded corpus |
| **Deferred** | Intentionally not built in the core slice, with a safe boundary retained | Live CRM connectors and vector clustering |

This distinction prevents a common failure mode in assessment projects: a
convenient implementation assumption slowly becoming an undocumented business
rule, then being mistaken for source truth.

### 1.2 What exists today

The repository is a scaffold rather than a partially implemented product.

| Area | Observed state | Consequence for the bootstrap |
|---|---|---|
| Root | `README.md` describes a bootstrapped workspace and delegates backend details to `backend/README.md` | The future agent must establish the application toolchain, scripts, and clean-checkout path |
| Contract | `AGENTS.md` defines ownership, security, Compose, migration, pgvector, frontend accessibility, and verification rules | These are binding implementation constraints, not suggestions |
| Requirements | `@docs/REQUIREMENTS.md` defines six Core requirements, four Stretch requirements, a 14-class conflict manifest, performance targets, and submission artifacts | The generator and golden set are part of the product, not test-only decoration |
| API | `backend/services/api/README.md` contains no language or framework choice; Compose uses `traefik/whoami` as a neutral placeholder | Choose and document one framework; replace the placeholder with a real image/build |
| Database | PostgreSQL with pgvector is present; only `init/001-enable-pgvector.sql` enables the extension; migrations are empty except for `.gitkeep` | Add forward migrations and a migration runner; do not put application schema in init SQL |
| Queue | Redis 7 Alpine is AOF-enabled and internal-only by default | Use it as transport, not as the durable proposal or audit store |
| Compose | `api` depends on healthy `postgres` and `queue`; connection names are `postgres` and `queue`; the API publishes a configurable host port | Add worker and frontend topology to tracked `compose.yaml`, retaining the wrapper and local override boundary |
| Frontend | `frontend/README.md` says “Frontend coming soon” | Build a focused, auditable dashboard rather than assuming existing routes or design primitives |
| Scripts | `scripts/start.sh` can start the backend but Build and deployment actions are placeholders; deploy scripts are empty | Add explicit root scripts and keep deployment claims proportional to actual proof |
| Dependencies | Root `package.json` only provides `npm start`; there is no lockfile or application source | A one-shot implementation must create reproducible manifests, a lockfile, tests, and build/runtime entrypoints |
| Worktree | The tracked worktree was clean; `backend/docker/.env` was already ignored local state | Preserve that local secret-bearing file and never commit it |

### 1.3 What the requirements actually demand

The brief is easy to underestimate because it uses familiar words such as
“sync,” “dashboard,” and “reconciler.” The acceptance contract is stronger:

- The three source families must be mirrored read-only into a unified
  PostgreSQL surface with source IDs, ingest timestamps, and field-level
  lineage.
- Invariants must be versioned, deterministic, run after sync, and match a
  machine-readable golden set exactly: no false negatives and no false
  positives.
- At least 100,000 records are required, but the specified minimum entity
  volumes sum to **12,000** (4,000 CRM contacts + 1,500 deals + 2,500
  students + 2,200 enrollments + 1,800 payments). The implementation must
  satisfy the per-source table, not quietly target only 100,000.
- At least 70% of students must appear in all three sources, at least 85% of
  entities must remain clean, and 3,000 deal-less CRM leads must not be
  misclassified as paid-but-no-deal.
- The fixture generator must create three sync generations, at least 25
  reasserted stale fields, at least 20 malformed records, at least 10% overlap
  among planted conflicts, and a byte-stable golden export for a given seed.
- Each conflict must produce one stable pending proposal with evidence and a
  deterministic confidence score. A model may assist with candidate wording or
  ranking, but it is not the source of truth and cannot write directly.
- The daily spend cap must be enforced before an external call, survive
  concurrent workers and retries, halt and alert at the cap, and leave an
  audit trail.
- Source data must remain unchanged after reconciliation. “Approve” in the
  Core slice therefore changes Keystone’s review/audit state, not a CRM, app
  database, or payment source.

## 2. The problem as a data and control system

### 2.1 Why “the canonical record” is the wrong first abstraction

The brief describes several systems that each hold a partial projection of an
entity. Those projections can disagree for legitimate, temporal, or corrupt
reasons. If ingestion immediately overwrites all records with a single
canonical row, it destroys the evidence needed to answer the operator’s most
important question: “Which source said what, when, and after which
normalization?”

Keystone should instead treat a source observation as a tuple:

\[
  o = (tenant, source, generation, entity\_kind, source\_id, payload,
       observed\_at, ingested\_at, payload\_hash)
\]

Normalization is a deterministic function \(N\) that produces comparable
values and an explanation of its transformation:

\[
  N(o.field) = (normalized\_value, rule\_version, transformation\_trace)
\]

Entity resolution constructs a graph \(G\) of *supported* links rather than
asserting that every plausible match is the same person. An invariant is a
versioned predicate evaluated against \(G\), a declared snapshot boundary,
and the source availability vector:

\[
  I_r(G, S, A) \rightarrow \{pass, fail, unchecked, error\}
\]

Finally, a conflict key is derived from the rule, tenant, canonical entity
references, and relevant evidence fields. A proposal is an interpretation of
that conflict, not a replacement for it:

\[
  conflict\_key = H(rule\_id, rule\_version, entity\_refs, evidence\_fields)
\]

The generation is recorded in the evidence and run lineage, but not used by
itself as the identity of the conflict. This is what allows a later sync to
recognize the same stale disagreement instead of charging the model and
creating an identical proposal forever.

### 2.2 The trust boundary

The system has three authority boundaries:

1. **Source boundary:** source adapters can read only. Their TypeScript
   interface must not expose `write`, `update`, or `delete` operations. The
   production source credentials, if ever added, must be read-only database or
   API credentials.
2. **Claim boundary:** only the deterministic normalization and invariant
   engine can create a `fail` claim. The LLM can provide candidate evidence
   language, but it cannot create a conflict or change a verdict.
3. **Action boundary:** only a policy gate can turn a candidate action into a
   pending proposal. A human decision is required before any optional apply
   path, and the Core build contains no source writer at all.

This is a stronger design than placing a warning in a prompt. The forbidden
operation should be absent from the source adapter type, absent from the API
route set, absent from the worker’s database role, and guarded by tests that
hash the source mirror before and after a run.

### 2.3 The most important semantic distinction: absence versus outage

“No deal exists” and “the CRM timed out” are not equivalent observations.

- **Record absence:** the source completed a bounded snapshot and did not return
  a matching record. This can support a conflict such as C1 or C5.
- **Source outage:** the source did not provide a complete snapshot. The prior
  good snapshot may be displayed with a stale marker, but the new run must not
  conclude that records disappeared. Dependent invariants become `unchecked`
  or retain the prior verdict with explicit freshness metadata.
- **Malformed record:** the source delivered a record that violates the
  adapter schema. Reject that record with structured diagnostics, continue only
  under a declared partial-ingest policy, and make the rejection visible.

Conflating these states is the fastest route to false positives during an
incident. The data model therefore needs source-run status and per-source
snapshot status, not just a single “last sync” timestamp.

## 3. Design decisions and their justification

### 3.1 Recommended stack

| Boundary | Decision | Reasoning |
|---|---|---|
| API and worker | TypeScript on Node with Fastify | The repository already has an npm entrypoint; one language can share schemas, deterministic fixture utilities, policy types, and test helpers across API and worker. Fastify supplies a small explicit HTTP boundary without imposing a frontend framework. |
| Validation | Zod or an equivalent runtime schema library at every external boundary | TypeScript types alone disappear at runtime. Source payloads, query parameters, trigger bodies, and model output must be rejected or quarantined explicitly. |
| Database | PostgreSQL 16 with `pg` and SQL migrations | The tracked Compose image is pgvector/PostgreSQL 16; relational constraints, transactional locks, JSONB evidence, indexes, and SQL joins match the trust-layer workload. |
| Queue | Redis Streams with one consumer group for worker wake-up | Streams provide at-least-once delivery, consumer cursors, acknowledgement, replay, and recovery of pending entries. PostgreSQL still owns job state and results. |
| Frontend | TypeScript/React with Vite, served as a static container | The requirements call for TypeScript/React; the product surface is a focused operations table, not a large client-side domain model. The browser sees only the API. |
| Scheduler | Worker-owned bounded scheduler plus authenticated trigger endpoint | This is easier to run in the existing Compose stack than introducing pg_cron and keeps scheduling logic testable. The schedule is a wake-up mechanism; durable job rows and a database lock prevent duplicate work. |
| Reconciler default | Deterministic local provider; optional real-provider adapter | A clean checkout must work without credentials. The local provider makes cap, evidence, malformed response, and repeatability tests real without network or spend. |
| Semantic grouping | Deferred extension using the existing pgvector capability | It is Stretch #8 and cannot improve exact invariant correctness. If implemented later, its model, dimension, distance operator, index, lineage, refresh, and deletion policy must be documented in `SCHEMA.md` before a vector table is added. |

Fastify and React are implementation choices, not new product requirements. A
future implementer may substitute Python/FastAPI or another equivalent only if
the full contract remains intact and the choice is recorded in
`ARCHITECTURE.md`. The one-shot plan intentionally selects one path so an
autonomous agent does not spend the timebox debating frameworks.

### 3.2 PostgreSQL as authority, Redis as transport

The repository contract explicitly states that PostgreSQL is the system of
record and Redis is transport. This division should be made observable:

- A job is inserted into PostgreSQL with a unique idempotency key before a
  Redis stream entry is emitted.
- The worker reads with `XREADGROUP`; it performs its database transaction and
  acknowledges the stream entry only after commit.
- If the process crashes before acknowledgement, Redis can redeliver the entry.
  The database uniqueness constraint makes the second attempt a no-op or a
  safe continuation.
- Pending entries are periodically reclaimed with `XAUTOCLAIM` after a
  bounded idle time. Reclaim is a retry mechanism, not permission to bypass
  the spend ledger.
- Redis AOF improves restart durability, but Redis loss must not erase a
  proposal, conflict, spend reservation, or audit event. A database job row can
  be republished.

The [Redis Streams documentation](https://redis.io/docs/latest/develop/use-cases/streaming/)
describes consumer groups as at-least-once delivery with per-consumer pending
lists and `XACK`, and supports replay through range queries. The
[Redis persistence documentation](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
also makes clear that persistence is a choice with recovery tradeoffs. Those
properties support the division above; they do not make Redis a substitute for
PostgreSQL transactions.

### 3.3 Transaction strategy

Ordinary ingestion can use short `READ COMMITTED` transactions around a
staged source snapshot and an atomic active-snapshot pointer. Critical policy
operations require a stronger boundary:

- **Budget reservation:** lock the tenant/day budget row, verify both daily and
  run limits, reserve the maximum allowed cost, and commit before invoking a
  provider.
- **Proposal creation:** use a unique proposal key and an insert-on-conflict
  outcome inside the same transaction as the evidence and audit event.
- **Reviewer decision:** lock the pending proposal, verify that the requested
  transition is legal, insert the decision audit event, and update status in one
  transaction.
- **One active job per scope:** use a row lock or transaction-scoped advisory
  lock with a unique job key. A retry must wait, exit as duplicate, or resume
  safely; it must not run two spend-consuming reconciliations concurrently.

PostgreSQL’s current documentation describes `READ COMMITTED` as the default
snapshot behavior and `SERIALIZABLE` as requiring retry handling for
serialization failures. It also documents explicit row and advisory locks.
The project should use the least strong isolation that proves each invariant,
keep critical transactions short, and test serialization or lock contention
instead of assuming it cannot occur. See the [transaction isolation
documentation](https://www.postgresql.org/docs/current/transaction-iso.html)
and [explicit locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html).

### 3.4 Why not make dbt or pg_cron the core abstraction

The requirements permit dbt-expectations and pg_cron, but neither is necessary
to demonstrate the acceptance contract in this scaffold.

- The invariant engine needs typed evidence, stable conflict IDs, `unchecked`
  outcomes, source availability semantics, and a proposal handoff. A versioned
  TypeScript rule registry can expose those concepts directly and can be unit
  tested without a separate transformation runtime.
- pg_cron would add a database extension and deployment-specific scheduler
  semantics to a project whose existing stack already has a worker boundary.
  The worker scheduler can still emit an authenticated job event and can be
  replaced by pg_cron later without changing the durable job contract.

This is not an argument against either tool in a production warehouse. It is a
timebox decision: keep the invariant definitions code-reviewable and the
scheduler replaceable, while retaining a `rule_id` and `rule_version` that
could later map to SQL/dbt tests.

## 4. Snapshot, lineage, and schema model

### 4.1 Snapshot activation

Every source sync should follow this sequence:

1. Create a `sync_run` and one `source_run` per source with a request ID,
   tenant scope, generation, start time, timeout, and adapter version.
2. Read each source through its read-only adapter into a staging boundary.
   Validate size, structure, required fields, and types before persistence.
3. Write accepted records to an immutable source snapshot, including raw
   payload hash and received time. Write field lineage rows at the same
   logical generation.
4. Mark the source snapshot `complete`, `partial`, or `failed` with counts,
   rejected-record diagnostics, latency, and a bounded error code.
5. Activate only completed source snapshots. An all-source run receives a
   completed bundle pointer; a partial run preserves each source’s last good
   snapshot and records the stale dependency explicitly.
6. Normalize and evaluate invariants against the selected snapshot bundle.
   Never let a dashboard query silently join a new CRM snapshot to an
   unannounced mixture of old app and payments snapshots.

The active pointer can be a row such as `active_snapshot_bundle(tenant_id,
source_kind, snapshot_id, activated_at)`. Historical generations remain
queryable. This makes the system replayable and allows the test harness to
compare generation 1, 2, and 3 without destructive resets.

### 4.2 Conceptual tables

The following is a design contract, not SQL to be written in this planning
turn. Names may be adapted, but the ownership and constraints should survive.

| Relation | Responsibility | Required properties |
|---|---|---|
| `tenants` / `clients` | Scope isolation and demo client mapping | Stable ID; all domain tables carry `tenant_id`; no query omits the scope predicate |
| `sync_runs` | One requested sync/reconcile lifecycle | Idempotency key, request ID, status, timing, source summary, error summary |
| `source_snapshots` | One source generation | Source kind, generation, adapter version, status, counts, payload hash, freshness |
| `source_records` | Immutable raw source observations | Snapshot FK, entity kind, source ID, payload JSONB, payload hash, received time; unique `(snapshot_id, entity_kind, source_id, occurrence)` |
| `field_observations` | Field-level lineage and normalized comparison | Raw JSON path, raw value/hash, normalized value, normalization rule version, source record FK, source timestamp |
| `canonical_entities` | Conservative cross-source identity projection | Canonical key, entity kind, resolution status, match method, confidence/evidence; never merges on guardian email alone |
| `entity_links` | Supported source-to-entity links | Source record, canonical entity, match method, score, evidence, rule version; uniqueness prevents two incompatible hard-ID links |
| `households` / `household_memberships` | Parent/guardian grouping distinct from person identity | Shared guardian emails do not merge child entities; membership is separately evidenced |
| `invariant_runs` | Versioned rule execution over a snapshot bundle | Rule-set version, bundle ID, start/end, status, counts, source availability vector |
| `invariant_results` | Per-record verdict and evidence | Rule ID/version, entity refs, verdict, evidence, lineage refs, stable conflict key, error/unchecked reason |
| `conflicts` | Deduplicated operator-visible violations | Stable key, type, scope, sources, fields, first/last seen, active status, oscillation count, latest invariant result |
| `proposals` | Pending guarded candidate action | One row per conflict key/action fingerprint, `pending` default, deterministic confidence, evidence, action allowlist, sensitive hold, cost data, status |
| `proposal_decisions` | Reviewer state transitions | Actor scope, decision, reason, time, optimistic version; append-only decision history |
| `spend_buckets` | Integer accounting for daily and per-run caps | UTC day, tenant, cap, reserved, actual, released, version; atomic conditional reservation |
| `jobs` | Durable work intent and retry state | Unique idempotency key, type, status, retry count, next attempt, stream ID, last error |
| `audit_events` | Append-only security and operating record | Event type, actor, tenant, request ID, object refs, redacted metadata, timestamp, optional hash-chain fields |

Important constraints include:

- confidence is numeric and constrained to `[0,1]`;
- cost is stored as integer micro-cents or cents, never floating-point money;
- statuses are explicit finite values with legal transition checks;
- raw payload hashes and evidence fingerprints are deterministic;
- `tenant_id` participates in every uniqueness key that could otherwise cross
  scope;
- all foreign keys that refer to a snapshot or result retain history rather
  than cascading away audit evidence;
- cursor-based API pagination uses stable `(sort_time, id)` ordering;
- source records are append-only from the hub’s application role;
- audit events have no public update/delete route.

### 4.3 Field-level lineage is not a JSON blob afterthought

A single `lineage JSONB` column can be convenient, but it is insufficient for
the dashboard and exact tests if it cannot answer “which source field produced
this normalized value?” The normalized projection should expose each material
field as an observation with:

- source and source record ID;
- source JSON path or typed column name;
- raw value or a privacy-safe representation;
- normalized value used for comparison;
- normalization rule version;
- source observed timestamp and Keystone ingest timestamp;
- snapshot/generation ID;
- transformation notes such as `trimmed_whitespace` or
  `gmail_dot_alias_collapsed`.

The UI can render these rows in a compact evidence table. The API can return
redacted previews while tests use the synthetic raw values. This avoids making
operators trust a canonical field whose provenance is invisible.

## 5. Deterministic identity resolution and normalization

### 5.1 The identity problem is intentionally adversarial

There is no universal ID. The brief says hard IDs are populated on only about
60% of linkable records and requires joins using email and/or name plus date of
birth. It also includes Gmail aliases, dirty names, multiple children sharing
guardians, duplicate contacts, and records that should not be merged.

The primary safety rule is **evidence monotonicity**: a weaker match may suggest
a relationship, but it must not silently override a stronger contradictory
relationship. Ambiguous candidates become a conflict or `unchecked` result,
not an arbitrary merge.

### 5.2 Normalization pipeline

The bootstrap should version a pure normalization module with the following
rules.

| Field family | Deterministic treatment | Important guardrail |
|---|---|---|
| Names | Unicode normalization, trim, remove only documented stray wrapper quotes/backticks, collapse internal whitespace, case-fold comparison form | Preserve the original display value and distinguish formatting noise from a substantive spelling disagreement |
| General email | Trim, Unicode/case normalization, validate syntax, preserve original | Do not apply Gmail-specific rules to every provider |
| Gmail email | Lowercase, remove dots in the local part and remove a `+tag` alias only for the explicitly recognized Gmail domain policy | Store both original and canonical forms; a plus alias may carry business meaning outside Gmail |
| State/enum | Map documented variants such as `TX`, `Tx`, `TEXAS` to a canonical code | Unknown enum values are rejected or `unchecked`, not guessed |
| Grade | Parse `Grade 4` and `4` to a typed canonical value | Keep invalid values as an observable validation failure |
| Amount | Integer minor units plus ISO currency | Never use binary floating point for comparison or cost accounting |
| Time | Parse strict ISO/RFC 3339, normalize to UTC, retain original | `updated_at < created_at` is a data-quality signal, not a reason to reorder history silently |
| Null | Preserve null as distinct from empty string or missing field | Nullable `guardian2_email` is expected at roughly 60%, not an automatic conflict |

The normalizer must be idempotent: applying it twice produces the same value
and trace. Its tests should include dirty clean records to prove that
normalization reduces false positives rather than merely making conflicts easy
to detect.

### 5.3 Link hierarchy and sibling protection

The recommended deterministic hierarchy is:

1. Exact, valid hard external ID with compatible entity role.
2. Exact canonical email where the role and source semantics permit the link.
3. Gmail canonical email, with an explicit alias evidence flag.
4. Exact normalized name plus date of birth, where both fields are present and
   the source schema supports the role.
5. A bounded candidate set requiring human review; no automatic merge.

Guardian email is a household key, not a child identity key. The fixture
generator should therefore add optional role/DOB or relationship fields to the
CRM-shaped records needed to make C4 and C10 observable. The minimum CRM
schema does not itself include DOB, so treating the requirement as fully
specified without this extension would create an impossible oracle.

A child identity should be based on the child’s own stable ID or name+DOB
evidence. Two children sharing one or two guardian emails must remain separate
canonical entities. Household membership is a separate relation. A duplicate
email conflict among CRM contacts can still be valid while sibling protection
prevents a false cross-source merge.

### 5.4 Resolution outcomes

Each candidate link should end in one of three states:

- `linked`: evidence meets a declared deterministic threshold and no stronger
  evidence contradicts it;
- `ambiguous`: multiple candidates or conflicting hard evidence; visible to
  operators and excluded from automatic actions;
- `unlinked`: no supported candidate.

This is more trustworthy than forcing every source record into a canonical
entity. The invariant engine can still flag a payment-with-no-person or a
stale pointer when a link is absent, and can explain that the link was
unresolved rather than claiming the person does not exist.

## 6. Fixture generator and golden-set research

### 6.1 The generator is a production component of the assessment

The generator is the executable specification of what “correct” means. It
must be built before the invariant engine is tuned, otherwise the evaluator
can accidentally become a test of the generator’s assumptions rather than a
test of independent reconciliation logic.

The recommended phases are:

1. **Seed and identity plan:** derive all IDs, names, households, timestamps,
   currencies, and expected relationships from a fixed integer seed using a
   repository-owned deterministic PRNG and stable serialization. Avoid random
   library behavior that can change across versions.
2. **Clean base population:** create the required source volumes with at least
   85% consistent entities and at least 70% of students represented in all
   three source families. Include legitimate deal-less leads and legitimate
   household sharing before injecting conflicts.
3. **Conflict allocation:** choose deterministic anchor entities and reserve
   them by conflict type. Permit planned overlaps for at least 10% of planted
   conflicts; record all causes on one manifest row or on explicitly related
   rows according to the conflict identity policy.
4. **Mutation injection:** apply C1–C14 mutations while preserving the clean
   population and recording the exact source records and fields changed.
5. **Generation history:** emit at least three snapshots per source. Later
   generations reassert at least three stale fields. The expected behavior is
   oscillation recognition, not a fresh identical proposal on every run.
6. **Malformed path fixtures:** send at least 20 broken records through the
   adapter validation path, including missing fields, wrong types, truncated
   JSON, and one oversized body. They must have deterministic rejection IDs.
7. **Validation and export:** fail the seed command if any count, ratio,
   overlap, volume, field, or deterministic-byte condition is unmet. Export
   `golden/conflicts.json` and `golden/clean-sample.json` in stable sorted
   order.

The mandated representative source total is 12,000 records before any additional metadata.
The generator should stream JSONL or use batched inserts so memory usage does
not scale with all raw payloads. A small committed generator plus deterministic
generated fixture workspace is preferable to hand-editing a large opaque blob.
The golden set is a required grading artifact and may be committed; generated
runtime/build output and local secrets remain ignored under `AGENTS.md`.

### 6.2 Conflict manifest semantics

Every golden row should contain the required fields:

`{ type, entity_refs[], sources_involved[], disagreeing_fields[], expected_verdict }`

The implementation should add `conflict_key`, `rule_version`, and a stable
`cause_refs[]` where useful. The test harness must compare canonicalized sets,
not array order. It should report false negatives, false positives, duplicate
keys, and malformed verdicts separately.

The golden set must not be imported by production invariant code. It is an
oracle for tests, not a shortcut to correctness. A separate clean sample of
1,000 entities is necessary because exact planted-conflict recall alone can
hide a detector that flags everything.

### 6.3 Conflict matrix

The following matrix converts the prose manifest into implementable policy.

| ID | Deterministic trigger | Required evidence | Main false-positive defense |
|---|---|---|---|
| C1 paid-but-no-deal | A valid paid payment links to a student/enrollment requiring a deal, but the completed CRM snapshot has no qualifying deal | Payment, resolved person/enrollment, CRM completeness | Never flag a legitimate deal-less lead that has no payment/enrollment |
| C2 payment-with-no-person | Payment matches no contact/student under all supported identity keys | Payment plus attempted key evidence | Distinguish source outage and ambiguous link from completed no-match |
| C3 duplicate-by-email | Two CRM contacts share a normalized email under the same duplicate policy | Both source records and normalized email | Do not turn shared guardian emails across distinct children into child merges |
| C4 same person/different emails | Strong name+DOB or hard-ID relation links records whose emails differ materially | Both email lineages plus link evidence | Gmail alias normalization and household roles |
| C5 one-source record | An entity appears only in one source where the declared invariant requires another presence | Complete source snapshots and entity role | Only apply to roles/stages for which presence is required |
| C6 field disagreement | Same resolved entity has materially different grade, stage, or spelling across sources | Per-field values and source timestamps | Normalize formatting first; report precedence or disagreement explicitly |
| C7 enrolled-but-unpaid | Enrollment is in a paid-implying stage with no active matching payment | Enrollment stage and payment search | Handle refunds and incomplete payment source separately |
| C8 dropped sibling | A household’s child set is present in one downstream source and exactly one expected child is missing in another | Household membership and complete source snapshots | Sibling identity is child-specific, never guardian-email-only |
| C9 stale pointer | `crm_deal_id` is missing, absent, or points to a deal belonging to another entity | Enrollment pointer, CRM deal, association evidence | Do not infer a new pointer during invariant evaluation |
| C10 merge-collapsed | One CRM observation carries evidence of two distinct people/roles | Secondary identity fields and distinct DOB/IDs | Require two-person evidence; do not flag ordinary multi-email contact data blindly |
| C11 duplicate payment | Same payment ID or deterministic payer/amount/time fingerprint repeats | Both payment records and fingerprint window | Use currency and exact integer amount; do not dedupe legitimate installments |
| C12 wrong amount | Payment amount is outside the configured expectation for its typed payment | Amount policy version, payment, enrollment/program | Keep currency and type in the rule; do not embed an unexplained magic number |
| C13 refund not reflected | Payment is refunded while downstream status still represents it as paid | Refund/payment status plus downstream lineage | Source completeness and timing window |
| C14 sensitive-only fix | Only plausible action changes an identity, billing-owner, financially consequential status, or consent field | Candidate action diff and sensitive-field classification | Treat sensitivity as a hard deny, independent of confidence |

“One proposal per conflict” means one proposal per stable conflict/action key,
not one per database row and not one per invariant assertion that happens to
mention the same evidence. If two independent conflict types legitimately
exist for one person, they may have two keys, each with its own proposal and
audit trail.

## 7. Invariant execution and partial failure

### 7.1 Rule registry

Each invariant should carry:

- stable `rule_id` and semantic `rule_version`;
- the source kinds and entity kinds it depends on;
- required fields and identity evidence level;
- the set of outcomes (`pass`, `fail`, `unchecked`, `error`);
- deterministic evaluator and evidence schema;
- a sensitivity/action policy reference;
- an expected performance budget.

Rule definitions should be committed and reviewed like migrations. A changed
rule version creates a new evaluation lineage; it does not rewrite old
verdicts. The engine should process records in stable key order and emit
counts, duration, and rejection/unchecked reasons.

### 7.2 Source availability vector

For every invariant result, store the availability of its dependencies. For
example:

| CRM | App DB | Payments | Possible interpretation |
|---|---|---|---|
| complete | complete | complete | Evaluate the full rule set |
| failed | complete | complete | Rules requiring CRM become `unchecked`; do not turn missing CRM records into C1/C5 |
| complete | partial | complete | Evaluate only rules whose required app records are complete; expose rejected-record count |
| complete | complete | failed | Payment absence is not evidence of unpaid status; retain stale view marker |

The dashboard must show freshness and `unchecked` counts, otherwise an operator
could mistake “no conflicts” for “the system did not check.”

### 7.3 Determinism and replay

For the same seed, source generation, adapter version, normalization version,
rule version, and configuration, the following should be byte-stable:

- normalized values and transformation traces;
- entity-link decisions and evidence ordering;
- conflict keys and verdict set;
- deterministic proposal action and evidence;
- cost estimate under the same price-table version.

Provider narrative text may vary when a real LLM is enabled, but it must not
alter conflict identity, confidence, sensitivity, or the final action allowlist.
The local provider should be the test oracle for all safety assertions.

## 8. Guarded reconciliation: the formal safety design

### 8.1 Pipeline stages

The reconciler should make these stages visible in logs and database state:

1. Acquire a scoped job lock and idempotency key.
2. Select active completed snapshots and run/version metadata.
3. Read `fail` conflicts not already resolved or deduplicated.
4. Derive an allowlisted candidate action from deterministic evidence.
5. Classify every changed field as sensitive or non-sensitive.
6. Compute deterministic confidence; never accept a raw model score.
7. Reserve the maximum possible provider cost transactionally.
8. Call the local or configured provider with strict timeout and output schema,
   or use a deterministic fallback when the provider is unavailable.
9. Validate the response against the candidate action and policy. Invalid,
   incomplete, or sensitive actions become a `sensitive_hold`/review outcome.
10. Insert exactly one `pending` proposal per conflict/action key and an audit
    event. Commit before acknowledging transport.

No stage writes a source. The Core reviewer endpoint only transitions the
proposal and records the decision. A future Stretch apply function must be a
separate module and route with an explicit allowlist, rollback record, and
human approval check.

### 8.2 Confidence is a reproducible evidence score

The requirements prohibit a magic constant and a raw LLM number. A practical
MVP score can be computed in integer basis points from inspectable signals:

\[
score = clamp(0, 1, 0.05
  + 0.35H
  + 0.25E
  + 0.20D
  + 0.10A
  - 0.15X
  - 0.20M
  - 0.30S)
\]

Where:

- \(H\) is a hard external-ID agreement flag;
- \(E\) is exact canonical-email agreement;
- \(D\) is exact name-plus-DOB agreement;
- \(A\) is the ratio of independently agreeing non-sensitive fields;
- \(X\) is the normalized disagreement ratio;
- \(M\) is a missing/ambiguous-evidence penalty;
- \(S\) is a sensitive-field action flag.

The implementation should express this as integer basis points to avoid
floating-point boundary drift, then expose the signal breakdown in proposal
evidence. The exact weights are a policy choice and must be benchmarked
against the golden fixtures. The `[0,1]` score is not probability unless
calibrated; the UI should call it “evidence confidence,” not “chance of truth.”

At `0.95` or above, the score still does not authorize Core auto-apply:
sensitivity, action type, evidence completeness, reviewer approval, and a
rollback path remain independent gates. C14 is a hard deny at every score.

### 8.3 Spend cap cannot be a post-hoc log check

A safe daily budget is a reservation protocol:

1. Convert the configured price table to integer micro-cents per input/output
   token or provider unit.
2. Determine a worst-case estimate for the requested call from maximum input,
   maximum output, and the configured model price. If actual provider usage is
   unavailable, charge the worst-case estimate.
3. In one short database transaction, lock the tenant/day budget row and
   verify `reserved + estimate <= daily_cap` and `run_reserved + estimate <=
   run_cap`.
4. If either predicate fails, insert a `spend_cap_reached` audit event, mark
   the job halted, invoke the stub alert, and do not call the provider.
5. If it succeeds, commit the reservation before the call. A process crash
   therefore leaves a conservative reservation rather than an untracked
   charge.
6. After the call, record actual cost and release only the unused reservation
   in a transaction. A retry must reserve again and can never reuse a released
   reservation as permission to exceed the cap.

The burst test must start concurrent workers, use a fake provider with known
cost, and assert that the sum of committed external-call reservations never
exceeds the cap. A test that merely inspects a final counter after calls have
already happened is insufficient.

### 8.4 Oscillation and proposal deduplication

The reasserting source creates a subtle failure: if a source flips a field back
to an old value, a naive reconciler produces the same proposal at every sync.
The policy should be:

- derive an action fingerprint from conflict key, target field, expected value,
  proposed value, and policy version;
- unique-index the fingerprint while a materially identical proposal is
  pending or previously resolved;
- link later observations to the existing proposal and increment an
  oscillation counter;
- after a configured threshold, create an `oscillation_hold` audit/conflict
  state and stop spending on repeated identical recommendations;
- allow a genuinely changed evidence set or reviewer decision to create a new
  versioned proposal, never by deleting the old one.

This is an operational safety property, not an optimization. It protects both
the spend cap and reviewer attention.

## 9. API and dashboard research

### 9.1 API boundary

The browser should call only a same-origin API surface (or a configured API
origin in development). It must never connect to PostgreSQL, Redis, a source
connector, or a model provider. A minimal Core route contract is:

| Route | Purpose | Authorization |
|---|---|---|
| `GET /health` | Service, database, queue, and source reachability summary | Safe operational probe; no secrets |
| `GET /api/v1/overview` | Counts and freshness for a selected tenant/window | Demo client scope |
| `GET /api/v1/conflicts` | Cursor-paginated conflict list with type/source/status filters | Demo client scope |
| `GET /api/v1/conflicts/:id` | Lineage, invariant evidence, related proposals, and audit history | Object-level scope check |
| `GET /api/v1/proposals` | Proposal queue with confidence/evidence/status filters | Demo client scope |
| `POST /api/v1/proposals/:id/decision` | Approve/reject/hold a proposal in Keystone | Reviewer/admin scope; optimistic version check |
| `GET /api/v1/entities/:id` | Cross-source person/enrollment/payment/deal view | Object-level scope check |
| `POST /api/v1/jobs/sync` | Request a bounded fixture sync | Per-job trigger secret; never expose secret to browser |
| `POST /api/v1/jobs/reconcile` | Request a bounded reconciliation run | Per-job trigger secret and idempotency key |
| `GET /api/v1/runs/:id` | Run status, counts, latency, errors, and source availability | Scope checked |

Every response should include a request ID and use a stable error envelope.
Malformed JSON, invalid query values, oversized bodies, and invalid decisions
must return an explicit 4xx. Internal errors are structured and safe, with
details in server logs only. `/health` must distinguish process health from
dependency health.

Authentication is intentionally simple: a demo client scope and a shared
secret trigger header satisfy the brief. It is still multi-tenant in the data
model and query policy. The trigger secret is never sent to the frontend. A
known local demo value in `.env.example` must be clearly marked as a fixture
credential, not a production secret; real deployments require environment or
vault injection.

### 9.2 Dashboard information architecture

The dashboard’s purpose is auditability, not visual novelty. The smallest
complete surface is:

- an overview strip showing active snapshot age, source statuses, invariant
  pass/fail/unchecked counts, pending proposals, and current spend versus cap;
- a filterable, server-paginated conflict table with conflict type, affected
  entity, disagreeing sources/fields, freshness, proposal status, and a
  non-color text/icon status label;
- a conflict detail panel containing source-value versus normalized-value
  evidence, lineage, invariant version, confidence signals, proposed action,
  sensitive-field explanation, oscillation history, and audit events;
- a proposal review queue with explicit approve, reject, and hold controls,
  confirmation text, reviewer reason, and disabled state for stale or already
  decided records;
- empty, loading, timeout, partial-source, malformed-data, and retry states.

Tables are preferable to charts for this domain because the reviewer needs
exact fields and provenance. Any aggregate chart must link back to the same
API query and selected window, otherwise the dashboard can display numbers
that do not reconcile with the underlying logs.

The UI should follow the requirement’s neutral clarity standard rather than
invent a brand. It must meet WCAG AA contrast, expose all controls to keyboard
users, preserve visible focus, use semantic table headers and labels, announce
async state, respect reduced motion, and convey pending/applied/rejected/low
confidence through text and shape/icon as well as color. The [W3C WCAG
overview](https://www.w3.org/WAI/standards-guidelines/wcag/) is the appropriate
primary reference for the accessibility acceptance baseline.

## 10. Security, privacy, and AI governance

### 10.1 Synthetic data is a hard boundary

The default and graded mode must contain no real PII. The generator may create
synthetic-looking names and emails, but README and AI disclosure must say that
they are fixtures. Live connectors are not a reason to weaken this boundary.
If an optional provider is enabled, prompts should send the minimum redacted
evidence needed for a candidate explanation and must never include secrets,
raw credentials, or unbounded source payloads.

### 10.2 API and tenant isolation

The brief’s “client reads only its own scope” requirement should be enforced at
the query layer, not only in route handlers. Every repository function accepts
an explicit tenant/client context, and tests should attempt cross-tenant object
IDs. This directly addresses object-level authorization risk identified by the
[OWASP API Security Top 10](https://owasp.org/www-project-api-security/).

Other baseline controls:

- strict request size and timeout limits for source and job endpoints;
- no arbitrary user-supplied connector URLs, preventing SSRF in the mock/live
  boundary;
- schema validation before persistence and validation of model responses;
- secret values excluded from structured logs, error bodies, frontend bundles,
  and audit metadata;
- privacy-safe log mode that hashes or previews PII and a documented retention
  period;
- no host Docker socket, privileged mode, host networking, or broad mounts;
- non-root application containers and dropped capabilities where compatible;
- internal Compose service DNS (`postgres`, `queue`, `api`) rather than
  `localhost` between containers;
- TLS at the deployment edge, with the local Compose limitation documented;
- explicit source-role permissions so the hub cannot write the source schema.

### 10.3 AI is a bounded component, not a decision-maker

`AI_USAGE.md` must disclose tools used for coding, the reconciler provider/model
used in any demonstration, the price table, and material prompts/configuration.
The reconciler contract should preserve:

- deterministic conflict identity and confidence outside the model;
- schema-constrained output with refusal on invalid actions;
- bounded prompt size, timeout, retries, and cost reservation;
- redacted evidence and no source credentials in the context;
- a local provider that makes all safety tests runnable without external keys;
- a clear distinction between a generated explanation and a verified field
  value.

The [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
is a useful governance reference for documenting intended use, limitations,
measurement, and human oversight, even though this three-day assessment does
not require a full compliance program.

## 11. Performance and scale reasoning

### 11.1 MVP performance shape

The requirements ask for cross-source and dashboard p95 below one second,
full invariant/reconciliation under 30 seconds over the seeded corpus, and
ingestion of at least 500 records per second. The design should make these
measurable rather than infer them from a fast unit test.

The main performance choices are:

- stream and batch fixture writes; do not issue one transaction per record;
- stage raw records and use set-based normalization/upsert operations where
  possible;
- index `(tenant_id, snapshot_id, entity_kind, source_id)`, canonical key
  columns, conflict status/type, proposal status, and stable sort keys;
- materialize the current cross-source entity projection after a completed
  snapshot, rather than joining five large raw tables for every dashboard row;
- use cursor pagination and bounded detail queries;
- precompute normalized email, name+DOB, payment fingerprint, and relevant
  lifecycle keys;
- measure with the canonical seed on a clean Compose stack, recording hardware,
  database settings, run ID, and query plan for misses.

The 10% fixture benchmark is a correctness and latency proof, not a promise of
production capacity. A run that meets p95 on a laptop but uses an accidental
in-memory fixture shortcut is not valid evidence; the API and worker must read
the PostgreSQL projection.

### 11.2 Credible 100k-to-10M evolution

The first scaling change should be **incremental, partition-aware ingestion
and projection**, not simply adding more worker replicas. At 10M records:

1. Partition immutable source observations by tenant and generation/time, with
   retention and archival policy.
2. Replace full-source scans with source watermarks/change feeds and a durable
   change-set table; re-evaluate only affected canonical entities and rules.
3. Maintain a current entity projection and conflict indexes separately from
   historical evidence; keep history queryable in cold storage or partitioned
   tables.
4. Shard worker jobs by tenant/source generation while retaining per-tenant
   budget and reconciliation locks.
5. Add read replicas or a dedicated analytical projection for dashboard reads;
   keep proposal and spend decisions on the writer.
6. If semantic grouping is adopted, partition embeddings and choose HNSW or
   IVFFlat after measuring recall, memory, build time, and filtered-query
   behavior. The [pgvector project documentation](https://github.com/pgvector/pgvector)
   records the relevant operator and index tradeoffs.

This is a real architectural change because it moves work from full recompute
to affected-entity recompute while preserving the same immutable evidence and
policy boundaries. “Add a queue” alone would not be a credible 10M plan.

## 12. Verification strategy and evidence ladder

The project should report proof in layers and never label one layer as another.

### 12.1 Static and unit proof

- Typecheck all workspaces.
- Lint and format source, SQL, Compose, and shell scripts.
- Test normalizer idempotence, email/provider-specific rules, sibling safety,
  strict payload validation, money/cost integer arithmetic, confidence
  signals, sensitive-field deny rules, and legal proposal transitions.
- Test the fixture generator twice with the same seed and compare bytes and
  hashes.
- Test every C1–C14 evaluator with both positive and clean/edge examples.
- Test source adapter types and mocks for read-only behavior.

### 12.2 Integration proof

Against the tracked Compose stack:

1. Run `./backend/docker/compose.sh config --quiet`.
2. Start with `./backend/docker/compose.sh up --build --wait`.
3. Check API, database, queue, and frontend health.
4. Run the canonical deterministic seed and verify all manifest volumes,
   overlaps, malformed records, and golden files.
5. Sync all generations; verify source snapshots, lineage, source status, and
   active-pointer behavior.
6. Run the invariant suite and compare detected conflict keys against the
   golden set with zero false positives/negatives.
7. Query a hand-checked cross-source entity through the API.
8. Run reconciliation; assert N conflict keys produce N pending proposals,
   unchanged source mirror hashes, evidence, confidence, and audit events.
9. Run concurrent spend-cap and duplicate-delivery tests; assert no cap bypass
   and no duplicate proposal.
10. Inject a source timeout/5xx and malformed payload; assert bounded structured
    failure and `unchecked` behavior rather than a hang or silent pass.

### 12.3 Browser and benchmark proof

- Load the dashboard against the running API at wide and narrow viewports.
- Navigate the filter table, detail panel, and review controls with keyboard
  only; inspect focus and semantic names.
- Verify loading, empty, partial-source, error, retry, and decision states.
- Run the dashboard and cross-source p95 benchmark 20 times on the seeded
  dataset, recording the distribution rather than only the best run.
- Run the full invariant/reconcile timer and ingestion throughput test.

The final handoff must distinguish source/test proof from Docker runtime,
authenticated-browser, deployment, and production proof. The current
repository has none of the latter until the implementation agent actually runs
them.

## 13. Risks and decision gates

| Risk | Why it is material | Decision gate / mitigation |
|---|---|---|
| Identity over-merging | A false merge can create wrong conflicts and unsafe proposals | Require hard-ID/email/name+DOB hierarchy; household relation separate; ambiguous links are visible and non-actionable |
| Golden-set leakage | Using the oracle in production can make tests meaningless | Generator exports oracle; invariant engine never imports it |
| Partial source failure | Missing data can look like a missing record | Snapshot completeness and dependency-aware `unchecked` verdicts |
| Spend race | Concurrent workers can exceed a post-hoc counter | Transactional worst-case reservation before provider call; burst test |
| Proposal storm | Reasserting source can repeat identical recommendations | Stable action fingerprint, unique constraint, oscillation hold |
| Requirement under-specification | C4/C10 need role/DOB evidence absent from minimum CRM fields | Add documented optional synthetic fields and freeze fixture semantics before coding |
| Fixture size/time | A 12k representative generator must remain bounded on the demo Container | Stream generation, batch database loads, validate counts early, keep Stretch off the critical path |
| Credential confusion | Demo keys can be mistaken for production secrets | Local fixture credential only; production env/vault; never log or bundle trigger secret |
| Dashboard theater | Pretty aggregates can hide stale or unverified evidence | Table-first UI, lineage detail, freshness and unchecked counts, API reconciliation tests |
| Vector distraction | Embeddings can consume time without helping exactness | Preserve extension; defer semantic grouping until Core gates pass |
| Scaffold assumptions | There is no existing route, type, or frontend system to extend | The one-shot agent must establish explicit source-of-truth files and update all runtime/docs together |

The first hard gate is not the dashboard. It is a deterministic seed and
golden-set validator that can demonstrate the stated data volumes and conflict
manifest. The second is an independent invariant comparison. The third is
proposal safety under duplicate delivery and cap contention. Only then should
visual polish or Stretch behavior be considered complete.

## 14. Recommended three-day sequence

### Day 1 — contract, fixtures, persistence, and one vertical path

- Freeze the stack, package workspaces, environment contract, Compose services,
  migration runner, and API error/auth conventions.
- Implement the deterministic generator, schema validators, source adapter
  interfaces, canonical fixture seed, golden manifest, and generator checks.
- Create snapshot, raw record, lineage, tenant, and job tables.
- Implement one source-to-Postgres sync and a health endpoint.
- Prove clean checkout, Compose health, seed determinism, and migration
  idempotency before adding all invariant classes.

### Day 2 — exact invariants and guarded automation

- Complete normalization/entity resolution and all Core conflict rules.
- Implement source completeness semantics, conflict deduplication, run status,
  and golden-set comparison.
- Implement worker scheduling, Redis Streams delivery, idempotent jobs,
  transactional spend reservation, deterministic local provider, proposal
  queue, and audit events.
- Add API query/detail/review routes and integration tests for source immutability
  and cap halting.

### Day 3 — dashboard, adversarial proof, and handoff

- Build the table-first React dashboard with accessible filtering, details,
  evidence, and review decisions.
- Run generation 1–3, reassertion/oscillation tests, malformed payload tests,
  source timeout tests, duplicate delivery, and cap burst tests.
- Add benchmark harness, CI, README quick start, `ARCHITECTURE.md` diagrams and
  rationale, `AI_USAGE.md`, database schema decisions, and deployment notes.
- Run all repository gates, inspect the diff, remove secrets/generated build
  output, and report any unproven deployment or production claims honestly.

The sequence is intentionally vertical. A half-built dashboard over a
non-deterministic detector is less valuable than a plain UI over a trustworthy
conflict/proposal contract.

## 15. Final findings

1. The core product is a provenance-preserving control plane, not a canonical
   data warehouse and not an autonomous repair bot.
2. The hardest technical problem is not generating records; it is defining
   stable identity, snapshot completeness, and conflict keys so that a clean
   majority remains clean under dirty formatting and partial failure.
3. The hardest safety problem is not displaying a confidence number; it is
   enforcing a sequence in which no provider call occurs before an atomic
   budget reservation and no proposal leaves `pending` without policy and
   human review.
4. PostgreSQL must own every user-visible intent and result. Redis Streams are
   useful for delivery and replay but cannot be the proposal queue of record.
5. A deterministic local provider and a committed price table make the safety
   contract testable without real credentials. Live model integration is a
   replaceable adapter, not a prerequisite for the graded build.
6. The dashboard earns trust by exposing freshness, exact disagreement, field
   lineage, evidence, and state transitions. A chart-only or color-only UI
   would conceal the very uncertainty Keystone exists to surface.
7. The proposed TypeScript/React/Compose implementation can fit the timebox
   only if Stretch work remains gated behind exact golden-set, source-failure,
   proposal-safety, and performance proof.

The companion [`@docs/BOOTSTRAP.md`](./BOOTSTRAP.md) turns these findings into
a one-shot implementation contract. It is deliberately written as a future
agent prompt; it was not executed in this planning turn.

## Sources and further reading

Primary sources consulted on 2026-08-22:

- [PostgreSQL 18 transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [PostgreSQL 18 explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL `SELECT` locking clauses](https://www.postgresql.org/docs/current/sql-select.html)
- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [Redis Streams and consumer groups](https://redis.io/docs/latest/develop/use-cases/streaming/)
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [pgvector README and index/operator tradeoffs](https://github.com/pgvector/pgvector)
- [Fastify reference](https://fastify.dev/docs/latest/Reference/)
- [React reference](https://react.dev/reference/react)
- [W3C WCAG overview](https://www.w3.org/WAI/standards-guidelines/wcag/)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)

These sources inform technology behavior and control principles. They do not
replace the repository’s requirements, which remain the acceptance authority.
