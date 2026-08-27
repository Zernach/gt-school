import { loadConfig } from '../../src/config.js';
import type { SourceKind } from '../../src/domain/fixture-types.js';
import { stableUuid } from '../../src/domain/stable.js';
import { synchronize, type SyncResult } from '../../src/ingestion/sync.js';
import type { DatabasePool } from '../../src/persistence/database.js';
import type { ReadOnlySourceAdapter, SourceRecord, SourceSnapshot } from '../../src/sources/adapter.js';
import { SourceAdapterError } from '../../src/sources/adapter.js';
import { makeContact, makeDeal, makeEnrollment, makePayment, makeStudent } from '../helpers/fixtures.js';

interface PersistedRecord {
  id: string;
  source_kind: SourceKind;
  entity_kind: string;
  source_id: string;
  snapshot_id: string;
}

interface PoolOptions {
  existing?: { status: string; summary: SyncResult };
  omitPersisted?: (record: PersistedRecord) => boolean;
  omitIngestedAt?: boolean;
  failQuery?: (sql: string) => Error | undefined;
  oscillationHolds?: Array<{ id: string; conflict_key: string; oscillation_count: number }>;
}

function makePool(options: PoolOptions = {}) {
  const statements: Array<{ sql: string; parameters: readonly unknown[] | undefined }> = [];
  const persisted: PersistedRecord[] = [];
  let nextId = 1;
  const handle = async (sql: string, parameters?: readonly unknown[]) => {
    statements.push({ sql, parameters });
    const failure = options.failQuery?.(sql);
    if (failure) throw failure;
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT status, summary FROM sync_runs')) {
      return { rows: options.existing ? [options.existing] : [], rowCount: options.existing ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO source_records')) {
      const snapshotId = String(parameters?.[1]);
      const rows = JSON.parse(String(parameters?.[2])) as Array<{ source_kind: SourceKind; entity_kind: string; source_id: string }>;
      for (const row of rows) {
        const candidate = { id: String(nextId), source_kind: row.source_kind, entity_kind: row.entity_kind, source_id: row.source_id, snapshot_id: snapshotId };
        nextId += 1;
        if (!options.omitPersisted?.(candidate)) persisted.push(candidate);
      }
      return { rows: [], rowCount: rows.length };
    }
    if (sql.includes('SELECT id, source_kind, entity_kind, source_id') && sql.includes('FROM source_records')) {
      const snapshotId = String(parameters?.[1]);
      const rows = persisted.filter((row) => row.snapshot_id === snapshotId).map(({ snapshot_id: persistedSnapshotId, ...row }) => {
        void persistedSnapshotId;
        return options.omitIngestedAt ? row : { ...row, ingested_at: '2026-01-15T12:00:00.000Z' };
      });
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('WITH hold_candidates AS')) {
      const rows = options.oscillationHolds ?? [];
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 1 };
  };
  const query = vi.fn(handle);
  const transactionClient = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => transactionClient) } as unknown as DatabasePool;
  return { pool, query, statements, persisted, transactionClient };
}

function sourceRecord(sourceKind: SourceKind, entityKind: string, sourceId: string, payload: Record<string, unknown>, occurrence = 1): SourceRecord {
  const observed = payload.updated_at ?? payload.occurred_at ?? payload.created_at;
  return {
    sourceKind,
    entityKind,
    sourceId,
    occurrence,
    payload,
    observedAt: typeof observed === 'string' ? observed : '2026-01-15T12:00:00.000Z'
  };
}

function snapshot(sourceKind: SourceKind, records: SourceRecord[], overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    sourceKind,
    generation: 3,
    schemaVersion: 'fixtures-v1',
    adapterVersion: `${sourceKind}-fixture-test-v1`,
    records,
    rejectedCount: 0,
    complete: true,
    latencyMs: 1,
    diagnostics: [],
    ...overrides
  };
}

function adapter(sourceSnapshot: SourceSnapshot, implementation?: ReadOnlySourceAdapter['readSnapshot']): ReadOnlySourceAdapter {
  return {
    sourceKind: sourceSnapshot.sourceKind,
    schemaVersion: sourceSnapshot.schemaVersion,
    adapterVersion: sourceSnapshot.adapterVersion,
    health: vi.fn(async () => ({ sourceKind: sourceSnapshot.sourceKind, ready: true, latencyMs: 1 })),
    readSnapshot: implementation ?? vi.fn(async () => sourceSnapshot)
  };
}

function cleanAdapters(options: { noDeal?: boolean; household?: boolean } = {}): ReadOnlySourceAdapter[] {
  const student = makeStudent(0, options.household ? { household_id: 'household-1' } : {});
  const contact = makeContact(0, student, options.household ? { household_id: 'household-1' } : {});
  const enrollment = makeEnrollment(0, student, options.noDeal ? { crm_deal_id: null } : {});
  return [
    adapter(snapshot('crm', [
      sourceRecord('crm', 'contact', contact.crm_id, contact),
      ...(options.noDeal ? [] : [sourceRecord('crm', 'deal', 'deal-0', makeDeal())])
    ])),
    adapter(snapshot('app', [
      sourceRecord('app', 'student', student.id, student),
      sourceRecord('app', 'enrollment', enrollment.id, enrollment)
    ])),
    adapter(snapshot('payments', [sourceRecord('payments', 'payment', 'payment-record-0', makePayment(0, student))]))
  ];
}

const config = loadConfig({
  NODE_ENV: 'test',
  SOURCE_TIMEOUT_MS: '50',
  SOURCE_RETRY_LIMIT: '2'
});
const request = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  generation: 3,
  idempotencyKey: 'sync-unit-fixture',
  requestId: 'request-sync-test'
};

afterEach(() => {
  vi.useRealTimers();
});

describe('complete sync', () => {
  it('returns a complete deterministic scorecard for all three sources', async () => {
    const { pool } = makePool();
    const result = await synchronize(pool, cleanAdapters(), config, request);
    expect(result).toMatchObject({
      runId: stableUuid(`sync:${request.tenantId}:${request.idempotencyKey}`),
      status: 'complete',
      generation: 3,
      sourceAvailability: { crm: 'complete', app: 'complete', payments: 'complete' },
      acceptedRecords: 5,
      conflicts: 0
    });
    expect(result.mirrorHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reads all adapters concurrently with the requested generation and a signal', async () => {
    const adapters = cleanAdapters();
    const { pool } = makePool();
    await synchronize(pool, adapters, config, request);
    for (const source of adapters) {
      expect(source.readSnapshot).toHaveBeenCalledOnce();
      expect(source.readSnapshot).toHaveBeenCalledWith(3, expect.any(AbortSignal));
    }
  });

  it('persists a running sync before reading a source', async () => {
    const adapters = cleanAdapters();
    const firstRead = adapters[0]!.readSnapshot as ReturnType<typeof vi.fn>;
    const { pool, statements } = makePool();
    await synchronize(pool, adapters, config, request);
    const syncInsert = statements.findIndex(({ sql }) => sql.includes('INSERT INTO sync_runs'));
    expect(syncInsert).toBeGreaterThan(0);
    expect(firstRead).toHaveBeenCalledOnce();
  });

  it('records one terminal source run and snapshot per adapter', async () => {
    const { pool, statements } = makePool();
    await synchronize(pool, cleanAdapters(), config, request);
    expect(statements.filter(({ sql }) => sql.includes('INSERT INTO source_runs'))).toHaveLength(3);
    expect(statements.filter(({ sql }) => sql.includes('INSERT INTO source_snapshots'))).toHaveLength(3);
    expect(statements.filter(({ sql }) => sql.includes('INSERT INTO active_snapshots'))).toHaveLength(3);
  });

  it('mirrors every complete source record with a stable payload hash', async () => {
    const { pool, statements, persisted } = makePool();
    await synchronize(pool, cleanAdapters(), config, request);
    expect(persisted).toHaveLength(5);
    const inserts = statements.filter(({ sql }) => sql.includes('INSERT INTO source_records'));
    const rows = inserts.flatMap(({ parameters }) => JSON.parse(String(parameters?.[2])) as Array<{ payload_hash: string }>);
    expect(rows).toHaveLength(5);
    expect(rows.every(({ payload_hash }) => /^[0-9a-f]{64}$/u.test(payload_hash))).toBe(true);
  });

  it('persists material-field lineage for every mirrored record', async () => {
    const { pool, statements, persisted } = makePool();
    await synchronize(pool, cleanAdapters(), config, request);
    const lineage = statements.filter(({ sql }) => sql.includes('INSERT INTO field_observations'));
    const rows = lineage.flatMap(({ parameters }) => JSON.parse(String(parameters?.[1])) as Array<{ source_record_id: number; normalization_version: string; source_observed_at: string }>);
    expect(rows).toHaveLength(37);
    expect(new Set(rows.map(({ source_record_id }) => source_record_id)).size).toBe(persisted.length);
    expect(rows.every(({ normalization_version }) => normalization_version === 'normalization-v1')).toBe(true);
    expect(rows.every(({ source_observed_at }) => typeof source_observed_at === 'string')).toBe(true);
  });

  it('requires an ingest timestamp on every mirrored source record', async () => {
    const { pool, statements } = makePool();
    await synchronize(pool, cleanAdapters(), config, request);
    expect(statements.some(({ sql }) => sql.startsWith('SELECT id, source_kind, entity_kind, source_id, ingested_at FROM source_records'))).toBe(true);
  });

  it('fails closed when a mirrored record is missing ingested_at', async () => {
    const { pool } = makePool({ omitIngestedAt: true });
    await expect(synchronize(pool, cleanAdapters(), config, request)).rejects.toThrow('ingested_at_missing');
  });

  it('persists a unified canonical entity and all five source links', async () => {
    const { pool, statements } = makePool();
    await synchronize(pool, cleanAdapters(), config, request);
    const entity = statements.find(({ sql }) => sql.includes('INSERT INTO canonical_entities'))!;
    const entities = JSON.parse(String(entity.parameters?.[1])) as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ entity_kind: 'student', resolution_status: 'linked', match_method: 'hard_external_id' });
    const link = statements.find(({ sql }) => sql.includes('INSERT INTO entity_links'))!;
    expect(JSON.parse(String(link.parameters?.[1]))).toHaveLength(5);
  });

  it('persists household membership without changing sibling identity', async () => {
    const { pool, statements } = makePool();
    await synchronize(pool, cleanAdapters({ household: true }), config, request);
    const households = statements.find(({ sql }) => sql.includes('INSERT INTO households'))!;
    const memberships = statements.find(({ sql }) => sql.includes('INSERT INTO household_memberships'))!;
    expect(JSON.parse(String(households.parameters?.[1]))).toHaveLength(1);
    expect(JSON.parse(String(memberships.parameters?.[1]))).toHaveLength(1);
  });

  it('records pass/fail status per rule and student', async () => {
    const { pool, statements } = makePool();
    await synchronize(pool, cleanAdapters(), config, request);
    const resultInsert = statements.find(({ sql }) => sql.includes('INSERT INTO invariant_results'))!;
    const rows = JSON.parse(String(resultInsert.parameters?.[2])) as Array<{ rule_id: string; verdict: string }>;
    expect(rows).toHaveLength(14);
    expect(rows.map(({ rule_id }) => rule_id)).toEqual(Array.from({ length: 14 }, (_, index) => `C${index + 1}`));
    expect(rows.every(({ verdict }) => verdict === 'pass')).toBe(true);
  });

  it('completes the invariant run with an exact summary', async () => {
    const { pool, statements } = makePool();
    await synchronize(pool, cleanAdapters(), config, request);
    const completion = statements.find(({ sql }) => sql.includes("UPDATE invariant_runs SET status = 'complete'"))!;
    expect(JSON.parse(String(completion.parameters?.[1]))).toEqual({ pass: 14, fail: 0, unchecked: 0, error: 0 });
  });

  it('stores a terminal sync summary and null error code', async () => {
    const { pool, statements } = makePool();
    const result = await synchronize(pool, cleanAdapters(), config, request);
    const completion = statements.find(({ sql }) => sql.includes('UPDATE sync_runs SET status'))!;
    expect(completion.parameters?.[1]).toBe('complete');
    expect(JSON.parse(String(completion.parameters?.[2]))).toEqual({ crm: 'complete', app: 'complete', payments: 'complete' });
    expect(JSON.parse(String(completion.parameters?.[3]))).toEqual(result);
    expect(completion.parameters?.[4]).toBeNull();
  });

  it('writes a privacy-safe structured sync audit event', async () => {
    const { pool, statements } = makePool();
    await synchronize(pool, cleanAdapters(), config, request);
    const audit = statements.find(({ sql }) => sql.includes("'sync_completed'"))!;
    expect(audit.parameters?.[1]).toBe(request.tenantId);
    expect(audit.parameters?.[2]).toBe(request.requestId);
    expect(JSON.parse(String(audit.parameters?.[4]))).toEqual({ status: 'complete', generation: 3, acceptedRecords: 5, conflictCount: 0 });
    expect(audit.parameters?.[5]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('is deterministic for identical source records and idempotency key', async () => {
    const first = await synchronize(makePool().pool, cleanAdapters(), config, request);
    const second = await synchronize(makePool().pool, cleanAdapters(), config, request);
    expect({ ...second, durationMs: 0 }).toEqual({ ...first, durationMs: 0 });
  });
});

describe('conflict persistence', () => {
  it('detects and stores a paid-but-no-deal conflict', async () => {
    const { pool, statements } = makePool();
    const result = await synchronize(pool, cleanAdapters({ noDeal: true }), config, request);
    expect(result.conflicts).toBe(1);
    const invariantRows = statements
      .filter(({ sql }) => sql.includes('INSERT INTO invariant_results'))
      .flatMap(({ parameters }) => JSON.parse(String(parameters?.[2])) as Array<{ rule_id: string; verdict: string; conflict_key: string | null }>);
    expect(invariantRows.filter(({ verdict }) => verdict === 'fail')).toEqual([expect.objectContaining({ rule_id: 'C1', conflict_key: expect.stringMatching(/^conflict_/u) })]);
    const conflicts = statements.find(({ sql }) => sql.includes('INSERT INTO conflicts'))!;
    expect(JSON.parse(String(conflicts.parameters?.[1]))).toEqual([expect.objectContaining({ rule_id: 'C1', type: 'paid_but_no_deal', expected_verdict: 'fail' })]);
  });

  it('resolves active conflicts missing from the new complete set', async () => {
    const { pool, statements } = makePool();
    await synchronize(pool, cleanAdapters({ noDeal: true }), config, request);
    const update = statements.find(({ sql }) => sql.includes("UPDATE conflicts SET status = 'resolved'"));
    expect(update).toBeDefined();
    expect(update?.parameters?.[1]).toEqual([expect.stringMatching(/^conflict_/u)]);
  });

  it('resolves every active tenant conflict when a complete run is clean', async () => {
    const { pool, statements } = makePool();
    await synchronize(pool, cleanAdapters(), config, request);
    const update = statements.find(({ sql }) => sql.includes("UPDATE conflicts SET status = 'resolved'"));
    expect(update?.sql).toContain("tenant_id = $1 AND status = 'active'");
    expect(update?.sql).not.toContain('NOT (conflict_key');
    expect(update?.parameters).toEqual([request.tenantId]);
  });

  it('enforces and audits the configured oscillation threshold transactionally', async () => {
    const conflictId = 'conflict_oscillation_fixture';
    const { pool, statements } = makePool({ oscillationHolds: [{ id: conflictId, conflict_key: conflictId, oscillation_count: 3 }] });
    await synchronize(pool, cleanAdapters({ noDeal: true }), { ...config, OSCILLATION_HOLD_THRESHOLD: 3 }, request);
    const upsert = statements.find(({ sql }) => sql.includes('WITH hold_candidates AS'))!;
    expect(upsert.sql).toContain("conflicts.status = 'resolved' AND conflicts.oscillation_count + 1 >= $4");
    expect(upsert.sql).toContain("THEN 'oscillation_hold'");
    expect(upsert.parameters?.[3]).toBe(3);
    const audit = statements.find(({ sql }) => sql.includes("'oscillation_hold', 'worker'"))!;
    expect(audit.parameters?.[1]).toBe(request.tenantId);
    expect(audit.parameters?.[2]).toBe(stableUuid(`sync:${request.tenantId}:${request.idempotencyKey}`));
    expect(audit.parameters?.[3]).toBe(conflictId);
    expect(JSON.parse(String(audit.parameters?.[4]))).toEqual({ conflictKey: conflictId, generation: 3, oscillationCount: 3, threshold: 3 });
    expect(audit.parameters?.[5]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('records non-student conflicts as independent failing invariant rows', async () => {
    const student = makeStudent();
    const orphan = makePayment(9, makeStudent(9), { external_ref: undefined, student_name: undefined, student_dob: undefined, payer_email: 'orphan@example.test' });
    const adapters = cleanAdapters();
    adapters[2] = adapter(snapshot('payments', [
      sourceRecord('payments', 'payment', 'payment-record-0', makePayment(0, student)),
      sourceRecord('payments', 'payment', orphan.fixture_record_id, orphan)
    ]));
    const { pool, statements } = makePool();
    const result = await synchronize(pool, adapters, config, request);
    expect(result.conflicts).toBe(1);
    const invariantRows = statements
      .filter(({ sql }) => sql.includes('INSERT INTO invariant_results'))
      .flatMap(({ parameters }) => JSON.parse(String(parameters?.[2])) as Array<{ rule_id: string; entity_ref: string; verdict: string }>);
    expect(invariantRows).toContainEqual(expect.objectContaining({ rule_id: 'C2', entity_ref: `payment:${orphan.fixture_record_id}`, verdict: 'fail' }));
  });
});

describe('partial and failed sources', () => {
  it('persists partial-run evidence without activating a mixed source set', async () => {
    const adapters = cleanAdapters();
    const crm = await adapters[0]!.readSnapshot(3);
    adapters[0] = adapter({ ...crm, complete: false, rejectedCount: 1, diagnostics: [{ code: 'partial', detail: 'last page unavailable' }] });
    const { pool, statements } = makePool();
    const result = await synchronize(pool, adapters, config, request);
    expect(result).toMatchObject({ status: 'partial', sourceAvailability: { crm: 'partial', app: 'complete', payments: 'complete' }, acceptedRecords: 3, conflicts: 0, mirrorHash: '' });
    const crmSourceRun = statements.find(({ sql, parameters }) => sql.includes('INSERT INTO source_runs') && parameters?.[3] === 'crm')!;
    expect(crmSourceRun.parameters?.slice(5, 11)).toEqual(['partial', 2, 1, expect.any(Number), 'source_partial', 'last page unavailable']);
    expect(statements.filter(({ sql }) => sql.includes('INSERT INTO active_snapshots'))).toHaveLength(0);
  });

  it('marks dependent invariant rules unchecked rather than passing', async () => {
    const adapters = cleanAdapters();
    const crm = await adapters[0]!.readSnapshot(3);
    adapters[0] = adapter({ ...crm, complete: false, diagnostics: [{ code: 'partial', detail: 'incomplete' }] });
    const { pool, statements } = makePool();
    await synchronize(pool, adapters, config, request);
    const invariant = statements.find(({ sql }) => sql.includes("'partial'") && sql.includes('INSERT INTO invariant_runs'))!;
    const summary = JSON.parse(String(invariant.parameters?.[5])) as { pass: number; fail: number; unchecked: number; reasons: Array<{ ruleId: string; reason: string }> };
    expect(summary.pass).toBe(0);
    expect(summary.fail).toBe(0);
    expect(summary.unchecked).toBeGreaterThan(0);
    expect(summary.reasons.some(({ reason }) => reason.includes('crm'))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO conflicts'))).toBe(false);
    const uncheckedInsert = statements.find(({ sql }) => sql.includes('INSERT INTO invariant_results') && sql.includes("'unchecked'"));
    expect(uncheckedInsert).toBeDefined();
    const uncheckedRows = JSON.parse(String(uncheckedInsert?.parameters?.[2])) as Array<{ entity_ref: string; reason: string }>;
    expect(uncheckedRows.length).toBeGreaterThan(0);
    expect(uncheckedRows.every(({ entity_ref, reason }) => entity_ref.startsWith('rule:') && reason.includes('source_unavailable'))).toBe(true);
  });

  it('persists structured failure code and detail after bounded retries', async () => {
    const failingCrm = cleanAdapters()[0]!;
    failingCrm.readSnapshot = vi.fn(async () => { throw new SourceAdapterError('source_5xx', 'fixture upstream unavailable'); });
    const adapters = [failingCrm, ...cleanAdapters().slice(1)];
    const { pool, statements } = makePool();
    const result = await synchronize(pool, adapters, config, request);
    expect(result).toMatchObject({ status: 'partial', sourceAvailability: { crm: 'failed', app: 'complete', payments: 'complete' }, acceptedRecords: 3 });
    expect(failingCrm.readSnapshot).toHaveBeenCalledTimes(3);
    const crmRun = statements.find(({ sql, parameters }) => sql.includes('INSERT INTO source_runs') && parameters?.[3] === 'crm')!;
    expect(crmRun.parameters?.slice(5, 11)).toEqual(['failed', 0, 0, expect.any(Number), 'source_5xx', 'fixture upstream unavailable']);
  });

  it('classifies an unknown Error as source_invalid', async () => {
    const failing = cleanAdapters()[0]!;
    failing.readSnapshot = vi.fn(async () => { throw new Error('unexpected adapter error'); });
    const { pool, statements } = makePool();
    await synchronize(pool, [failing, ...cleanAdapters().slice(1)], { ...config, SOURCE_RETRY_LIMIT: 0 }, request);
    const run = statements.find(({ sql, parameters }) => sql.includes('INSERT INTO source_runs') && parameters?.[3] === 'crm')!;
    expect(run.parameters?.[9]).toBe('source_invalid');
    expect(run.parameters?.[10]).toBe('unexpected adapter error');
  });

  it('uses a safe generic detail for a non-Error rejection', async () => {
    const failing = cleanAdapters()[0]!;
    failing.readSnapshot = vi.fn(async () => Promise.reject('offline'));
    const { pool, statements } = makePool();
    await synchronize(pool, [failing, ...cleanAdapters().slice(1)], { ...config, SOURCE_RETRY_LIMIT: 0 }, request);
    const run = statements.find(({ sql, parameters }) => sql.includes('INSERT INTO source_runs') && parameters?.[3] === 'crm')!;
    expect(run.parameters?.[9]).toBe('source_invalid');
    expect(run.parameters?.[10]).toBe('source failed');
  });

  it('retries a transient source and activates the full set after recovery', async () => {
    const crmSnapshot = await cleanAdapters()[0]!.readSnapshot(3);
    const readSnapshot = vi.fn()
      .mockRejectedValueOnce(new SourceAdapterError('source_5xx', 'temporary'))
      .mockResolvedValueOnce(crmSnapshot);
    const transient = adapter(crmSnapshot, readSnapshot);
    const { pool } = makePool();
    const result = await synchronize(pool, [transient, ...cleanAdapters().slice(1)], config, request);
    expect(result.status).toBe('complete');
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });

  it('bounds a hung source and retries only to the configured limit', async () => {
    vi.useFakeTimers();
    const base = await cleanAdapters()[0]!.readSnapshot(3);
    const readSnapshot = vi.fn((_generation: number, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const hung = adapter(base, readSnapshot);
    const { pool } = makePool();
    const run = synchronize(pool, [hung, ...cleanAdapters().slice(1)], { ...config, SOURCE_TIMEOUT_MS: 5, SOURCE_RETRY_LIMIT: 1 }, request);
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.sourceAvailability.crm).toBe('failed');
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns failed when no complete source snapshot is available', async () => {
    const adapters = cleanAdapters().map((source) => ({
      ...source,
      readSnapshot: vi.fn(async () => { throw new SourceAdapterError('source_5xx', `${source.sourceKind} unavailable`); })
    }));
    const { pool, statements } = makePool();
    const result = await synchronize(pool, adapters, { ...config, SOURCE_RETRY_LIMIT: 0 }, request);
    expect(result).toMatchObject({
      status: 'failed',
      sourceAvailability: { crm: 'failed', app: 'failed', payments: 'failed' },
      acceptedRecords: 0,
      conflicts: 0,
      mirrorHash: ''
    });
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO source_snapshots'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO active_snapshots'))).toBe(false);
    const completion = statements.find(({ sql }) => sql.includes('UPDATE sync_runs SET status'))!;
    expect(completion.parameters?.[4]).toBe('source_incomplete');
  });

  it('returns partial when the adapter set itself omits a required source', async () => {
    const { pool } = makePool();
    const result = await synchronize(pool, cleanAdapters().slice(0, 2), config, request);
    expect(result.status).toBe('partial');
    expect(result.sourceAvailability.payments).toBeUndefined();
  });
});

describe('batching and failure atomicity', () => {
  it('batches more than 5,000 source records and more than 10,000 lineage rows', async () => {
    const contacts = Array.from({ length: 5_001 }, (_, index) => {
      const student = makeStudent(index);
      const contact = makeContact(index, student);
      return sourceRecord('crm', 'contact', contact.crm_id, contact);
    });
    const crm = adapter(snapshot('crm', contacts));
    const failed = (sourceKind: 'app' | 'payments'): ReadOnlySourceAdapter => ({
      sourceKind,
      schemaVersion: 'fixtures-v1',
      adapterVersion: 'failed-test',
      health: vi.fn(async () => ({ sourceKind, ready: false, latencyMs: 0 })),
      readSnapshot: vi.fn(async () => { throw new SourceAdapterError('source_5xx', 'unavailable'); })
    });
    const { pool, statements } = makePool();
    const result = await synchronize(pool, [crm, failed('app'), failed('payments')], { ...config, SOURCE_RETRY_LIMIT: 0 }, request);
    expect(result).toMatchObject({ status: 'partial', acceptedRecords: 5_001 });
    expect(statements.filter(({ sql }) => sql.includes('INSERT INTO source_records'))).toHaveLength(2);
    expect(statements.filter(({ sql }) => sql.includes('INSERT INTO field_observations')).length).toBeGreaterThan(1);
  });

  it('fails closed if a just-inserted source record cannot be read back', async () => {
    const { pool, transactionClient } = makePool({ omitPersisted: ({ source_kind }) => source_kind === 'crm' });
    await expect(synchronize(pool, cleanAdapters(), config, request)).rejects.toThrow('persisted_source_record_missing:crm:crm-0');
    expect(transactionClient.release).not.toHaveBeenCalled();
  });

  it('propagates a persistence failure rather than reporting a successful sync', async () => {
    const { pool, statements } = makePool({ failQuery: (sql) => sql.includes('INSERT INTO source_records') ? new Error('mirror insert failed') : undefined });
    await expect(synchronize(pool, cleanAdapters(), config, request)).rejects.toThrow('mirror insert failed');
    expect(statements.some(({ sql }) => sql.includes('UPDATE sync_runs SET status'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes("'sync_completed'"))).toBe(false);
  });

  it('rejects a complete snapshot whose payload violates the source schema', async () => {
    const adapters = cleanAdapters();
    adapters[0] = adapter(snapshot('crm', [sourceRecord('crm', 'contact', 'bad', { crm_id: 'bad' })]));
    const { pool } = makePool();
    await expect(synchronize(pool, adapters, config, request)).rejects.toThrow();
  });
});

describe('sync idempotency', () => {
  it('returns a completed durable result without re-reading sources', async () => {
    const summary: SyncResult = {
      runId: 'existing-run',
      status: 'complete',
      generation: 3,
      sourceAvailability: { crm: 'complete', app: 'complete', payments: 'complete' },
      acceptedRecords: 120_000,
      conflicts: 3050,
      mirrorHash: 'existing-hash',
      durationMs: 12_345
    };
    const adapters = cleanAdapters();
    const { pool, statements } = makePool({ existing: { status: 'complete', summary } });
    await expect(synchronize(pool, adapters, config, request)).resolves.toEqual(summary);
    expect(adapters.every((source) => !vi.mocked(source.readSnapshot).mock.calls.length)).toBe(true);
    expect(statements).toHaveLength(1);
  });

  it('replays a previously partial sync instead of treating it as complete', async () => {
    const partial: SyncResult = {
      runId: 'partial-run',
      status: 'partial',
      generation: 3,
      sourceAvailability: { crm: 'partial', app: 'complete', payments: 'complete' },
      acceptedRecords: 3,
      conflicts: 0,
      mirrorHash: '',
      durationMs: 10
    };
    const adapters = cleanAdapters();
    const { pool } = makePool({ existing: { status: 'partial', summary: partial } });
    const result = await synchronize(pool, adapters, config, request);
    expect(result.status).toBe('complete');
    expect(adapters.every((source) => vi.mocked(source.readSnapshot).mock.calls.length === 1)).toBe(true);
  });
});
