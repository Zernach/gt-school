import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transitionProposal, type ProposalDecision } from '../domain/proposal-state.js';
import { sha256, stableStringify } from '../domain/stable.js';
import type { DatabasePool } from './database.js';
import { inTransaction } from './database.js';

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  role: 'viewer' | 'reviewer';
}

export async function authenticateClient(pool: DatabasePool, key: string): Promise<TenantContext | undefined> {
  const keyHash = sha256(key);
  const result = await pool.query<{ id: string; slug: string; role: TenantContext['role'] }>(`SELECT id, slug,
      CASE WHEN reviewer_key_hash = $1 THEN 'reviewer' ELSE 'viewer' END AS role
    FROM tenants WHERE client_key_hash = $1 OR reviewer_key_hash = $1`, [keyHash]);
  const row = result.rows[0];
  return row ? { tenantId: row.id, tenantSlug: row.slug, role: row.role } : undefined;
}

export async function getOverview(pool: DatabasePool, tenantId: string): Promise<Record<string, unknown>> {
  const [source, conflicts, proposals, invariant, spend, sync] = await Promise.all([
    pool.query(`SELECT active.source_kind, active.activated_at, snapshots.generation, snapshots.accepted_count, snapshots.rejected_count, snapshots.status
      FROM active_snapshots active JOIN source_snapshots snapshots ON snapshots.id = active.snapshot_id WHERE active.tenant_id = $1 ORDER BY active.source_kind`, [tenantId]),
    pool.query<{ active: string; resolved: string; oscillation_hold: string }>(`SELECT
      count(*) FILTER (WHERE status = 'active') AS active,
      count(*) FILTER (WHERE status = 'resolved') AS resolved,
      count(*) FILTER (WHERE status = 'oscillation_hold') AS oscillation_hold
      FROM conflicts WHERE tenant_id = $1`, [tenantId]),
    pool.query(`SELECT status, count(*)::integer AS count FROM proposals WHERE tenant_id = $1 GROUP BY status ORDER BY status`, [tenantId]),
    pool.query(`SELECT status, summary, source_availability, completed_at FROM invariant_runs WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 1`, [tenantId]),
    pool.query(`SELECT cap_microcents, reserved_microcents, actual_microcents, released_microcents FROM spend_buckets
      WHERE tenant_id = $1 AND spend_day = (now() AT TIME ZONE 'UTC')::date`, [tenantId]),
    pool.query(`SELECT id, status, requested_generation, source_availability, summary, completed_at FROM sync_runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [tenantId])
  ]);
  return {
    sources: source.rows,
    conflicts: conflicts.rows[0] ?? { active: '0', resolved: '0', oscillation_hold: '0' },
    proposals: proposals.rows,
    invariant: invariant.rows[0] ?? null,
    spend: spend.rows[0] ?? { cap_microcents: '0', reserved_microcents: '0', actual_microcents: '0', released_microcents: '0' },
    latestRun: sync.rows[0] ?? null
  };
}

const cursorSchema = z.object({ time: z.string().datetime(), id: z.string().min(1) });

function decodeCursor(cursor?: string): z.infer<typeof cursorSchema> | undefined {
  if (!cursor) return undefined;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new Error('cursor_invalid');
  }
}

function encodeCursor(time: Date | string, id: string): string {
  return Buffer.from(JSON.stringify({ time: new Date(time).toISOString(), id }), 'utf8').toString('base64url');
}

export interface ConflictFilters {
  type?: string;
  source?: string;
  status?: string;
  proposalStatus?: string;
  minimumConfidenceBp?: number;
  from?: string;
  cursor?: string;
  limit: number;
}

export async function listConflicts(pool: DatabasePool, tenantId: string, filters: ConflictFilters): Promise<{ items: unknown[]; nextCursor: string | null }> {
  const values: unknown[] = [tenantId];
  const where = ['conflicts.tenant_id = $1'];
  const add = (clause: string, value: unknown): void => { values.push(value); where.push(clause.replace('?', `$${values.length}`)); };
  if (filters.type) add('conflicts.type = ?', filters.type);
  if (filters.source) add('? = ANY(conflicts.sources_involved)', filters.source);
  if (filters.status) add('conflicts.status = ?', filters.status);
  if (filters.proposalStatus) add('proposal.status = ?', filters.proposalStatus);
  if (filters.minimumConfidenceBp !== undefined) add('proposal.confidence_bp >= ?', filters.minimumConfidenceBp);
  if (filters.from) add('conflicts.last_seen_at >= ?::timestamptz', filters.from);
  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    values.push(cursor.time, cursor.id);
    where.push(`(conflicts.last_seen_at, conflicts.id) < ($${values.length - 1}::timestamptz, $${values.length})`);
  }
  values.push(filters.limit + 1);
  const result = await pool.query(`SELECT conflicts.id, conflicts.type, conflicts.entity_refs, conflicts.sources_involved, conflicts.disagreeing_fields,
      conflicts.status, conflicts.last_seen_at, conflicts.latest_generation, conflicts.oscillation_count,
      proposal.id AS proposal_id, proposal.status AS proposal_status, proposal.confidence_bp, proposal.sensitive_hold
    FROM conflicts
    LEFT JOIN LATERAL (SELECT id, status, confidence_bp, sensitive_hold FROM proposals WHERE proposals.tenant_id = conflicts.tenant_id AND proposals.conflict_id = conflicts.id ORDER BY created_at DESC LIMIT 1) proposal ON true
    WHERE ${where.join(' AND ')} ORDER BY conflicts.last_seen_at DESC, conflicts.id DESC LIMIT $${values.length}`, values);
  const hasMore = result.rows.length > filters.limit;
  const items = result.rows.slice(0, filters.limit);
  const last = items.at(-1) as { last_seen_at: Date | string; id: string } | undefined;
  return { items, nextCursor: hasMore && last ? encodeCursor(last.last_seen_at, last.id) : null };
}

export async function getConflictDetail(pool: DatabasePool, tenantId: string, conflictId: string): Promise<Record<string, unknown> | undefined> {
  const conflict = await pool.query(`SELECT * FROM conflicts WHERE tenant_id = $1 AND id = $2`, [tenantId, conflictId]);
  if (!conflict.rows[0]) return undefined;
  const proposal = await pool.query(`SELECT * FROM proposals WHERE tenant_id = $1 AND conflict_id = $2 ORDER BY created_at DESC LIMIT 1`, [tenantId, conflictId]);
  const entityRefs = (conflict.rows[0].entity_refs as string[]) ?? [];
  const studentEntityIds = entityRefs.filter((ref) => ref.startsWith('student:')).map((ref) => `entity:${ref.slice('student:'.length)}`);
  const directSourceIds = entityRefs.map((ref) => ref.slice(ref.indexOf(':') + 1));
  const lineage = await pool.query(`SELECT records.source_kind, records.entity_kind, records.source_id, fields.field_path, fields.raw_value,
      fields.normalized_value, fields.normalization_version, fields.transformation_trace, fields.source_observed_at, records.ingested_at
    FROM field_observations fields
    JOIN source_records records ON records.id = fields.source_record_id
    JOIN active_snapshots active ON active.tenant_id = records.tenant_id AND active.source_kind = records.source_kind AND active.snapshot_id = records.snapshot_id
    WHERE fields.tenant_id = $1 AND (
      records.source_id = ANY($2::text[]) OR records.id IN (
        SELECT source_record_id FROM entity_links WHERE tenant_id = $1 AND canonical_entity_id = ANY($3::text[])
      )
    ) ORDER BY records.source_kind, records.entity_kind, records.source_id, fields.field_path LIMIT 500`, [tenantId, directSourceIds, studentEntityIds]);
  const proposalId = proposal.rows[0]?.id as string | undefined;
  const audits = await pool.query(`SELECT event_type, actor, object_type, object_id, metadata, created_at FROM audit_events
    WHERE tenant_id = $1 AND (object_id = $2 OR ($3::text IS NOT NULL AND object_id = $3)) ORDER BY created_at, id`, [tenantId, conflictId, proposalId ?? null]);
  return { ...conflict.rows[0], proposal: proposal.rows[0] ?? null, lineage: lineage.rows, audit: audits.rows };
}

export interface ProposalFilters {
  status?: string;
  minimumConfidenceBp?: number;
  limit: number;
}

export async function listProposals(pool: DatabasePool, tenantId: string, filters: ProposalFilters): Promise<unknown[]> {
  return (await pool.query(`SELECT proposals.*, conflicts.type AS conflict_type, conflicts.entity_refs, conflicts.sources_involved, conflicts.disagreeing_fields
    FROM proposals JOIN conflicts ON conflicts.tenant_id = proposals.tenant_id AND conflicts.id = proposals.conflict_id
    WHERE proposals.tenant_id = $1 AND ($2::text IS NULL OR proposals.status = $2) AND ($3::integer IS NULL OR proposals.confidence_bp >= $3)
    ORDER BY proposals.created_at DESC, proposals.id LIMIT $4`, [tenantId, filters.status ?? null, filters.minimumConfidenceBp ?? null, filters.limit])).rows;
}

export async function decideProposal(pool: DatabasePool, context: TenantContext, proposalId: string, decision: ProposalDecision, reason: string, version: number, requestId: string): Promise<Record<string, unknown> | undefined> {
  if (context.role !== 'reviewer') throw new Error('reviewer_required');
  return inTransaction(pool, async (client) => {
    const current = await client.query<{ status: 'pending' | 'approved' | 'rejected' | 'held' | 'superseded'; version: number }>('SELECT status, version FROM proposals WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [context.tenantId, proposalId]);
    const row = current.rows[0];
    if (!row) return undefined;
    if (row.version !== version) throw new Error('proposal_version_stale');
    const status = transitionProposal(row.status, decision);
    const updated = await client.query(`UPDATE proposals SET status = $3, version = version + 1, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`, [context.tenantId, proposalId, status]);
    await client.query(`INSERT INTO proposal_decisions(id, tenant_id, proposal_id, decision, reason, actor, proposal_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [randomUUID(), context.tenantId, proposalId, decision, reason, `fixture-reviewer:${context.tenantSlug}`, version]);
    const metadata = { decision, reason, from: row.status, to: status, version };
    await client.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
      VALUES ($1, $2, 'proposal_decided', $3, $4, 'proposal', $5, $6::jsonb, $7)`, [randomUUID(), context.tenantId, `fixture-reviewer:${context.tenantSlug}`, requestId, proposalId, JSON.stringify(metadata), sha256(stableStringify(metadata))]);
    return updated.rows[0];
  });
}

export async function getEntity(pool: DatabasePool, tenantId: string, entityId: string): Promise<Record<string, unknown> | undefined> {
  const entity = await pool.query(`SELECT id, entity_kind, display_name, resolution_status, match_method, match_score_bp, summary, updated_at
    FROM canonical_entities WHERE tenant_id = $1 AND id = $2`, [tenantId, entityId]);
  if (!entity.rows[0]) return undefined;
  const links = await pool.query(`SELECT records.source_kind, records.entity_kind, records.source_id, links.match_method, links.match_score_bp, links.evidence
    FROM entity_links links
    JOIN source_records records ON records.id = links.source_record_id
    JOIN active_snapshots active ON active.tenant_id = records.tenant_id AND active.source_kind = records.source_kind AND active.snapshot_id = records.snapshot_id
    WHERE links.tenant_id = $1 AND links.canonical_entity_id = $2 ORDER BY records.source_kind, records.entity_kind, records.source_id`, [tenantId, entityId]);
  return { ...entity.rows[0], links: links.rows };
}

export async function getRun(pool: DatabasePool, tenantId: string, runId: string): Promise<Record<string, unknown> | undefined> {
  const job = await pool.query(`SELECT id, job_type, status, attempt_count, max_attempts, result, last_error, created_at, started_at, completed_at
    FROM jobs WHERE tenant_id = $1 AND id = $2`, [tenantId, runId]);
  if (job.rows[0]) return { kind: 'job', ...job.rows[0] };
  const sync = await pool.query(`SELECT * FROM sync_runs WHERE tenant_id = $1 AND id = $2`, [tenantId, runId]);
  if (!sync.rows[0]) return undefined;
  const sources = await pool.query(`SELECT source_kind, generation, status, accepted_count, rejected_count, latency_ms, error_code, error_detail, started_at, completed_at
    FROM source_runs WHERE tenant_id = $1 AND sync_run_id = $2 ORDER BY source_kind`, [tenantId, runId]);
  const invariants = await pool.query(`SELECT rule_set_version, status, source_availability, summary, started_at, completed_at FROM invariant_runs
    WHERE tenant_id = $1 AND sync_run_id = $2 ORDER BY started_at`, [tenantId, runId]);
  return { kind: 'sync', ...sync.rows[0], sources: sources.rows, invariants: invariants.rows };
}
