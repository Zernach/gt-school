import { loadConfig } from '../../src/config.js';
import type { DetectedConflict } from '../../src/domain/fixture-types.js';
import { buildConflict } from '../../src/domain/invariants.js';
import type { DatabasePool } from '../../src/persistence/database.js';
import type { ReconcilerProvider } from '../../src/reconciliation/provider.js';
import { reconcileConflicts } from '../../src/reconciliation/reconcile.js';
import {
  ensureSpendRun,
  markProviderCallStarted,
  reserveProviderCost,
  settleProviderCost
} from '../../src/reconciliation/spend-ledger.js';

vi.mock('../../src/reconciliation/spend-ledger.js', () => ({
  ensureSpendRun: vi.fn(),
  markProviderCallStarted: vi.fn(),
  reserveProviderCost: vi.fn(),
  settleProviderCost: vi.fn()
}));

const mockedEnsureSpendRun = vi.mocked(ensureSpendRun);
const mockedMarkProviderCallStarted = vi.mocked(markProviderCallStarted);
const mockedReserveProviderCost = vi.mocked(reserveProviderCost);
const mockedSettleProviderCost = vi.mocked(settleProviderCost);

interface ConflictRow extends DetectedConflict {
  id: string;
}

interface PoolOptions {
  acquired?: boolean;
  conflicts?: ConflictRow[];
  hashes?: string[][];
  existingProposal?: (fingerprint: string, call: number) => boolean;
  proposalInsertRowCount?: number;
  failQuery?: (sql: string) => Error | undefined;
}

function conflict(type: DetectedConflict['type'] = 'paid_but_no_deal', suffix = 'one'): ConflictRow {
  return {
    id: `database-conflict-${suffix}`,
    ...buildConflict(type, [`student:${suffix}`, `payment:${suffix}`], ['app', 'crm', 'payments'], type === 'sensitive_field_only_fix' ? ['billing_owner_email'] : ['crm_deal_id'], { fixture: suffix })
  };
}

function makePool(options: PoolOptions = {}) {
  const statements: Array<{ scope: 'pool' | 'lock' | 'transaction'; sql: string; parameters: readonly unknown[] | undefined }> = [];
  let hashCall = 0;
  let existingCall = 0;
  const handle = async (scope: 'pool' | 'transaction', sql: string, parameters?: readonly unknown[]) => {
    statements.push({ scope, sql, parameters });
    const failure = options.failQuery?.(sql);
    if (failure) throw failure;
    if (sql.includes('SELECT records.payload_hash')) {
      const hashes = options.hashes?.[hashCall] ?? options.hashes?.[0] ?? ['hash-a', 'hash-b'];
      hashCall += 1;
      return { rows: hashes.map((payload_hash) => ({ payload_hash })), rowCount: hashes.length };
    }
    if (sql.includes("FROM conflicts WHERE tenant_id = $1 AND status = 'active'")) {
      const rows = options.conflicts ?? [];
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT id FROM proposals')) {
      const exists = options.existingProposal?.(String(parameters?.[1]), existingCall) ?? false;
      existingCall += 1;
      return { rows: exists ? [{ id: 'existing-proposal' }] : [], rowCount: exists ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO proposals')) {
      const rowCount = options.proposalInsertRowCount ?? 1;
      return { rows: rowCount ? [{ id: parameters?.[0] }] : [], rowCount };
    }
    return { rows: [], rowCount: 1 };
  };
  const poolQuery = vi.fn((sql: string, parameters?: readonly unknown[]) => handle('pool', sql, parameters));
  const transactionQuery = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      statements.push({ scope: 'transaction', sql, parameters });
      return { rows: [], rowCount: 0 };
    }
    return handle('transaction', sql, parameters);
  });
  const lockQuery = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    statements.push({ scope: 'lock', sql, parameters });
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: options.acquired ?? true }], rowCount: 1 };
    return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
  });
  const lockClient = { query: lockQuery, release: vi.fn() };
  const transactionClient = { query: transactionQuery, release: vi.fn() };
  let connection = 0;
  const connect = vi.fn(async () => {
    const client = connection === 0 ? lockClient : transactionClient;
    connection += 1;
    return client;
  });
  const pool = { query: poolQuery, connect } as unknown as DatabasePool;
  return { pool, poolQuery, lockClient, transactionClient, statements };
}

function provider(overrides: Partial<ReconcilerProvider> = {}): ReconcilerProvider {
  return {
    mode: 'local',
    model: 'test-provider-v1',
    maximumCallCostMicrocents: 10n,
    propose: vi.fn(async (detected, action) => ({
      actionFingerprint: action.fingerprint,
      summary: `Review ${detected.conflict_key}`,
      evidenceRefs: detected.entity_refs,
      inputTokens: 100,
      outputTokens: 25,
      actualCostMicrocents: 2
    })),
    ...overrides
  };
}

const config = loadConfig({
  NODE_ENV: 'test',
  DAILY_SPEND_CAP_MICROCENTS: '1000',
  PER_RUN_SPEND_CAP_MICROCENTS: '500',
  SOURCE_TIMEOUT_MS: '50'
});
const request = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  jobId: '11111111-1111-4111-8111-111111111111',
  requestId: 'request-reconcile-test'
};

beforeEach(() => {
  mockedEnsureSpendRun.mockReset().mockResolvedValue('spend-run-1');
  mockedMarkProviderCallStarted.mockReset().mockResolvedValue();
  mockedReserveProviderCost.mockReset().mockResolvedValue({ allowed: true, reservationId: 'reservation-1' });
  mockedSettleProviderCost.mockReset().mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tenant reconcile lock', () => {
  it('fails fast when another reconcile owns the tenant lock', async () => {
    const { pool, lockClient } = makePool({ acquired: false });
    await expect(reconcileConflicts(pool, config, provider(), request)).rejects.toThrow('reconcile_already_running');
    expect(lockClient.query).toHaveBeenCalledOnce();
    expect(lockClient.release).toHaveBeenCalledOnce();
    expect(mockedEnsureSpendRun).not.toHaveBeenCalled();
  });

  it('uses a tenant-scoped advisory lock key', async () => {
    const { pool, lockClient } = makePool();
    await reconcileConflicts(pool, config, provider(), request);
    expect(lockClient.query).toHaveBeenNthCalledWith(1, 'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [`keystone-reconcile:${request.tenantId}`]);
  });

  it('always unlocks and releases after a successful run', async () => {
    const { pool, lockClient } = makePool();
    await reconcileConflicts(pool, config, provider(), request);
    expect(lockClient.query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock(hashtext($1))', [`keystone-reconcile:${request.tenantId}`]);
    expect(lockClient.release).toHaveBeenCalledOnce();
  });

  it('always unlocks and releases after an unexpected query failure', async () => {
    const { pool, lockClient } = makePool({ failQuery: (sql) => sql.includes('FROM conflicts') ? new Error('conflict store unavailable') : undefined });
    await expect(reconcileConflicts(pool, config, provider(), request)).rejects.toThrow('conflict store unavailable');
    expect(lockClient.query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock(hashtext($1))', [`keystone-reconcile:${request.tenantId}`]);
    expect(lockClient.release).toHaveBeenCalledOnce();
  });
});

describe('empty reconciliation', () => {
  it('completes with an explicit zero scorecard', async () => {
    const { pool } = makePool();
    const result = await reconcileConflicts(pool, config, provider(), request);
    expect(result).toMatchObject({
      status: 'complete',
      conflictCount: 0,
      proposalsCreated: 0,
      proposalsDeduplicated: 0,
      providerCalls: 0
    });
    expect(result.sourceMirrorHashBefore).toBe(result.sourceMirrorHashAfter);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('creates a spend run even when no conflict exists', async () => {
    const { pool } = makePool();
    await reconcileConflicts(pool, config, provider(), request);
    expect(mockedEnsureSpendRun).toHaveBeenCalledWith(pool, {
      tenantId: request.tenantId,
      jobId: request.jobId,
      requestId: request.requestId,
      dailyCap: 1000n,
      runCap: 500n
    });
  });

  it('does not reserve money or call a provider without conflicts', async () => {
    const reconcileProvider = provider();
    const { pool } = makePool();
    await reconcileConflicts(pool, config, reconcileProvider, request);
    expect(mockedReserveProviderCost).not.toHaveBeenCalled();
    expect(reconcileProvider.propose).not.toHaveBeenCalled();
  });
});

describe('proposal deduplication before spend', () => {
  it('deduplicates an existing proposal before a reservation or provider call', async () => {
    const row = conflict();
    const reconcileProvider = provider();
    const { pool } = makePool({ conflicts: [row], existingProposal: () => true });
    const result = await reconcileConflicts(pool, config, reconcileProvider, request);
    expect(result).toMatchObject({ status: 'complete', conflictCount: 1, proposalsCreated: 0, proposalsDeduplicated: 1, providerCalls: 0 });
    expect(mockedReserveProviderCost).not.toHaveBeenCalled();
    expect(reconcileProvider.propose).not.toHaveBeenCalled();
  });

  it('deduplicates a reservation race without calling the provider', async () => {
    mockedReserveProviderCost.mockResolvedValue({ allowed: false, reservationId: 'existing-reservation', reason: 'duplicate' });
    const reconcileProvider = provider();
    const { pool } = makePool({ conflicts: [conflict()] });
    const result = await reconcileConflicts(pool, config, reconcileProvider, request);
    expect(result).toMatchObject({ status: 'complete', proposalsCreated: 0, proposalsDeduplicated: 1, providerCalls: 0 });
    expect(mockedMarkProviderCallStarted).not.toHaveBeenCalled();
    expect(reconcileProvider.propose).not.toHaveBeenCalled();
  });

  it('handles a mix of existing and new proposals in stable conflict order', async () => {
    const rows = [conflict('paid_but_no_deal', 'a'), conflict('wrong_amount_payment', 'b')];
    const reconcileProvider = provider();
    const { pool } = makePool({ conflicts: rows, existingProposal: (_fingerprint, call) => call === 0 });
    const result = await reconcileConflicts(pool, config, reconcileProvider, request);
    expect(result).toMatchObject({ conflictCount: 2, proposalsCreated: 1, proposalsDeduplicated: 1, providerCalls: 1 });
    expect(reconcileProvider.propose).toHaveBeenCalledOnce();
    expect(reconcileProvider.propose).toHaveBeenCalledWith(expect.objectContaining({ conflict_key: rows[1]!.conflict_key }), expect.any(Object), expect.any(AbortSignal));
  });
});

describe('hard spend-cap stop', () => {
  it.each(['daily_cap', 'run_cap'] as const)('halts immediately on %s without a provider call', async (reason) => {
    mockedReserveProviderCost.mockResolvedValue({ allowed: false, reason });
    const reconcileProvider = provider();
    const { pool } = makePool({ conflicts: [conflict('paid_but_no_deal', 'a'), conflict('paid_but_no_deal', 'b')] });
    const result = await reconcileConflicts(pool, config, reconcileProvider, request);
    expect(result).toMatchObject({ status: 'halted', conflictCount: 2, proposalsCreated: 0, proposalsDeduplicated: 0, providerCalls: 0, haltReason: reason });
    expect(mockedReserveProviderCost).toHaveBeenCalledOnce();
    expect(mockedMarkProviderCallStarted).not.toHaveBeenCalled();
    expect(reconcileProvider.propose).not.toHaveBeenCalled();
  });

  it('uses a safe generic reason for an unexpected denied reservation', async () => {
    mockedReserveProviderCost.mockResolvedValue({ allowed: false });
    const { pool } = makePool({ conflicts: [conflict()] });
    await expect(reconcileConflicts(pool, config, provider(), request)).resolves.toMatchObject({ status: 'halted', haltReason: 'spend_cap_reached' });
  });

  it('preserves work completed before a later cap stop', async () => {
    mockedReserveProviderCost
      .mockResolvedValueOnce({ allowed: true, reservationId: 'reservation-1' })
      .mockResolvedValueOnce({ allowed: false, reason: 'run_cap' });
    const { pool } = makePool({ conflicts: [conflict('paid_but_no_deal', 'a'), conflict('wrong_amount_payment', 'b')] });
    const result = await reconcileConflicts(pool, config, provider(), request);
    expect(result).toMatchObject({ status: 'halted', conflictCount: 2, proposalsCreated: 1, providerCalls: 1, haltReason: 'run_cap' });
  });
});

describe('proposal-only success path', () => {
  it('reserves worst-case cost before marking or calling the provider', async () => {
    const reconcileProvider = provider();
    const row = conflict();
    const { pool } = makePool({ conflicts: [row] });
    await reconcileConflicts(pool, config, reconcileProvider, request);
    expect(mockedReserveProviderCost).toHaveBeenCalledWith(pool, expect.objectContaining({ tenantId: request.tenantId }), 'spend-run-1', expect.stringMatching(/^action_/u), 10n);
    expect(mockedMarkProviderCallStarted).toHaveBeenCalledWith(pool, 'reservation-1');
    expect(reconcileProvider.propose).toHaveBeenCalledOnce();
  });

  it('settles exact provider-reported integer cost after a valid response', async () => {
    const { pool } = makePool({ conflicts: [conflict()] });
    await reconcileConflicts(pool, config, provider(), request);
    expect(mockedSettleProviderCost).toHaveBeenCalledWith(pool, request.tenantId, 'reservation-1', 2n);
  });

  it('writes one explicit pending proposal with stable evidence', async () => {
    const row = conflict();
    const { pool, statements } = makePool({ conflicts: [row] });
    const result = await reconcileConflicts(pool, config, provider(), request);
    expect(result).toMatchObject({ status: 'complete', conflictCount: 1, proposalsCreated: 1, proposalsDeduplicated: 0, providerCalls: 1 });
    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO proposals'))!;
    expect(insert.sql).toContain("'pending'");
    expect(insert.parameters?.[1]).toBe(request.tenantId);
    expect(insert.parameters?.[2]).toBe(row.id);
    expect(insert.parameters?.[3]).toMatch(/^action_/u);
    expect(JSON.parse(String(insert.parameters?.[4]))).toMatchObject({ kind: 'link_or_create_deal_review', policyVersion: 'actions-v1' });
    expect(JSON.parse(String(insert.parameters?.[5]))).toMatchObject({
      conflict: { fixture: 'one' },
      provider_summary: `Review ${row.conflict_key}`,
      provider_evidence_refs: row.entity_refs,
      policy_version: 'actions-v1'
    });
    expect(insert.parameters?.[10]).toBe('10');
    expect(insert.parameters?.[11]).toBe('2');
  });

  it('records proposal confidence from inspectable deterministic signals', async () => {
    const { pool, statements } = makePool({ conflicts: [conflict()] });
    await reconcileConflicts(pool, config, provider(), request);
    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO proposals'))!;
    expect(insert.parameters?.[6]).toBeTypeOf('number');
    expect(insert.parameters?.[6]).toBeGreaterThanOrEqual(0);
    expect(insert.parameters?.[6]).toBeLessThanOrEqual(10_000);
    expect(JSON.parse(String(insert.parameters?.[7]))).toMatchObject({ hardIdAgreement: true, sensitiveAction: false });
  });

  it('writes a privacy-redacted proposal-created audit event', async () => {
    const { pool, statements } = makePool({ conflicts: [conflict()] });
    await reconcileConflicts(pool, config, provider(), request);
    const audit = statements.find(({ sql }) => sql.includes("'proposal_created'"))!;
    expect(audit.parameters?.[1]).toBe(request.tenantId);
    expect(audit.parameters?.[2]).toBe(request.requestId);
    expect(JSON.parse(String(audit.parameters?.[4]))).toMatchObject({ confidenceBp: expect.any(Number), sensitiveHold: false, inputTokens: 100, outputTokens: 25, actualCostMicrocents: 2 });
    expect(audit.parameters?.[5]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('does not count a proposal lost to a concurrent insert', async () => {
    const { pool } = makePool({ conflicts: [conflict()], proposalInsertRowCount: 0 });
    const result = await reconcileConflicts(pool, config, provider(), request);
    expect(result).toMatchObject({ proposalsCreated: 0, providerCalls: 1 });
  });

  it('separates stable proposal IDs for different actions', async () => {
    const { pool, statements } = makePool({ conflicts: [conflict('paid_but_no_deal', 'a'), conflict('wrong_amount_payment', 'b')] });
    await reconcileConflicts(pool, config, provider(), request);
    const proposalIds = statements.filter(({ sql }) => sql.includes('INSERT INTO proposals')).map(({ parameters }) => parameters?.[0]);
    expect(proposalIds).toHaveLength(2);
    expect(new Set(proposalIds).size).toBe(2);
  });

  it('never sends a source-system adapter to the provider or transaction', async () => {
    const reconcileProvider = provider();
    const { pool } = makePool({ conflicts: [conflict()] });
    await reconcileConflicts(pool, config, reconcileProvider, request);
    expect(reconcileProvider.propose).toHaveBeenCalledWith(expect.objectContaining({ expected_verdict: 'fail' }), expect.objectContaining({ proposedValue: expect.stringContaining('review:') }), expect.any(AbortSignal));
    expect('sourceAdapter' in (reconcileProvider.propose as ReturnType<typeof vi.fn>).mock.calls[0]!).toBe(false);
  });
});

describe('sensitive-field governance', () => {
  it('writes sensitive actions pending with an unconditional hard hold', async () => {
    const { pool, statements } = makePool({ conflicts: [conflict('sensitive_field_only_fix')] });
    await reconcileConflicts(pool, config, provider(), request);
    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO proposals'))!;
    expect(insert.sql).toContain("'pending'");
    expect(insert.parameters?.[8]).toContain('billing_owner_email');
    expect(insert.parameters?.[9]).toBe(true);
    expect(JSON.parse(String(insert.parameters?.[7]))).toMatchObject({ sensitiveAction: true });
  });

  it('logs the sensitive hold in proposal audit metadata', async () => {
    const { pool, statements } = makePool({ conflicts: [conflict('sensitive_field_only_fix')] });
    await reconcileConflicts(pool, config, provider(), request);
    const audit = statements.find(({ sql }) => sql.includes("'proposal_created'"))!;
    expect(JSON.parse(String(audit.parameters?.[4]))).toMatchObject({ sensitiveHold: true });
  });
});

describe('provider failure containment', () => {
  it('charges the reserved worst case and records failure without creating a proposal', async () => {
    const reconcileProvider = provider({ propose: vi.fn(async () => { throw new Error('provider unavailable'); }) });
    const { pool, statements } = makePool({ conflicts: [conflict()] });
    const result = await reconcileConflicts(pool, config, reconcileProvider, request);
    expect(result).toMatchObject({ status: 'complete', conflictCount: 1, proposalsCreated: 0, providerCalls: 0 });
    expect(mockedSettleProviderCost).toHaveBeenCalledWith(pool, request.tenantId, 'reservation-1', 10n, true);
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO proposals'))).toBe(false);
    const audit = statements.find(({ sql }) => sql.includes("'proposal_generation_failed'"))!;
    expect(JSON.parse(String(audit.parameters?.[4]))).toEqual({ conflictKey: expect.stringMatching(/^\[redacted:[0-9a-f]{12}\]$/u), error: 'provider unavailable' });
  });

  it('treats a non-Error provider rejection as provider_invalid', async () => {
    const reconcileProvider = provider({ propose: vi.fn(async () => Promise.reject('offline')) });
    const { pool, statements } = makePool({ conflicts: [conflict()] });
    await reconcileConflicts(pool, config, reconcileProvider, request);
    const audit = statements.find(({ sql }) => sql.includes("'proposal_generation_failed'"))!;
    expect(JSON.parse(String(audit.parameters?.[4]))).toMatchObject({ error: 'provider_invalid' });
  });

  it('rejects a provider response for a different action and charges worst case', async () => {
    const reconcileProvider = provider({
      propose: vi.fn(async () => ({
        actionFingerprint: 'wrong-action',
        summary: 'Unsafe response',
        evidenceRefs: [],
        inputTokens: 1,
        outputTokens: 1,
        actualCostMicrocents: 1
      }))
    });
    const { pool } = makePool({ conflicts: [conflict()] });
    const result = await reconcileConflicts(pool, config, reconcileProvider, request);
    expect(result.proposalsCreated).toBe(0);
    expect(mockedSettleProviderCost).toHaveBeenCalledWith(pool, request.tenantId, 'reservation-1', 10n, true);
  });

  it('continues to the next independent conflict after a provider failure', async () => {
    const propose = vi.fn()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockImplementationOnce(async (detected: DetectedConflict, action: { fingerprint: string }) => ({
        actionFingerprint: action.fingerprint,
        summary: `Review ${detected.conflict_key}`,
        evidenceRefs: detected.entity_refs,
        inputTokens: 10,
        outputTokens: 5,
        actualCostMicrocents: 2
      }));
    const { pool } = makePool({ conflicts: [conflict('paid_but_no_deal', 'a'), conflict('wrong_amount_payment', 'b')] });
    const result = await reconcileConflicts(pool, config, provider({ propose }), request);
    expect(result).toMatchObject({ conflictCount: 2, proposalsCreated: 1, providerCalls: 1 });
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it('bounds a hung provider with an AbortSignal timeout', async () => {
    vi.useFakeTimers();
    const propose = vi.fn((_detected: DetectedConflict, _action: unknown, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const { pool } = makePool({ conflicts: [conflict()] });
    const run = reconcileConflicts(pool, { ...config, SOURCE_TIMEOUT_MS: 5 }, provider({ propose }), request);
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.proposalsCreated).toBe(0);
    expect(mockedSettleProviderCost).toHaveBeenCalledWith(pool, request.tenantId, 'reservation-1', 10n, true);
  });

  it('does not leave a timeout timer behind after a synchronous provider failure', async () => {
    vi.useFakeTimers();
    const { pool } = makePool({ conflicts: [conflict()] });
    await reconcileConflicts(pool, config, provider({ propose: vi.fn(async () => { throw new Error('immediate'); }) }), request);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leave a timeout timer behind after provider success', async () => {
    vi.useFakeTimers();
    const { pool } = makePool({ conflicts: [conflict()] });
    await reconcileConflicts(pool, config, provider(), request);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('fail-closed orchestration', () => {
  it('throws when an allowed reservation has no durable ID', async () => {
    mockedReserveProviderCost.mockResolvedValue({ allowed: true });
    const { pool, lockClient } = makePool({ conflicts: [conflict()] });
    await expect(reconcileConflicts(pool, config, provider(), request)).rejects.toThrow('spend_reservation_id_missing');
    expect(lockClient.release).toHaveBeenCalledOnce();
  });

  it('throws if source mirror hashes change during reconciliation', async () => {
    const { pool, lockClient } = makePool({ conflicts: [conflict()], hashes: [['before'], ['after']] });
    await expect(reconcileConflicts(pool, config, provider(), request)).rejects.toThrow('source_mirror_changed_during_reconciliation');
    expect(lockClient.release).toHaveBeenCalledOnce();
  });

  it('does not mask a settlement failure', async () => {
    mockedSettleProviderCost.mockRejectedValue(new Error('ledger settlement failed'));
    const { pool, lockClient } = makePool({ conflicts: [conflict()] });
    await expect(reconcileConflicts(pool, config, provider(), request)).rejects.toThrow('ledger settlement failed');
    expect(lockClient.release).toHaveBeenCalledOnce();
  });

  it('does not return before the source hash has been verified twice', async () => {
    const { pool, poolQuery } = makePool({ conflicts: [conflict()] });
    await reconcileConflicts(pool, config, provider(), request);
    expect(poolQuery.mock.calls.filter(([sql]) => String(sql).includes('SELECT records.payload_hash'))).toHaveLength(2);
  });
});
