import type { DatabasePool } from '../../src/persistence/database.js';
import {
  ensureSpendRun,
  markProviderCallStarted,
  reserveProviderCost,
  settleProviderCost,
  type SpendContext
} from '../../src/reconciliation/spend-ledger.js';

interface QueryResult {
  rows: unknown[];
  rowCount?: number;
}

function makeContext(overrides: Partial<SpendContext> = {}): SpendContext {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001',
    jobId: '11111111-1111-4111-8111-111111111111',
    requestId: 'request-spend-test',
    dailyCap: 100n,
    runCap: 80n,
    ...overrides
  };
}

function makePool(handler: (sql: string, parameters: readonly unknown[] | undefined) => QueryResult | Promise<QueryResult>) {
  const queries: Array<{ sql: string; parameters: readonly unknown[] | undefined }> = [];
  const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    queries.push({ sql, parameters });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    return handler(sql, parameters);
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) } as unknown as DatabasePool;
  return { pool, client, query, queries };
}

function reservationPool(options: {
  duplicateId?: string;
  dailyReserved?: string;
  dailyCap?: string;
  runReserved?: string;
  runCap?: string;
} = {}) {
  return makePool((sql) => {
    if (sql.startsWith('SELECT id FROM spend_reservations')) return { rows: options.duplicateId ? [{ id: options.duplicateId }] : [] };
    if (sql.includes('FROM spend_buckets') && sql.includes('FOR UPDATE')) return { rows: [{ reserved_microcents: options.dailyReserved ?? '0', cap_microcents: options.dailyCap ?? '100' }] };
    if (sql.startsWith('SELECT reserved_microcents, cap_microcents FROM spend_runs')) return { rows: [{ reserved_microcents: options.runReserved ?? '0', cap_microcents: options.runCap ?? '80' }] };
    return { rows: [], rowCount: 1 };
  });
}

describe('spend run creation', () => {
  it('uses a deterministic run ID for a tenant and durable job', async () => {
    const { pool, query } = makePool(() => ({ rows: [], rowCount: 1 }));
    const first = await ensureSpendRun(pool, makeContext());
    const second = await ensureSpendRun(pool, makeContext());
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/u);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('persists the exact integer run cap as a decimal string', async () => {
    const { pool, query } = makePool(() => ({ rows: [], rowCount: 1 }));
    const context = makeContext({ runCap: 9_007_199_254_740_993n });
    const id = await ensureSpendRun(pool, context);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO spend_runs'), [id, context.tenantId, context.jobId, '9007199254740993']);
  });

  it('uses ON CONFLICT to make run creation replay-safe', async () => {
    const { pool, query } = makePool(() => ({ rows: [], rowCount: 0 }));
    await expect(ensureSpendRun(pool, makeContext())).resolves.toMatch(/^[0-9a-f-]{36}$/u);
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT (id) DO NOTHING');
  });

  it('separates run IDs for distinct jobs and tenants', async () => {
    const { pool } = makePool(() => ({ rows: [] }));
    const base = await ensureSpendRun(pool, makeContext());
    const otherJob = await ensureSpendRun(pool, makeContext({ jobId: '22222222-2222-4222-8222-222222222222' }));
    const otherTenant = await ensureSpendRun(pool, makeContext({ tenantId: '33333333-3333-4333-8333-333333333333' }));
    expect(new Set([base, otherJob, otherTenant]).size).toBe(3);
  });
});

describe('pre-call spend reservation', () => {
  it('rejects a negative estimate before opening a transaction', async () => {
    const { pool } = reservationPool();
    await expect(reserveProviderCost(pool, makeContext(), 'spend-run', 'action-1', -1n)).rejects.toThrow('estimate_invalid');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('deduplicates an action before changing any bucket', async () => {
    const { pool, queries } = reservationPool({ duplicateId: 'existing-reservation' });
    await expect(reserveProviderCost(pool, makeContext(), 'spend-run', 'action-1', 10n)).resolves.toEqual({
      allowed: false,
      reservationId: 'existing-reservation',
      reason: 'duplicate'
    });
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO spend_buckets'))).toBe(false);
    expect(queries.map(({ sql }) => sql)).toEqual(['BEGIN', expect.stringContaining('SELECT id FROM spend_reservations'), 'COMMIT']);
  });

  it('locks daily and run ledgers before reserving', async () => {
    const { pool, queries } = reservationPool();
    await reserveProviderCost(pool, makeContext(), 'spend-run', 'action-1', 10n);
    const statements = queries.map(({ sql }) => sql);
    const bucketLock = statements.findIndex((sql) => sql.includes('FROM spend_buckets') && sql.includes('FOR UPDATE'));
    const runLock = statements.findIndex((sql) => sql.includes('FROM spend_runs') && sql.includes('FOR UPDATE'));
    const reservationInsert = statements.findIndex((sql) => sql.includes('INSERT INTO spend_reservations'));
    expect(bucketLock).toBeGreaterThan(0);
    expect(runLock).toBeGreaterThan(bucketLock);
    expect(reservationInsert).toBeGreaterThan(runLock);
  });

  it('allows a reservation exactly at both caps', async () => {
    const { pool } = reservationPool({ dailyReserved: '90', dailyCap: '100', runReserved: '70', runCap: '80' });
    const result = await reserveProviderCost(pool, makeContext(), 'spend-run', 'action-exact', 10n);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.reservationId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('allows a zero-cost reservation at a full cap', async () => {
    const { pool } = reservationPool({ dailyReserved: '100', dailyCap: '100', runReserved: '80', runCap: '80' });
    await expect(reserveProviderCost(pool, makeContext(), 'spend-run', 'zero-cost', 0n)).resolves.toMatchObject({ allowed: true });
  });

  it('persists a deterministic reservation ID and exact maximum', async () => {
    const { pool, queries } = reservationPool();
    const first = await reserveProviderCost(pool, makeContext(), 'spend-run', 'stable-action', 10n);
    const insert = queries.find(({ sql }) => sql.includes('INSERT INTO spend_reservations'))!;
    expect(insert.parameters).toEqual([first.reservationId, makeContext().tenantId, 'spend-run', 'stable-action', '10']);
  });

  it('increments both daily and per-run reservations in the same transaction', async () => {
    const { pool, queries } = reservationPool();
    await reserveProviderCost(pool, makeContext(), 'spend-run', 'action-1', 17n);
    expect(queries.find(({ sql }) => sql.includes('UPDATE spend_buckets'))?.parameters).toEqual([makeContext().tenantId, '17']);
    expect(queries.find(({ sql }) => sql.includes('UPDATE spend_runs SET reserved_microcents'))?.parameters).toEqual(['spend-run', '17']);
    expect(queries.at(-1)?.sql).toBe('COMMIT');
  });

  it('halts one unit above the daily cap', async () => {
    const { pool, queries } = reservationPool({ dailyReserved: '91', dailyCap: '100', runReserved: '0', runCap: '80' });
    await expect(reserveProviderCost(pool, makeContext(), 'spend-run', 'daily-over', 10n)).resolves.toEqual({ allowed: false, reason: 'daily_cap' });
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO spend_reservations'))).toBe(false);
  });

  it('gives the hard daily cap precedence when both limits are exceeded', async () => {
    const { pool } = reservationPool({ dailyReserved: '100', dailyCap: '100', runReserved: '80', runCap: '80' });
    await expect(reserveProviderCost(pool, makeContext(), 'spend-run', 'both-over', 1n)).resolves.toEqual({ allowed: false, reason: 'daily_cap' });
  });

  it('halts one unit above only the per-run cap', async () => {
    const { pool } = reservationPool({ dailyReserved: '0', dailyCap: '100', runReserved: '71', runCap: '80' });
    await expect(reserveProviderCost(pool, makeContext(), 'spend-run', 'run-over', 10n)).resolves.toEqual({ allowed: false, reason: 'run_cap' });
  });

  it.each(['daily_cap', 'run_cap'] as const)('logs and alerts a %s denial before commit', async (expectedReason) => {
    const settings = expectedReason === 'daily_cap'
      ? { dailyReserved: '100', dailyCap: '100', runReserved: '0', runCap: '80' }
      : { dailyReserved: '0', dailyCap: '100', runReserved: '80', runCap: '80' };
    const { pool, queries } = reservationPool(settings);
    await reserveProviderCost(pool, makeContext(), 'spend-run', `action-${expectedReason}`, 1n);
    const audit = queries.find(({ sql }) => sql.includes('INSERT INTO audit_events'))!;
    const alert = queries.find(({ sql }) => sql.includes('INSERT INTO alert_events'))!;
    expect(audit.sql).toContain("'spend_cap_reached'");
    expect(alert.sql).toContain("'critical'");
    expect(alert.sql).toContain('halted before provider call');
    expect(JSON.parse(String(audit.parameters?.[4]))).toEqual({ reason: expectedReason, estimate: '1', actionFingerprint: `action-${expectedReason}` });
    expect(JSON.parse(String(alert.parameters?.[2]))).toEqual({ reason: expectedReason, estimate: '1', actionFingerprint: `action-${expectedReason}` });
    expect(queries.at(-1)?.sql).toBe('COMMIT');
  });

  it('uses a stable SHA-256 audit hash over cap metadata', async () => {
    const { pool, queries } = reservationPool({ dailyReserved: '100' });
    await reserveProviderCost(pool, makeContext(), 'spend-run', 'action-hash', 1n);
    const audit = queries.find(({ sql }) => sql.includes('INSERT INTO audit_events'))!;
    expect(audit.parameters?.[5]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('fails closed when a locked ledger row is unexpectedly absent', async () => {
    const { pool } = makePool((sql) => {
      if (sql.startsWith('SELECT id FROM spend_reservations')) return { rows: [] };
      if (sql.includes('FROM spend_buckets') && sql.includes('FOR UPDATE')) return { rows: [] };
      if (sql.startsWith('SELECT reserved_microcents, cap_microcents FROM spend_runs')) return { rows: [] };
      return { rows: [] };
    });
    await expect(reserveProviderCost(pool, makeContext(), 'missing-run', 'action', 1n)).resolves.toEqual({ allowed: false, reason: 'daily_cap' });
  });

  it('rolls back and releases the client when persistence fails', async () => {
    const { pool, client, queries } = makePool((sql) => {
      if (sql.startsWith('SELECT id FROM spend_reservations')) return { rows: [] };
      if (sql.includes('INSERT INTO spend_buckets')) throw new Error('database write failed');
      return { rows: [] };
    });
    await expect(reserveProviderCost(pool, makeContext(), 'spend-run', 'action', 1n)).rejects.toThrow('database write failed');
    expect(queries.at(-1)?.sql).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('provider-call lifecycle', () => {
  it('marks only a reserved call as started', async () => {
    const { pool, query } = makePool(() => ({ rows: [], rowCount: 1 }));
    await markProviderCallStarted(pool, 'reservation-1');
    expect(query).toHaveBeenCalledWith('UPDATE spend_reservations SET provider_call_started_at = now() WHERE id = $1 AND status = $2', ['reservation-1', 'reserved']);
  });

  it('propagates a failed start marker write', async () => {
    const { pool } = makePool(() => { throw new Error('start marker failed'); });
    await expect(markProviderCallStarted(pool, 'reservation-1')).rejects.toThrow('start marker failed');
  });
});

describe('post-call settlement', () => {
  function settlementPool(row?: { spend_run_id: string; maximum_microcents: string; status: string }) {
    return makePool((sql) => {
      if (sql.startsWith('SELECT spend_run_id')) return { rows: row ? [row] : [] };
      return { rows: [], rowCount: 1 };
    });
  }

  it('fails closed when the reservation does not exist', async () => {
    const { pool, client, queries } = settlementPool();
    await expect(settleProviderCost(pool, makeContext().tenantId, 'missing', 1n)).rejects.toThrow('spend_reservation_not_found');
    expect(queries.at(-1)?.sql).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each(['settled', 'charged_worst_case', 'cancelled'])('is replay-safe for terminal status %s', async (status) => {
    const { pool, queries } = settlementPool({ spend_run_id: 'run-1', maximum_microcents: '10', status });
    await settleProviderCost(pool, makeContext().tenantId, 'reservation-1', 2n);
    expect(queries.some(({ sql }) => sql.startsWith('UPDATE spend_reservations'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe('COMMIT');
  });

  it.each([-1n, 11n])('rejects actual cost outside the reserved range: %s', async (actual) => {
    const { pool, queries } = settlementPool({ spend_run_id: 'run-1', maximum_microcents: '10', status: 'reserved' });
    await expect(settleProviderCost(pool, makeContext().tenantId, 'reservation-1', actual)).rejects.toThrow('actual_cost_invalid');
    expect(queries.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('settles actual cost and releases the unused maximum', async () => {
    const { pool, queries } = settlementPool({ spend_run_id: 'run-1', maximum_microcents: '10', status: 'reserved' });
    await settleProviderCost(pool, makeContext().tenantId, 'reservation-1', 2n);
    expect(queries.find(({ sql }) => sql.startsWith('UPDATE spend_reservations'))?.parameters).toEqual(['reservation-1', '2', 'settled']);
    expect(queries.find(({ sql }) => sql.includes('UPDATE spend_buckets'))?.parameters).toEqual([makeContext().tenantId, '8', '2']);
    expect(queries.find(({ sql }) => sql.includes('UPDATE spend_runs'))?.parameters).toEqual(['run-1', '8', '2']);
    expect(queries.at(-1)?.sql).toBe('COMMIT');
  });

  it('settles a zero-cost call by releasing the entire maximum', async () => {
    const { pool, queries } = settlementPool({ spend_run_id: 'run-1', maximum_microcents: '10', status: 'reserved' });
    await settleProviderCost(pool, makeContext().tenantId, 'reservation-1', 0n);
    expect(queries.find(({ sql }) => sql.includes('UPDATE spend_buckets'))?.parameters).toEqual([makeContext().tenantId, '10', '0']);
  });

  it('settles a worst-case call at the reservation maximum regardless of reported actual', async () => {
    const { pool, queries } = settlementPool({ spend_run_id: 'run-1', maximum_microcents: '10', status: 'reserved' });
    await settleProviderCost(pool, makeContext().tenantId, 'reservation-1', 1n, true);
    expect(queries.find(({ sql }) => sql.startsWith('UPDATE spend_reservations'))?.parameters).toEqual(['reservation-1', '10', 'charged_worst_case']);
    expect(queries.find(({ sql }) => sql.includes('UPDATE spend_buckets'))?.parameters).toEqual([makeContext().tenantId, '0', '10']);
  });

  it('allows worst-case charging even if an invalid actual value was supplied', async () => {
    const { pool, queries } = settlementPool({ spend_run_id: 'run-1', maximum_microcents: '10', status: 'reserved' });
    await expect(settleProviderCost(pool, makeContext().tenantId, 'reservation-1', -999n, true)).resolves.toBeUndefined();
    expect(queries.find(({ sql }) => sql.startsWith('UPDATE spend_reservations'))?.parameters?.[1]).toBe('10');
  });

  it('uses the tenant in both lock and daily-bucket update scopes', async () => {
    const { pool, queries } = settlementPool({ spend_run_id: 'run-1', maximum_microcents: '10', status: 'reserved' });
    await settleProviderCost(pool, 'tenant-scope', 'reservation-1', 2n);
    expect(queries.find(({ sql }) => sql.startsWith('SELECT spend_run_id'))?.parameters).toEqual(['reservation-1', 'tenant-scope']);
    expect(queries.find(({ sql }) => sql.includes('UPDATE spend_buckets'))?.parameters?.[0]).toBe('tenant-scope');
  });

  it('rolls back when any ledger update fails', async () => {
    const { pool, client, queries } = makePool((sql) => {
      if (sql.startsWith('SELECT spend_run_id')) return { rows: [{ spend_run_id: 'run-1', maximum_microcents: '10', status: 'reserved' }] };
      if (sql.includes('UPDATE spend_buckets')) throw new Error('bucket unavailable');
      return { rows: [], rowCount: 1 };
    });
    await expect(settleProviderCost(pool, 'tenant', 'reservation', 2n)).rejects.toThrow('bucket unavailable');
    expect(queries.at(-1)?.sql).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
