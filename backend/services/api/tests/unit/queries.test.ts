import { sha256 } from '../../src/domain/stable.js';
import type { DatabasePool } from '../../src/persistence/database.js';
import {
  authenticateClient,
  decideProposal,
  getConflictDetail,
  getEntity,
  getOverview,
  getRun,
  listConflicts,
  listProposals,
  type TenantContext
} from '../../src/persistence/queries.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const reviewer: TenantContext = { tenantId, tenantSlug: 'tenant-one', role: 'reviewer' };

function pool(query: ReturnType<typeof vi.fn>, connect?: ReturnType<typeof vi.fn>): DatabasePool {
  return { query, ...(connect ? { connect } : {}) } as unknown as DatabasePool;
}

describe('client authentication', () => {
  it.each([
    ['viewer', 'viewer'] as const,
    ['reviewer', 'reviewer'] as const
  ])('returns tenant-bound %s scope', async (databaseRole, expectedRole) => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: tenantId, slug: 'tenant-one', role: databaseRole }], rowCount: 1 });
    await expect(authenticateClient(pool(query), 'fixture-client-key')).resolves.toEqual({ tenantId, tenantSlug: 'tenant-one', role: expectedRole });
    expect(query.mock.calls[0]?.[1]).toEqual([sha256('fixture-client-key')]);
    expect(query.mock.calls[0]?.[0]).toContain('client_key_hash = $1 OR reviewer_key_hash = $1');
  });

  it('returns undefined instead of inventing a tenant', async () => {
    await expect(authenticateClient(pool(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })), 'unknown-key')).resolves.toBeUndefined();
  });
});

describe('overview query', () => {
  it('runs six tenant-scoped queries and preserves dashboard accounting', async () => {
    const responses = [
      { rows: [{ source_kind: 'crm', accepted_count: 55_000 }] },
      { rows: [{ active: '3050', resolved: '0', oscillation_hold: '0' }] },
      { rows: [{ status: 'pending', count: 3050 }] },
      { rows: [{ status: 'complete', summary: { fail: 3050 } }] },
      { rows: [{ cap_microcents: '100', reserved_microcents: '50', actual_microcents: '50', released_microcents: '0' }] },
      { rows: [{ id: 'sync-id', status: 'complete' }] }
    ];
    const query = vi.fn();
    for (const response of responses) query.mockResolvedValueOnce({ ...response, rowCount: response.rows.length });
    await expect(getOverview(pool(query), tenantId)).resolves.toEqual({
      sources: responses[0]!.rows,
      conflicts: responses[1]!.rows[0],
      proposals: responses[2]!.rows,
      invariant: responses[3]!.rows[0],
      spend: responses[4]!.rows[0],
      latestRun: responses[5]!.rows[0]
    });
    expect(query).toHaveBeenCalledTimes(6);
    expect(query.mock.calls.every(([, parameters]) => parameters[0] === tenantId)).toBe(true);
  });

  it('returns explicit empty defaults before the first sync', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(getOverview(pool(query), tenantId)).resolves.toMatchObject({
      conflicts: { active: '0', resolved: '0', oscillation_hold: '0' },
      proposals: [],
      invariant: null,
      spend: { cap_microcents: '0', reserved_microcents: '0', actual_microcents: '0', released_microcents: '0' },
      latestRun: null
    });
  });
});

describe('conflict listing', () => {
  it('binds every filter and tenant value instead of interpolating user input', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await listConflicts(pool(query), tenantId, {
      type: "paid_but_no_deal' OR true",
      source: 'payments',
      status: 'active',
      proposalStatus: 'pending',
      minimumConfidenceBp: 7500,
      from: '2026-01-15T00:00:00.000Z',
      limit: 25
    });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).not.toContain("OR true");
    expect(sql).toContain('$2');
    expect(values).toEqual([tenantId, "paid_but_no_deal' OR true", 'payments', 'active', 'pending', 7500, '2026-01-15T00:00:00.000Z', 26]);
  });

  it('returns an opaque cursor only when one extra row exists', async () => {
    const rows = [
      { id: 'conflict-2', last_seen_at: '2026-01-16T00:00:00.000Z' },
      { id: 'conflict-1', last_seen_at: '2026-01-15T00:00:00.000Z' }
    ];
    const query = vi.fn().mockResolvedValue({ rows, rowCount: 2 });
    const first = await listConflicts(pool(query), tenantId, { limit: 1 });
    expect(first.items).toEqual([rows[0]]);
    expect(first.nextCursor).toBeTruthy();

    query.mockClear().mockResolvedValue({ rows: [], rowCount: 0 });
    await listConflicts(pool(query), tenantId, { limit: 1, cursor: first.nextCursor! });
    expect(query.mock.calls[0]?.[0]).toContain('(conflicts.last_seen_at, conflicts.id) <');
    expect(query.mock.calls[0]?.[1]).toEqual([tenantId, '2026-01-16T00:00:00.000Z', 'conflict-2', 2]);
  });

  it('rejects malformed and semantically invalid cursors before querying', async () => {
    const query = vi.fn();
    await expect(listConflicts(pool(query), tenantId, { limit: 10, cursor: 'not-base64-json' })).rejects.toThrow('cursor_invalid');
    const invalidShape = Buffer.from(JSON.stringify({ time: 'yesterday', id: '' })).toString('base64url');
    await expect(listConflicts(pool(query), tenantId, { limit: 10, cursor: invalidShape })).rejects.toThrow('cursor_invalid');
    expect(query).not.toHaveBeenCalled();
  });
});

describe('conflict and entity detail', () => {
  it('returns undefined without querying unrelated evidence for a missing conflict', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(getConflictDetail(pool(query), tenantId, 'missing')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledOnce();
  });

  it('limits lineage to active snapshots and correlated tenant evidence', async () => {
    const conflict = { id: 'conflict-1', entity_refs: ['student:student-1', 'payment:payment-1'] };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [conflict], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'proposal-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ source_kind: 'payments', field_path: 'payer_email' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ event_type: 'proposal_created' }], rowCount: 1 });
    const result = await getConflictDetail(pool(query), tenantId, conflict.id);
    expect(result).toMatchObject({ id: conflict.id, proposal: { id: 'proposal-1' } });
    expect(query.mock.calls[2]?.[0]).toContain('JOIN active_snapshots active');
    expect(query.mock.calls[2]?.[1]).toEqual([tenantId, ['student-1', 'payment-1'], ['entity:student-1']]);
    expect(query.mock.calls[3]?.[1]).toEqual([tenantId, 'conflict-1', 'proposal-1']);
  });

  it('returns undefined for a missing entity without querying links', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(getEntity(pool(query), tenantId, 'entity:missing')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledOnce();
  });

  it('returns only active-snapshot links for the unified entity', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'entity:student-1', summary: { paid: true } }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ source_kind: 'payments', source_id: 'payment-1' }], rowCount: 1 });
    await expect(getEntity(pool(query), tenantId, 'entity:student-1')).resolves.toMatchObject({ id: 'entity:student-1', links: [{ source_kind: 'payments' }] });
    expect(query.mock.calls[1]?.[0]).toContain('JOIN active_snapshots active');
    expect(query.mock.calls[1]?.[1]).toEqual([tenantId, 'entity:student-1']);
  });
});

describe('proposal queue and decisions', () => {
  it('binds optional proposal filters and a bounded limit', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'proposal-1' }], rowCount: 1 });
    await expect(listProposals(pool(query), tenantId, { status: 'pending', minimumConfidenceBp: 9500, limit: 50 })).resolves.toEqual([{ id: 'proposal-1' }]);
    expect(query.mock.calls[0]?.[1]).toEqual([tenantId, 'pending', 9500, 50]);
  });

  it('rejects viewer decisions before opening a transaction', async () => {
    const connect = vi.fn();
    await expect(decideProposal(pool(vi.fn(), connect), { ...reviewer, role: 'viewer' }, 'proposal-1', 'hold', 'needs evidence', 1, 'request-1')).rejects.toThrow('reviewer_required');
    expect(connect).not.toHaveBeenCalled();
  });

  it('commits decision, reason, actor, version, and audit together', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ status: 'pending', version: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'proposal-1', status: 'approved', version: 2 }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    await expect(decideProposal(pool(vi.fn(), connect), reviewer, 'proposal-1', 'approve', 'Evidence is sufficient', 1, 'request-1'))
      .resolves.toMatchObject({ status: 'approved', version: 2 });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('UPDATE proposals'),
      expect.stringContaining('INSERT INTO proposal_decisions'),
      expect.stringContaining('INSERT INTO audit_events'),
      'COMMIT'
    ]);
    expect(query.mock.calls[3]?.[1]?.slice(1)).toEqual([tenantId, 'proposal-1', 'approve', 'Evidence is sufficient', 'fixture-reviewer:tenant-one', 1]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns undefined and commits no-op lookup for a missing proposal', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const release = vi.fn();
    await expect(decideProposal(pool(vi.fn(), vi.fn().mockResolvedValue({ query, release })), reviewer, 'missing', 'hold', 'No evidence', 1, 'request-1')).resolves.toBeUndefined();
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.stringContaining('FOR UPDATE'), 'COMMIT']);
  });

  it('rolls back stale versions without a decision or audit write', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ status: 'pending', version: 2 }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const release = vi.fn();
    await expect(decideProposal(pool(vi.fn(), vi.fn().mockResolvedValue({ query, release })), reviewer, 'proposal-1', 'approve', 'Stale attempt', 1, 'request-1')).rejects.toThrow('proposal_version_stale');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.stringContaining('FOR UPDATE'), 'ROLLBACK']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back illegal terminal transitions', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ status: 'approved', version: 2 }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(decideProposal(pool(vi.fn(), vi.fn().mockResolvedValue({ query, release: vi.fn() })), reviewer, 'proposal-1', 'hold', 'Already final', 2, 'request-1')).rejects.toThrow('proposal_transition_illegal');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});

describe('run lookup', () => {
  it('returns a durable job without querying sync tables', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'job-1', status: 'complete' }], rowCount: 1 });
    await expect(getRun(pool(query), tenantId, 'job-1')).resolves.toEqual({ kind: 'job', id: 'job-1', status: 'complete' });
    expect(query).toHaveBeenCalledOnce();
  });

  it('returns undefined when neither job nor sync exists', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(getRun(pool(query), tenantId, 'missing')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('assembles a sync with source and invariant evidence', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'sync-1', status: 'partial' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ source_kind: 'crm', status: 'failed' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ status: 'partial', summary: { unchecked: 8 } }], rowCount: 1 });
    await expect(getRun(pool(query), tenantId, 'sync-1')).resolves.toMatchObject({
      kind: 'sync',
      id: 'sync-1',
      sources: [{ source_kind: 'crm', status: 'failed' }],
      invariants: [{ status: 'partial', summary: { unchecked: 8 } }]
    });
    expect(query.mock.calls.every(([, parameters]) => parameters[0] === tenantId)).toBe(true);
  });
});
