import entityView from '../../../../../golden/entity-view.json' with { type: 'json' };
import { loadConfig } from '../../src/config.js';

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface JobReference {
  id: string;
  status: string;
  duplicate: boolean;
}

interface JobRun {
  kind: 'job';
  id: string;
  status: 'queued' | 'published' | 'running' | 'retry_wait' | 'complete' | 'failed' | 'halted';
  attempt_count: number;
  max_attempts: number;
  result: Record<string, unknown>;
  last_error: string | null;
}

const config = loadConfig();
const baseUrl = process.env.INTEGRATION_BASE_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? '3000'}`;
const viewerHeaders = { 'x-keystone-client-key': config.DEMO_CLIENT_KEY };
const reviewerHeaders = { 'x-keystone-client-key': config.DEMO_REVIEWER_KEY };
const invocationId = crypto.randomUUID();
const jobKeys = {
  sync: `integration-canonical-424242-${invocationId}`,
  reconcile: `integration-reconcile-424242-${invocationId}`,
  stretch: `integration-stretch-424242-${invocationId}`,
  partial: `integration-partial-crm-424242-${invocationId}`
};

async function request<T>(path: string, init: RequestInit = {}): Promise<{ response: Response; body: Envelope<T> }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json() as Envelope<T>;
  return { response, body };
}

async function startJob(path: '/api/v1/jobs/sync' | '/api/v1/jobs/reconcile' | '/api/v1/jobs/stretch', secret: string, idempotencyKey: string, extra: Record<string, unknown> = {}): Promise<{ response: Response; reference: JobReference }> {
  const { response, body } = await request<JobReference>(path, {
    method: 'POST',
    headers: { ...reviewerHeaders, 'x-keystone-trigger-secret': secret, 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey, generation: 3, ...extra })
  });
  return { response, reference: body.data };
}

async function waitForJob(jobId: string, timeoutMs = 120_000): Promise<JobRun> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { response, body } = await request<JobRun>(`/api/v1/runs/${jobId}`, { headers: reviewerHeaders });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    expect(response.status).toBe(200);
    const run = body.data;
    if (run.status === 'complete' || run.status === 'halted') return run;
    if (run.status === 'failed') throw new Error(`integration_job_failed:${run.last_error ?? 'unknown'}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`integration_job_timeout:${jobId}`);
}

describe.sequential('live Compose vertical contract', () => {
  let syncJob: JobReference;
  let syncRun: JobRun;
  let reconcileJob: JobReference;
  let reconcileRun: JobRun;

  test('reports process, database, queue, and all source adapters ready', async () => {
    const { response, body } = await request<{
      status: string;
      process: { ready: boolean };
      database: { ready: boolean };
      queue: { ready: boolean };
      sources: Array<{ sourceKind: string; ready: boolean }>;
    }>('/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(body.data.status).toBe('ok');
    expect(body.data.process.ready).toBe(true);
    expect(body.data.database.ready).toBe(true);
    expect(body.data.queue.ready).toBe(true);
    expect(body.data.sources.map(({ sourceKind }) => sourceKind).sort()).toEqual(['app', 'crm', 'payments']);
    expect(body.data.sources.every(({ ready }) => ready)).toBe(true);
  });

  test('enforces client and per-job trigger authentication', async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/overview`);
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toMatchObject({ error: { code: 'unauthorized' } });

    const wrongTrigger = await fetch(`${baseUrl}/api/v1/jobs/sync`, {
      method: 'POST',
      headers: { ...reviewerHeaders, 'x-keystone-trigger-secret': 'definitely-not-the-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'integration-wrong-trigger', generation: 3 })
    });
    expect(wrongTrigger.status).toBe(401);
    await expect(wrongTrigger.json()).resolves.toMatchObject({ error: { code: 'unauthorized_trigger' } });
  });

  test('rejects malformed, invalid, and oversized fixture payloads with documented 4xx responses', async () => {
    const headers = { ...reviewerHeaders, 'x-keystone-trigger-secret': config.SYNC_TRIGGER_SECRET, 'content-type': 'application/json' };
    const invalid = await fetch(`${baseUrl}/api/v1/internal/fixtures/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fixture_record_id: 'broken-payment' })
    });
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: 'fixture_schema_invalid' } });

    const malformed = await fetch(`${baseUrl}/api/v1/internal/fixtures/validate`, { method: 'POST', headers, body: '{' });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: 'invalid_json' } });

    const oversized = await fetch(`${baseUrl}/api/v1/internal/fixtures/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pad: 'x'.repeat(config.REQUEST_BODY_LIMIT_BYTES + 1) })
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: 'body_too_large' } });
  });

  test('ingests exactly 12,000 source records and detects the 305-item golden set', async () => {
    const started = await startJob('/api/v1/jobs/sync', config.SYNC_TRIGGER_SECRET, jobKeys.sync);
    expect([200, 202]).toContain(started.response.status);
    syncJob = started.reference;
    syncRun = await waitForJob(syncJob.id);
    expect(syncRun.status).toBe('complete');
    expect(syncRun.result).toMatchObject({
      status: 'complete',
      generation: 3,
      acceptedRecords: 12_000,
      conflicts: 305,
      sourceAvailability: { crm: 'complete', app: 'complete', payments: 'complete' }
    });
    const durationMs = Number(syncRun.result.durationMs);
    expect(durationMs).toBeLessThan(30_000);
    expect(12_000 / (durationMs / 1000)).toBeGreaterThanOrEqual(500);

    const syncRunId = String(syncRun.result.runId);
    const { response, body } = await request<{
      kind: 'sync';
      status: string;
      sources: Array<{ source_kind: string; status: string; accepted_count: number }>;
      invariants: Array<{ status: string; summary: { fail: number } }>;
    }>(`/api/v1/runs/${syncRunId}`, { headers: reviewerHeaders });
    expect(response.status).toBe(200);
    expect(body.data.kind).toBe('sync');
    expect(body.data.sources).toHaveLength(3);
    expect(body.data.sources.every(({ status }) => status === 'complete')).toBe(true);
    expect(body.data.sources.reduce((sum, row) => sum + row.accepted_count, 0)).toBe(12_000);
    expect(body.data.invariants).toEqual([expect.objectContaining({ status: 'complete', summary: expect.objectContaining({ fail: 305 }) })]);
  }, 150_000);

  test('returns the committed hand-checked cross-source entity view', async () => {
    const { response, body } = await request<Record<string, unknown>>(`/api/v1/entities/${entityView.entity_id}`, { headers: viewerHeaders });
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: entityView.entity_id,
      display_name: entityView.display_name,
      resolution_status: entityView.resolution_status,
      match_method: entityView.match_method,
      match_score_bp: entityView.match_score_bp,
      summary: entityView.summary
    });
    const links = (body.data.links as Array<Record<string, unknown>>).map(({ source_kind, entity_kind, source_id }) => ({ source_kind, entity_kind, source_id }));
    expect(links).toEqual(entityView.links);
  });

  test('filters conflict data and returns field lineage without exposing a broad query scope', async () => {
    const { response, body } = await request<{ items: Array<Record<string, unknown>>; nextCursor: string | null }>(
      '/api/v1/conflicts?type=paid_but_no_deal&source=payments&status=active&limit=100',
      { headers: viewerHeaders }
    );
    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items.every((item) => item.type === 'paid_but_no_deal' && (item.sources_involved as string[]).includes('payments') && item.status === 'active')).toBe(true);

    const conflictId = String(body.data.items[0]?.id);
    const detail = await request<{ evidence: Record<string, unknown>; lineage: unknown[] }>(`/api/v1/conflicts/${encodeURIComponent(conflictId)}`, { headers: viewerHeaders });
    expect(detail.response.status).toBe(200);
    expect(detail.body.data.evidence).toBeTruthy();
    expect(detail.body.data.lineage.length).toBeGreaterThan(0);

    const invalidCursor = await request<unknown>('/api/v1/conflicts?cursor=not-a-cursor', { headers: viewerHeaders });
    expect(invalidCursor.response.status).toBe(400);
  });

  test('creates or deduplicates one pending-by-policy proposal per active conflict without changing the mirror', async () => {
    const started = await startJob('/api/v1/jobs/reconcile', config.RECONCILE_TRIGGER_SECRET, jobKeys.reconcile);
    expect([200, 202]).toContain(started.response.status);
    reconcileJob = started.reference;
    reconcileRun = await waitForJob(reconcileJob.id);
    expect(reconcileRun.status).toBe('complete');
    expect(reconcileRun.result.status).toBe('complete');
    expect(reconcileRun.result.conflictCount).toBe(305);
    expect(Number(reconcileRun.result.proposalsCreated) + Number(reconcileRun.result.proposalsDeduplicated)).toBe(305);
    expect(reconcileRun.result.providerCalls).toBe(reconcileRun.result.proposalsCreated);
    expect(reconcileRun.result.sourceMirrorHashAfter).toBe(reconcileRun.result.sourceMirrorHashBefore);
    expect(Number(reconcileRun.result.durationMs)).toBeLessThan(30_000);

    const overview = await request<{
      conflicts: { active: string };
      proposals: Array<{ status: string; count: number }>;
      spend: { cap_microcents: string; actual_microcents: string; reserved_microcents: string };
      invariant: { summary: { fail: number } };
      reconciliation: { ok: boolean; checks: Array<{ name: string; ok: boolean }> };
    }>('/api/v1/overview', { headers: reviewerHeaders });
    expect(overview.body.data.conflicts.active).toBe('305');
    expect(overview.body.data.invariant.summary.fail).toBe(305);
    expect(overview.body.data.proposals.reduce((sum, row) => sum + row.count, 0)).toBe(305);
    expect(overview.body.data.reconciliation.ok).toBe(true);
    expect(overview.body.data.reconciliation.checks.every(({ ok }) => ok)).toBe(true);
    expect(BigInt(overview.body.data.spend.actual_microcents)).toBeLessThanOrEqual(BigInt(overview.body.data.spend.cap_microcents));
    expect(overview.body.data.spend.reserved_microcents).toBe(overview.body.data.spend.actual_microcents);

    const proposals = await request<Array<{ status: string; evidence: Record<string, unknown>; confidence_bp: number; sensitive_hold: boolean }>>('/api/v1/proposals?status=pending&limit=100', { headers: reviewerHeaders });
    expect(proposals.body.data.length).toBeGreaterThan(0);
    expect(proposals.body.data.every(({ status, evidence, confidence_bp }) => status === 'pending' && Boolean(evidence) && confidence_bp >= 0 && confidence_bp <= 10_000)).toBe(true);
    expect(proposals.body.data.some(({ sensitive_hold }) => sensitive_hold)).toBe(true);
  }, 150_000);

  test('runs stretch ops: groups incidents in pgvector, extracts tickets, auto-applies only eligible proposals, and keeps the source mirror unchanged', async () => {
    const beforeStretch = await request<{ proposals: Array<{ status: string; count: number }> }>('/api/v1/overview', { headers: reviewerHeaders });
    const appliedBefore = beforeStretch.body.data.proposals.find(({ status }) => status === 'applied')?.count ?? 0;
    const started = await startJob('/api/v1/jobs/stretch', config.STRETCH_TRIGGER_SECRET, jobKeys.stretch);
    expect([200, 202]).toContain(started.response.status);
    const run = await waitForJob(started.reference.id, 180_000);
    expect(run.status).toBe('complete');
    expect(run.result.status).toBe('complete');
    const grouping = run.result.grouping as { memberCount: number; groupCount: number; dimensions: number; model: string };
    const tickets = run.result.tickets as { extracted: number; matchedConflicts: number };
    const autoApply = run.result.autoApply as { scanned: number; applied: number; denied: number; sensitiveDenied: number; sourceMirrorHashBefore: string; sourceMirrorHashAfter: string };
    expect(grouping.model).toBe('conflict-pattern-hash-v1');
    expect(grouping.dimensions).toBe(64);
    expect(grouping.memberCount).toBe(305);
    expect(grouping.groupCount).toBeGreaterThan(0);
    expect(tickets.extracted).toBe(305);
    expect(tickets.matchedConflicts).toBe(305);
    expect(autoApply.sourceMirrorHashAfter).toBe(autoApply.sourceMirrorHashBefore);
    expect(autoApply.sensitiveDenied).toBeGreaterThan(0);
    expect(autoApply.scanned).toBeGreaterThan(0);
    expect(autoApply.applied + autoApply.denied).toBe(autoApply.scanned);

    const groups = await request<Array<{ id: string; label: string; member_count: number; nearest_group_id: string | null }>>('/api/v1/incident-groups?limit=50', { headers: reviewerHeaders });
    expect(groups.response.status).toBe(200);
    expect(groups.body.data.length).toBeGreaterThan(0);
    expect(groups.body.data.every((group) => group.member_count >= 1)).toBe(true);

    const extracted = await request<Array<{ student_ref: string | null; family_ref: string | null; system: string; record_id: string | null; issue_type: string; owner: string; requested_action: string }>>('/api/v1/tickets?limit=50', { headers: reviewerHeaders });
    expect(extracted.response.status).toBe(200);
    expect(extracted.body.data.length).toBeGreaterThan(0);
    expect(extracted.body.data.every((ticket) => ticket.issue_type && ticket.owner && ticket.requested_action && ticket.system)).toBe(true);

    const overview = await request<{
      stretch: { incidentGroups: number; extractedTickets: number };
      privacy: { mode: string; retentionDays: number };
      proposals: Array<{ status: string; count: number }>;
    }>('/api/v1/overview', { headers: reviewerHeaders });
    expect(overview.body.data.privacy.mode).toBe('redacted');
    expect(overview.body.data.privacy.retentionDays).toBe(config.LOG_RETENTION_DAYS);
    expect(overview.body.data.stretch.extractedTickets).toBe(305);
    expect(overview.body.data.proposals.reduce((sum, proposal) => sum + proposal.count, 0)).toBe(305);
    const applied = overview.body.data.proposals.find(({ status }) => status === 'applied')?.count ?? 0;
    expect(applied).toBe(appliedBefore + autoApply.applied);

    const appliedRows = await request<Array<{ id: string; sensitive_hold: boolean; confidence_bp: number; status: string; version: number }>>('/api/v1/proposals?status=applied&limit=100', { headers: reviewerHeaders });
    expect(appliedRows.body.data.every((proposal) => proposal.status === 'applied' && !proposal.sensitive_hold && proposal.confidence_bp >= 9500)).toBe(true);
    const pending = await request<Array<{ sensitive_hold: boolean }>>('/api/v1/proposals?status=pending&limit=100', { headers: reviewerHeaders });
    expect(pending.body.data.some((proposal) => proposal.sensitive_hold)).toBe(true);

    const appliedProposal = appliedRows.body.data[0];
    if (appliedProposal) {
      const rolled = await fetch(`${baseUrl}/api/v1/proposals/${appliedProposal.id}/rollback`, { method: 'POST', headers: reviewerHeaders });
      expect(rolled.status).toBe(200);
      const rolledBody = await rolled.json() as Envelope<{ status: string }>;
      expect(rolledBody.data.status).toBe('rolled_back');
      const viewerRollback = await fetch(`${baseUrl}/api/v1/proposals/${appliedProposal.id}/rollback`, { method: 'POST', headers: viewerHeaders });
      expect(viewerRollback.status).toBe(403);
    }
  }, 180_000);

  test('does not let viewer scope decide a proposal', async () => {
    const proposals = await request<Array<{ id: string; version: number }>>('/api/v1/proposals?status=pending&limit=1', { headers: viewerHeaders });
    expect(proposals.body.data).toHaveLength(1);
    const proposal = proposals.body.data[0]!;
    const response = await fetch(`${baseUrl}/api/v1/proposals/${proposal.id}/decision`, {
      method: 'POST',
      headers: { ...viewerHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', reason: 'Integration authorization boundary', version: proposal.version })
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'forbidden' } });
  });

  test('returns the same durable job for a repeated idempotency key', async () => {
    const duplicateSync = await startJob('/api/v1/jobs/sync', config.SYNC_TRIGGER_SECRET, jobKeys.sync);
    expect(duplicateSync.response.status).toBe(200);
    expect(duplicateSync.reference).toEqual({ id: syncJob.id, status: 'complete', duplicate: true });

    const duplicateReconcile = await startJob('/api/v1/jobs/reconcile', config.RECONCILE_TRIGGER_SECRET, jobKeys.reconcile);
    expect(duplicateReconcile.response.status).toBe(200);
    expect(duplicateReconcile.reference).toEqual({ id: reconcileJob.id, status: 'complete', duplicate: true });

    const duplicateStretch = await startJob('/api/v1/jobs/stretch', config.STRETCH_TRIGGER_SECRET, jobKeys.stretch);
    expect(duplicateStretch.response.status).toBe(200);
    expect(duplicateStretch.reference.duplicate).toBe(true);
    expect(duplicateStretch.reference.status).toBe('complete');
  });

  test('degrades a real 5xx source to a structured partial run without hanging', async () => {
    const started = await startJob('/api/v1/jobs/sync', config.SYNC_TRIGGER_SECRET, jobKeys.partial, { faultSource: 'crm', faultMode: '5xx' });
    expect([200, 202]).toContain(started.response.status);
    const run = await waitForJob(started.reference.id);
    expect(run.status).toBe('complete');
    expect(run.result).toMatchObject({
      status: 'partial',
      acceptedRecords: 6_500,
      conflicts: 0,
      sourceAvailability: { crm: 'failed', app: 'complete', payments: 'complete' }
    });
    expect(Number(run.result.durationMs)).toBeLessThan(30_000);
  }, 150_000);
});
