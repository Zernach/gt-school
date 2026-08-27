import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import {
  appEnrollmentSchema,
  appStudentSchema,
  crmContactSchema,
  crmDealSchema,
  paymentSchema,
  type Availability,
  type DetectedConflict,
  type FixtureSet,
  type SourceKind
} from '../domain/fixture-types.js';
import { evaluateInvariants, RULE_SET_VERSION } from '../domain/invariants.js';
import { sha256, stableStringify, stableUuid } from '../domain/stable.js';
import type { DatabaseClient, DatabasePool } from '../persistence/database.js';
import { inTransaction } from '../persistence/database.js';
import type { ReadOnlySourceAdapter, SourceRecord, SourceSnapshot } from '../sources/adapter.js';
import { SourceAdapterError } from '../sources/adapter.js';
import { lineageForRecord } from './lineage.js';
import { buildCanonicalProjection } from './projection.js';

interface SyncRequest {
  tenantId: string;
  generation: number;
  idempotencyKey: string;
  requestId: string;
}

export interface SyncResult {
  runId: string;
  status: 'complete' | 'partial' | 'failed';
  generation: number;
  sourceAvailability: Record<SourceKind, Availability>;
  acceptedRecords: number;
  conflicts: number;
  mirrorHash: string;
  durationMs: number;
}

interface ReadOutcome {
  sourceKind: SourceKind;
  snapshot?: SourceSnapshot;
  status: Availability;
  errorCode?: string;
  errorDetail?: string;
  latencyMs: number;
}

const SOURCE_RECORD_BATCH_SIZE = 10_000;
const LINEAGE_BATCH_SIZE = 25_000;
const PROJECTION_BATCH_SIZE = 10_000;
const INVARIANT_RESULT_BATCH_SIZE = 25_000;

type DatabaseExecutor = Pick<DatabasePool | DatabaseClient, 'query'>;

function sourcePayloadHash(record: SourceRecord, hashes: WeakMap<SourceRecord, string>): string {
  const existing = hashes.get(record);
  if (existing) return existing;
  const hash = sha256(stableStringify(record.payload));
  hashes.set(record, hash);
  return hash;
}

async function readBounded(adapter: ReadOnlySourceAdapter, generation: number, config: AppConfig): Promise<ReadOutcome> {
  const started = performance.now();
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.SOURCE_RETRY_LIMIT; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new SourceAdapterError('source_timeout', `source exceeded ${config.SOURCE_TIMEOUT_MS}ms`)), config.SOURCE_TIMEOUT_MS);
    try {
      const snapshot = await adapter.readSnapshot(generation, controller.signal);
      clearTimeout(timer);
      return { sourceKind: adapter.sourceKind, snapshot, status: snapshot.complete ? 'complete' : 'partial', latencyMs: Math.round(performance.now() - started), ...(snapshot.complete ? {} : { errorCode: 'source_partial', errorDetail: snapshot.diagnostics.map(({ detail }) => detail).join('; ') }) };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
    }
  }
  const code = lastError instanceof SourceAdapterError ? lastError.code : 'source_invalid';
  return { sourceKind: adapter.sourceKind, status: 'failed', errorCode: code, errorDetail: lastError instanceof Error ? lastError.message : 'source failed', latencyMs: Math.round(performance.now() - started) };
}

async function insertRecords(executor: DatabaseExecutor, tenantId: string, snapshotId: string, records: readonly SourceRecord[], hashes: WeakMap<SourceRecord, string>): Promise<Map<string, number>> {
  for (let index = 0; index < records.length; index += SOURCE_RECORD_BATCH_SIZE) {
    const batch = records.slice(index, index + SOURCE_RECORD_BATCH_SIZE).map((record) => ({
      source_kind: record.sourceKind,
      entity_kind: record.entityKind,
      source_id: record.sourceId,
      occurrence: record.occurrence,
      payload: record.payload,
      payload_hash: sourcePayloadHash(record, hashes),
      observed_at: record.observedAt
    }));
    await executor.query(`INSERT INTO source_records(tenant_id, snapshot_id, source_kind, entity_kind, source_id, occurrence, payload, payload_hash, observed_at)
      SELECT $1, $2, row.source_kind, row.entity_kind, row.source_id, row.occurrence, row.payload, row.payload_hash, row.observed_at::timestamptz
      FROM jsonb_to_recordset($3::jsonb) AS row(source_kind text, entity_kind text, source_id text, occurrence integer, payload jsonb, payload_hash text, observed_at text)
      ON CONFLICT (snapshot_id, entity_kind, source_id, occurrence) DO NOTHING`, [tenantId, snapshotId, JSON.stringify(batch)]);
  }
  const persisted = await executor.query<{ id: string; source_kind: SourceKind; entity_kind: string; source_id: string; ingested_at: string }>(
    'SELECT id, source_kind, entity_kind, source_id, ingested_at FROM source_records WHERE tenant_id = $1 AND snapshot_id = $2',
    [tenantId, snapshotId]
  );
  if (persisted.rows.some(({ ingested_at }) => !ingested_at)) throw new Error('ingested_at_missing');
  const recordIds = new Map(persisted.rows.map((row) => [`${row.source_kind}:${row.entity_kind}:${row.source_id}`, Number(row.id)]));
  const lineageRows: Array<Record<string, unknown>> = [];
  for (const record of records) {
    const sourceRecordId = recordIds.get(`${record.sourceKind}:${record.entityKind}:${record.sourceId}`);
    if (!sourceRecordId) throw new Error(`persisted_source_record_missing:${record.sourceKind}:${record.sourceId}`);
    for (const lineage of lineageForRecord(record)) {
      lineageRows.push({ source_record_id: sourceRecordId, field_path: lineage.fieldPath, raw_value: lineage.rawValue, normalized_value: lineage.normalizedValue, normalization_version: lineage.version, transformation_trace: lineage.trace, source_observed_at: record.observedAt });
      if (lineageRows.length >= LINEAGE_BATCH_SIZE) {
        await insertLineage(executor, tenantId, lineageRows.splice(0));
      }
    }
  }
  if (lineageRows.length) await insertLineage(executor, tenantId, lineageRows);
  return recordIds;
}

async function insertLineage(executor: DatabaseExecutor, tenantId: string, rows: readonly Record<string, unknown>[]): Promise<void> {
  await executor.query(`INSERT INTO field_observations(tenant_id, source_record_id, field_path, raw_value, normalized_value, normalization_version, transformation_trace, source_observed_at)
    SELECT $1, row.source_record_id, row.field_path, row.raw_value, row.normalized_value, row.normalization_version, row.transformation_trace, row.source_observed_at::timestamptz
    FROM jsonb_to_recordset($2::jsonb) AS row(source_record_id bigint, field_path text, raw_value jsonb, normalized_value jsonb, normalization_version text, transformation_trace text[], source_observed_at text)
    ON CONFLICT (source_record_id, field_path) DO NOTHING`, [tenantId, JSON.stringify(rows)]);
}

function fixtureSetFromSnapshots(snapshots: readonly SourceSnapshot[]): FixtureSet {
  const records = snapshots.flatMap(({ records: sourceRecords }) => sourceRecords);
  const fixtures: FixtureSet = { crmContacts: [], crmDeals: [], appStudents: [], appEnrollments: [], payments: [] };
  for (const { entityKind, payload } of records) {
    if (entityKind === 'contact') fixtures.crmContacts.push(crmContactSchema.parse(payload));
    else if (entityKind === 'deal') fixtures.crmDeals.push(crmDealSchema.parse(payload));
    else if (entityKind === 'student') fixtures.appStudents.push(appStudentSchema.parse(payload));
    else if (entityKind === 'enrollment') fixtures.appEnrollments.push(appEnrollmentSchema.parse(payload));
    else if (entityKind === 'payment') fixtures.payments.push(paymentSchema.parse(payload));
  }
  return fixtures;
}

async function persistProjection(executor: DatabaseExecutor, tenantId: string, fixtures: FixtureSet, recordIds: ReadonlyMap<string, number>): Promise<void> {
  const projection = buildCanonicalProjection(fixtures);
  for (let index = 0; index < projection.entities.length; index += PROJECTION_BATCH_SIZE) {
    const batch = projection.entities.slice(index, index + PROJECTION_BATCH_SIZE).map((entity) => ({ id: entity.id, entity_kind: entity.entityKind, display_name: entity.displayName, resolution_status: entity.resolutionStatus, match_method: entity.matchMethod, match_score_bp: entity.matchScoreBp, summary: entity.summary }));
    await executor.query(`INSERT INTO canonical_entities(id, tenant_id, entity_kind, display_name, resolution_status, match_method, match_score_bp, summary)
      SELECT row.id, $1, row.entity_kind, row.display_name, row.resolution_status, row.match_method, row.match_score_bp, row.summary
      FROM jsonb_to_recordset($2::jsonb) AS row(id text, entity_kind text, display_name text, resolution_status text, match_method text, match_score_bp integer, summary jsonb)
      ON CONFLICT (tenant_id, id) DO UPDATE SET entity_kind = EXCLUDED.entity_kind, display_name = EXCLUDED.display_name, resolution_status = EXCLUDED.resolution_status, match_method = EXCLUDED.match_method, match_score_bp = EXCLUDED.match_score_bp, summary = EXCLUDED.summary, updated_at = now()`, [tenantId, JSON.stringify(batch)]);
  }
  for (let index = 0; index < projection.households.length; index += PROJECTION_BATCH_SIZE) {
    const batch = projection.households.slice(index, index + PROJECTION_BATCH_SIZE);
    await executor.query(`INSERT INTO households(id, tenant_id, guardian_email_hash)
      SELECT row.id, $1, row.guardian_email_hash FROM jsonb_to_recordset($2::jsonb) AS row(id text, guardian_email_hash text)
      ON CONFLICT (tenant_id, id) DO UPDATE SET guardian_email_hash = EXCLUDED.guardian_email_hash`, [tenantId, JSON.stringify(batch.map(({ id, guardianEmailHash }) => ({ id, guardian_email_hash: guardianEmailHash })))]);
    const memberships = batch.flatMap(({ id, members }) => members.map((canonicalId) => ({ household_id: id, canonical_entity_id: canonicalId, evidence: { source: 'app.guardian_email' } })));
    await executor.query(`INSERT INTO household_memberships(tenant_id, household_id, canonical_entity_id, evidence)
      SELECT $1, row.household_id, row.canonical_entity_id, row.evidence FROM jsonb_to_recordset($2::jsonb) AS row(household_id text, canonical_entity_id text, evidence jsonb)
      ON CONFLICT DO NOTHING`, [tenantId, JSON.stringify(memberships)]);
  }
  const links = projection.links.flatMap((link) => {
    const recordId = recordIds.get(`${link.sourceKind}:${link.entityKind}:${link.sourceId}`);
    return recordId ? [{ canonical_entity_id: link.canonicalId, source_record_id: recordId, match_method: link.matchMethod, match_score_bp: link.matchScoreBp, evidence: link.evidence }] : [];
  });
  for (let index = 0; index < links.length; index += PROJECTION_BATCH_SIZE) {
    await executor.query(`INSERT INTO entity_links(tenant_id, canonical_entity_id, source_record_id, match_method, match_score_bp, evidence, rule_version)
      SELECT $1, row.canonical_entity_id, row.source_record_id, row.match_method, row.match_score_bp, row.evidence, 'identity-v1'
      FROM jsonb_to_recordset($2::jsonb) AS row(canonical_entity_id text, source_record_id bigint, match_method text, match_score_bp integer, evidence jsonb)
      ON CONFLICT (tenant_id, source_record_id) DO NOTHING`, [tenantId, JSON.stringify(links.slice(index, index + PROJECTION_BATCH_SIZE))]);
  }
}

async function persistInvariants(pool: DatabasePool, tenantId: string, syncRunId: string, generation: number, fixtures: FixtureSet, conflicts: readonly DetectedConflict[], availability: Record<SourceKind, Availability>, oscillationHoldThreshold: number): Promise<string> {
  const invariantRunId = stableUuid(`invariant:${tenantId}:${syncRunId}:${RULE_SET_VERSION}`);
  return inTransaction(pool, async (client) => {
    await client.query(`INSERT INTO invariant_runs(id, tenant_id, sync_run_id, rule_set_version, status, source_availability)
      VALUES ($1, $2, $3, $4, 'running', $5::jsonb) ON CONFLICT (id) DO NOTHING`, [invariantRunId, tenantId, syncRunId, RULE_SET_VERSION, JSON.stringify(availability)]);
    const conflictByRuleAndStudent = new Map<string, DetectedConflict>();
    for (const conflict of conflicts) {
      const studentRef = conflict.entity_refs.find((ref) => ref.startsWith('student:'));
      if (studentRef) conflictByRuleAndStudent.set(`${conflict.rule_id}:${studentRef}`, conflict);
    }
    const ruleIds = Array.from({ length: 14 }, (_, index) => `C${index + 1}`);
    const rows: Array<Record<string, unknown>> = [];
    const flush = async (): Promise<void> => {
      if (!rows.length) return;
      await client.query(`INSERT INTO invariant_results(tenant_id, invariant_run_id, rule_id, rule_version, entity_ref, verdict, evidence, conflict_key, reason)
        SELECT $1, $2, row.rule_id, '1.0.0', row.entity_ref, row.verdict, row.evidence, row.conflict_key, row.reason
        FROM jsonb_to_recordset($3::jsonb) AS row(rule_id text, entity_ref text, verdict text, evidence jsonb, conflict_key text, reason text)`, [tenantId, invariantRunId, JSON.stringify(rows.splice(0))]);
    };
    for (const student of fixtures.appStudents) {
      const entityRef = `student:${student.id}`;
      for (const ruleId of ruleIds) {
        const conflict = conflictByRuleAndStudent.get(`${ruleId}:${entityRef}`);
        rows.push({ rule_id: ruleId, entity_ref: entityRef, verdict: conflict ? 'fail' : 'pass', evidence: conflict?.evidence ?? {}, conflict_key: conflict?.conflict_key ?? null, reason: null });
        if (rows.length >= INVARIANT_RESULT_BATCH_SIZE) await flush();
      }
    }
    const studentConflictKeys = new Set(conflictByRuleAndStudent.values());
    for (const conflict of conflicts.filter((item) => !studentConflictKeys.has(item))) {
      rows.push({ rule_id: conflict.rule_id, entity_ref: conflict.entity_refs[0] ?? 'unknown', verdict: 'fail', evidence: conflict.evidence, conflict_key: conflict.conflict_key, reason: null });
    }
    await flush();
    const keys = conflicts.map(({ conflict_key }) => conflict_key);
    if (keys.length) await client.query(`UPDATE conflicts SET status = 'resolved', last_seen_at = now() WHERE tenant_id = $1 AND status = 'active' AND NOT (conflict_key = ANY($2::text[]))`, [tenantId, keys]);
    else await client.query(`UPDATE conflicts SET status = 'resolved', last_seen_at = now() WHERE tenant_id = $1 AND status = 'active'`, [tenantId]);
    for (let index = 0; index < conflicts.length; index += 500) {
      const batch = conflicts.slice(index, index + 500).map((conflict) => ({ id: conflict.conflict_key, conflict_key: conflict.conflict_key, rule_id: conflict.rule_id, rule_version: conflict.rule_version, type: conflict.type, entity_refs: conflict.entity_refs, sources_involved: conflict.sources_involved, disagreeing_fields: conflict.disagreeing_fields, expected_verdict: conflict.expected_verdict, evidence: conflict.evidence }));
      const held = await client.query<{ id: string; conflict_key: string; oscillation_count: number }>(`WITH hold_candidates AS (
          SELECT id FROM conflicts
          WHERE tenant_id = $1
            AND conflict_key = ANY(ARRAY(SELECT item->>'conflict_key' FROM jsonb_array_elements($2::jsonb) AS item))
            AND status = 'resolved'
            AND oscillation_count + 1 >= $4
          FOR UPDATE
        ), upserted AS (
          INSERT INTO conflicts(id, tenant_id, conflict_key, rule_id, rule_version, type, entity_refs, sources_involved, disagreeing_fields, expected_verdict, evidence, latest_generation)
          SELECT row.id, $1, row.conflict_key, row.rule_id, row.rule_version, row.type, row.entity_refs, row.sources_involved, row.disagreeing_fields, row.expected_verdict, row.evidence, $3
          FROM jsonb_to_recordset($2::jsonb) AS row(id text, conflict_key text, rule_id text, rule_version text, type text, entity_refs text[], sources_involved text[], disagreeing_fields text[], expected_verdict text, evidence jsonb)
          ON CONFLICT (tenant_id, conflict_key) DO UPDATE SET
            evidence = EXCLUDED.evidence,
            last_seen_at = now(),
            latest_generation = EXCLUDED.latest_generation,
            oscillation_count = CASE WHEN conflicts.status = 'resolved' THEN conflicts.oscillation_count + 1 ELSE conflicts.oscillation_count END,
            status = CASE
              WHEN conflicts.status = 'oscillation_hold' THEN 'oscillation_hold'
              WHEN conflicts.status = 'resolved' AND conflicts.oscillation_count + 1 >= $4 THEN 'oscillation_hold'
              ELSE 'active'
            END
          RETURNING id, conflict_key, status, oscillation_count
        )
        SELECT upserted.id, upserted.conflict_key, upserted.oscillation_count
        FROM upserted JOIN hold_candidates ON hold_candidates.id = upserted.id
        WHERE upserted.status = 'oscillation_hold'`, [tenantId, JSON.stringify(batch), generation, oscillationHoldThreshold]);
      for (const conflict of held.rows) {
        const metadata = { conflictKey: conflict.conflict_key, generation, oscillationCount: conflict.oscillation_count, threshold: oscillationHoldThreshold };
        await client.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
          VALUES ($1, $2, 'oscillation_hold', 'worker', $3, 'conflict', $4, $5::jsonb, $6)`, [randomUUID(), tenantId, syncRunId, conflict.id, JSON.stringify(metadata), sha256(stableStringify(metadata))]);
      }
    }
    const summary = { pass: fixtures.appStudents.length * 14 - conflictByRuleAndStudent.size, fail: conflicts.length, unchecked: 0, error: 0 };
    await client.query(`UPDATE invariant_runs SET status = 'complete', summary = $2::jsonb, completed_at = now() WHERE id = $1`, [invariantRunId, JSON.stringify(summary)]);
    return invariantRunId;
  });
}

export async function synchronize(pool: DatabasePool, adapters: readonly ReadOnlySourceAdapter[], config: AppConfig, request: SyncRequest): Promise<SyncResult> {
  const started = performance.now();
  const runId = stableUuid(`sync:${request.tenantId}:${request.idempotencyKey}`);
  const existing = await pool.query<{ status: string; summary: SyncResult }>('SELECT status, summary FROM sync_runs WHERE tenant_id = $1 AND idempotency_key = $2', [request.tenantId, request.idempotencyKey]);
  if (existing.rows[0]?.status === 'complete' && existing.rows[0].summary) return existing.rows[0].summary;
  await pool.query(`INSERT INTO sync_runs(id, tenant_id, request_id, idempotency_key, requested_generation, status, started_at)
    VALUES ($1, $2, $3, $4, $5, 'running', now())
    ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET status = 'running', started_at = COALESCE(sync_runs.started_at, now())`, [runId, request.tenantId, request.requestId, request.idempotencyKey, request.generation]);
  const outcomes = await Promise.all(adapters.map((adapter) => readBounded(adapter, request.generation, config)));
  const availability = Object.fromEntries(outcomes.map(({ sourceKind, status }) => [sourceKind, status])) as Record<SourceKind, Availability>;
  const payloadHashes = new WeakMap<SourceRecord, string>();
  const persistedOutcomes = await Promise.all(outcomes.map(async (outcome) => {
    return inTransaction(pool, async (client) => {
      const sourceRunId = stableUuid(`source-run:${runId}:${outcome.sourceKind}`);
      const snapshotId = stableUuid(`snapshot:${sourceRunId}:${request.generation}`);
      await client.query(`INSERT INTO source_runs(id, sync_run_id, tenant_id, source_kind, generation, status, accepted_count, rejected_count, latency_ms, error_code, error_detail, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        ON CONFLICT (sync_run_id, source_kind) DO UPDATE SET status = EXCLUDED.status, accepted_count = EXCLUDED.accepted_count, rejected_count = EXCLUDED.rejected_count, latency_ms = EXCLUDED.latency_ms, error_code = EXCLUDED.error_code, error_detail = EXCLUDED.error_detail, completed_at = now()`, [sourceRunId, runId, request.tenantId, outcome.sourceKind, request.generation, outcome.status, outcome.snapshot?.records.length ?? 0, outcome.snapshot?.rejectedCount ?? 0, outcome.latencyMs, outcome.errorCode ?? null, outcome.errorDetail ?? null]);
      if (!outcome.snapshot) return { outcome, snapshotId, sourceRecordIds: new Map<string, number>() };
      const snapshotHash = sha256(outcome.snapshot.records.map((record) => sourcePayloadHash(record, payloadHashes)).sort().join(''));
      await client.query(`INSERT INTO source_snapshots(id, source_run_id, tenant_id, source_kind, generation, adapter_version, schema_version, status, accepted_count, rejected_count, payload_hash, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        ON CONFLICT (tenant_id, source_kind, generation, source_run_id) DO UPDATE SET status = EXCLUDED.status, accepted_count = EXCLUDED.accepted_count, rejected_count = EXCLUDED.rejected_count, payload_hash = EXCLUDED.payload_hash, completed_at = now()`, [snapshotId, sourceRunId, request.tenantId, outcome.sourceKind, request.generation, outcome.snapshot.adapterVersion, outcome.snapshot.schemaVersion, outcome.status === 'complete' ? 'complete' : 'partial', outcome.snapshot.records.length, outcome.snapshot.rejectedCount, snapshotHash]);
      if (outcome.status !== 'complete') return { outcome, snapshotId, sourceRecordIds: new Map<string, number>() };
      const sourceRecordIds = await insertRecords(client, request.tenantId, snapshotId, outcome.snapshot.records, payloadHashes);
      return { outcome, snapshotId, sourceRecordIds };
    });
  }));
  const recordIds = new Map<string, number>();
  const completeSnapshotIds = new Map<SourceKind, string>();
  let acceptedRecords = 0;
  for (const { outcome, snapshotId, sourceRecordIds } of persistedOutcomes) {
    if (outcome.status !== 'complete' || !outcome.snapshot) continue;
    for (const [key, id] of sourceRecordIds) recordIds.set(key, id);
    completeSnapshotIds.set(outcome.sourceKind, snapshotId);
    acceptedRecords += outcome.snapshot.records.length;
  }
  const completeSnapshots = outcomes.flatMap(({ status, snapshot }) => status === 'complete' && snapshot ? [snapshot] : []);
  let conflictCount = 0;
  let mirrorHash = '';
  const allComplete = (['crm', 'app', 'payments'] as const).every((source) => availability[source] === 'complete');
  if (allComplete) {
    const fixtures = fixtureSetFromSnapshots(completeSnapshots);
    mirrorHash = sha256(completeSnapshots.flatMap(({ records }) => records.map((record) => sourcePayloadHash(record, payloadHashes))).sort().join(''));
    await inTransaction(pool, (client) => persistProjection(client, request.tenantId, fixtures, recordIds));
    const evaluation = evaluateInvariants(fixtures, availability);
    conflictCount = evaluation.conflicts.length;
    await persistInvariants(pool, request.tenantId, runId, request.generation, fixtures, evaluation.conflicts, availability, config.OSCILLATION_HOLD_THRESHOLD);
    await inTransaction(pool, async (client) => {
      for (const sourceKind of ['crm', 'app', 'payments'] as const) {
        const snapshotId = completeSnapshotIds.get(sourceKind);
        if (!snapshotId) throw new Error(`complete_snapshot_missing:${sourceKind}`);
        await client.query(`INSERT INTO active_snapshots(tenant_id, source_kind, snapshot_id) VALUES ($1, $2, $3)
          ON CONFLICT (tenant_id, source_kind) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id, activated_at = now()`, [request.tenantId, sourceKind, snapshotId]);
      }
    });
  } else {
    const invariantRunId = stableUuid(`invariant:${request.tenantId}:${runId}:${RULE_SET_VERSION}`);
    const unchecked = evaluateInvariants({ crmContacts: [], crmDeals: [], appStudents: [], appEnrollments: [], payments: [] }, availability).uncheckedRules;
    await pool.query(`INSERT INTO invariant_runs(id, tenant_id, sync_run_id, rule_set_version, status, source_availability, summary, completed_at)
      VALUES ($1, $2, $3, $4, 'partial', $5::jsonb, $6::jsonb, now()) ON CONFLICT (id) DO NOTHING`, [invariantRunId, request.tenantId, runId, RULE_SET_VERSION, JSON.stringify(availability), JSON.stringify({ pass: 0, fail: 0, unchecked: unchecked.length, error: 0, reasons: unchecked })]);
    if (unchecked.length) {
      await pool.query(`INSERT INTO invariant_results(tenant_id, invariant_run_id, rule_id, rule_version, entity_ref, verdict, evidence, conflict_key, reason)
        SELECT $1, $2, row.rule_id, '1.0.0', row.entity_ref, 'unchecked', '{}'::jsonb, NULL, row.reason
        FROM jsonb_to_recordset($3::jsonb) AS row(rule_id text, entity_ref text, reason text)`, [request.tenantId, invariantRunId, JSON.stringify(unchecked.map(({ ruleId, reason }) => ({ rule_id: ruleId, entity_ref: `rule:${ruleId}`, reason })))]);
    }
  }
  const status: SyncResult['status'] = allComplete ? 'complete' : completeSnapshots.length > 0 ? 'partial' : 'failed';
  const result: SyncResult = { runId, status, generation: request.generation, sourceAvailability: availability, acceptedRecords, conflicts: conflictCount, mirrorHash, durationMs: Math.round(performance.now() - started) };
  await pool.query(`UPDATE sync_runs SET status = $2, source_availability = $3::jsonb, summary = $4::jsonb, completed_at = now(), error_code = $5 WHERE id = $1`, [runId, status, JSON.stringify(availability), JSON.stringify(result), status === 'complete' ? null : 'source_incomplete']);
  await pool.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
    VALUES ($1, $2, 'sync_completed', 'worker', $3, 'sync_run', $4, $5::jsonb, $6)`, [randomUUID(), request.tenantId, request.requestId, runId, JSON.stringify({ status, generation: request.generation, acceptedRecords, conflictCount }), sha256(stableStringify({ runId, status, acceptedRecords, conflictCount }))]);
  return result;
}
