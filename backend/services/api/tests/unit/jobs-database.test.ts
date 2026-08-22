import type { RedisClientType } from 'redis';
import { loadConfig } from '../../src/config.js';
import { stableUuid } from '../../src/domain/stable.js';
import { createDurableJob, publishJob, publishReadyJobs } from '../../src/jobs/service.js';
import { databaseReady, inTransaction, type DatabasePool } from '../../src/persistence/database.js';

const config = loadConfig({ NODE_ENV: 'test' });
const tenantId = '11111111-1111-4111-8111-111111111111';

function poolWithQuery(query: ReturnType<typeof vi.fn>): DatabasePool {
  return { query } as unknown as DatabasePool;
}

describe('durable job creation', () => {
  it('returns the deterministic inserted job before queue publication', async () => {
    const id = stableUuid(`job:${tenantId}:sync:sync-once-key`);
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id, status: 'queued' }], rowCount: 1 });
    const result = await createDurableJob(poolWithQuery(query), config, {
      tenantId,
      jobType: 'sync',
      idempotencyKey: 'sync-once-key',
      requestId: 'request-1',
      payload: { generation: 3 }
    });
    expect(result).toEqual({ id, status: 'queued', duplicate: false });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual([id, tenantId, 'sync', 'sync-once-key', 'request-1', '{"generation":3}', config.JOB_RETRY_LIMIT]);
  });

  it('generates a request id when a caller omits one', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'job-id', status: 'queued' }], rowCount: 1 });
    await createDurableJob(poolWithQuery(query), config, { tenantId, jobType: 'reconcile', idempotencyKey: 'reconcile-key', payload: {} });
    expect(query.mock.calls[0]?.[1]?.[4]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('returns the existing durable row for a duplicate key', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-job', status: 'complete' }], rowCount: 1 });
    await expect(createDurableJob(poolWithQuery(query), config, { tenantId, jobType: 'sync', idempotencyKey: 'duplicate-key', payload: {} }))
      .resolves.toEqual({ id: 'existing-job', status: 'complete', duplicate: true });
    expect(query.mock.calls[1]?.[1]).toEqual([tenantId, 'sync', 'duplicate-key']);
  });

  it('fails closed if a conflicted insert cannot be read back', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(createDurableJob(poolWithQuery(query), config, { tenantId, jobType: 'sync', idempotencyKey: 'missing-job', payload: {} }))
      .rejects.toThrow('job_upsert_failed');
  });
});

describe('Redis publication after durable intent', () => {
  it('publishes only the durable job id and stores the stream id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const xAdd = vi.fn().mockResolvedValue('42-7');
    const queue = { xAdd } as unknown as RedisClientType;
    await expect(publishJob(poolWithQuery(query), queue, 'jobs-v1', 'job-1')).resolves.toBe('42-7');
    expect(xAdd).toHaveBeenCalledWith('jobs-v1', '*', { job_id: 'job-1' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE jobs SET stream_id'), ['job-1', '42-7']);
  });

  it('does not mark a job published when Redis rejects the message', async () => {
    const query = vi.fn();
    const queue = { xAdd: vi.fn().mockRejectedValue(new Error('redis unavailable')) } as unknown as RedisClientType;
    await expect(publishJob(poolWithQuery(query), queue, 'jobs-v1', 'job-1')).rejects.toThrow('redis unavailable');
    expect(query).not.toHaveBeenCalled();
  });

  it('republishes every ready database job in stable order', async () => {
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      void parameters;
      return sql.includes('SELECT id FROM jobs')
        ? { rows: [{ id: 'job-1' }, { id: 'job-2' }], rowCount: 2 }
        : { rows: [], rowCount: 1 };
    });
    const xAdd = vi.fn().mockResolvedValueOnce('1-0').mockResolvedValueOnce('2-0');
    const count = await publishReadyJobs(poolWithQuery(query), { xAdd } as unknown as RedisClientType, 'jobs-v1', 2);
    expect(count).toBe(2);
    expect(query.mock.calls[0]?.[0]).toContain("status IN ('queued','retry_wait')");
    expect(query.mock.calls[0]?.[1]).toEqual([2]);
    expect(xAdd).toHaveBeenNthCalledWith(1, 'jobs-v1', '*', { job_id: 'job-1' });
    expect(xAdd).toHaveBeenNthCalledWith(2, 'jobs-v1', '*', { job_id: 'job-2' });
  });

  it('performs no Redis write when no durable job is ready', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const xAdd = vi.fn();
    await expect(publishReadyJobs(poolWithQuery(query), { xAdd } as unknown as RedisClientType, 'jobs-v1')).resolves.toBe(0);
    expect(xAdd).not.toHaveBeenCalled();
  });
});

describe('database transaction boundary', () => {
  it('commits successful work and always releases the client', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as DatabasePool;
    await expect(inTransaction(pool, async (client) => { await client.query('SELECT $1::text', ['value']); return 42; })).resolves.toBe(42);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'SELECT $1::text', 'COMMIT']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back failed work, preserves the original error, and releases', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as DatabasePool;
    await expect(inTransaction(pool, async () => { throw new Error('work failed'); })).rejects.toThrow('work failed');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('reports a ready database with measured latency', async () => {
    const result = await databaseReady(poolWithQuery(vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 })));
    expect(result.ready).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result).not.toHaveProperty('error');
  });

  it('reports a safe degraded database state', async () => {
    await expect(databaseReady(poolWithQuery(vi.fn().mockRejectedValue(new Error('connection refused')))))
      .resolves.toMatchObject({ ready: false, error: 'connection refused' });
  });

  it('uses a generic database error for non-Error rejection values', async () => {
    await expect(databaseReady(poolWithQuery(vi.fn().mockRejectedValue('offline'))))
      .resolves.toMatchObject({ ready: false, error: 'database_unavailable' });
  });
});
