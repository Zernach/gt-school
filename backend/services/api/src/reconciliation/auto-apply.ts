import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { scoreConfidence, signalsForConflict } from '../domain/confidence.js';
import type { ConflictType } from '../domain/fixture-types.js';
import { canAutoApply, candidateAction, evaluateAutoApply } from '../domain/policy.js';
import { transitionAutoApply, transitionRollback } from '../domain/proposal-state.js';
import { redactMetadata } from '../domain/redaction.js';
import { sha256, stableStringify, stableUuid } from '../domain/stable.js';
import type { DatabasePool } from '../persistence/database.js';
import { inTransaction } from '../persistence/database.js';

interface PendingProposalRow {
  id: string;
  conflict_id: string;
  version: number;
  status: 'pending';
  confidence_bp: number;
  sensitive_fields: string[];
  sensitive_hold: boolean;
  action: { kind: string; targetField: string; proposedValue: string; policyVersion: string; fingerprint?: string };
  evidence: Record<string, unknown>;
  type: ConflictType;
  conflict_key: string;
  rule_id: string;
  rule_version: string;
  entity_refs: string[];
  sources_involved: Array<'crm' | 'app' | 'payments'>;
  disagreeing_fields: string[];
  expected_verdict: 'fail';
  conflict_evidence: Record<string, unknown>;
  conflict_status: string;
}

export interface AutoApplyResult {
  scanned: number;
  applied: number;
  denied: number;
  sensitiveDenied: number;
  sourceMirrorHashBefore: string;
  sourceMirrorHashAfter: string;
}

async function sourceMirrorHash(pool: DatabasePool, tenantId: string): Promise<string> {
  const result = await pool.query<{ payload_hash: string }>(`SELECT records.payload_hash FROM source_records records
    JOIN active_snapshots active ON active.snapshot_id = records.snapshot_id AND active.tenant_id = records.tenant_id
    WHERE records.tenant_id = $1 ORDER BY records.payload_hash`, [tenantId]);
  return sha256(result.rows.map(({ payload_hash }) => payload_hash).join(''));
}

function evidenceComplete(row: PendingProposalRow): boolean {
  const signals = row.evidence.confidence as { missingEvidence?: boolean; evidenceComplete?: boolean } | undefined;
  if (signals?.evidenceComplete === false || signals?.missingEvidence === true) return false;
  return Object.keys(row.conflict_evidence).length > 0 && row.entity_refs.length > 0;
}

export async function autoApplyEligibleProposals(
  pool: DatabasePool,
  config: AppConfig,
  request: { tenantId: string; requestId: string }
): Promise<AutoApplyResult> {
  const before = await sourceMirrorHash(pool, request.tenantId);
  const pending = await pool.query<PendingProposalRow>(`SELECT proposals.id, proposals.conflict_id, proposals.version, proposals.status, proposals.confidence_bp,
      proposals.sensitive_fields, proposals.sensitive_hold, proposals.action, proposals.evidence,
      conflicts.type, conflicts.conflict_key, conflicts.rule_id, conflicts.rule_version, conflicts.entity_refs,
      conflicts.sources_involved, conflicts.disagreeing_fields, conflicts.expected_verdict,
      conflicts.evidence AS conflict_evidence, conflicts.status AS conflict_status
    FROM proposals JOIN conflicts ON conflicts.tenant_id = proposals.tenant_id AND conflicts.id = proposals.conflict_id
    WHERE proposals.tenant_id = $1 AND proposals.status = 'pending' ORDER BY proposals.id`, [request.tenantId]);
  let applied = 0;
  let denied = 0;
  let sensitiveDenied = 0;
  for (const row of pending.rows) {
    const conflict = {
      conflict_key: row.conflict_key,
      rule_id: row.rule_id,
      rule_version: row.rule_version,
      type: row.type,
      entity_refs: row.entity_refs,
      sources_involved: row.sources_involved,
      disagreeing_fields: row.disagreeing_fields,
      expected_verdict: row.expected_verdict,
      evidence: row.conflict_evidence
    };
    const action = candidateAction(conflict);
    const complete = evidenceComplete(row);
    const confidence = scoreConfidence(signalsForConflict(conflict, action.sensitiveFields.length > 0));
    const gate = evaluateAutoApply({ action, confidenceBp: confidence.scoreBp, evidenceComplete: complete, rollbackAvailable: true });
    if (!gate.eligible || !canAutoApply(action, confidence.scoreBp, complete, true)) {
      denied += 1;
      if (gate.denials.includes('sensitive_field') || row.sensitive_hold) sensitiveDenied += 1;
      continue;
    }
    const applicationId = stableUuid(`application:${request.tenantId}:${row.id}`);
    const snapshot = {
      proposal: { id: row.id, status: row.status, version: row.version, conflictId: row.conflict_id },
      conflict: { id: row.conflict_id, status: row.conflict_status },
      sourceMirrorHash: before
    };
    await inTransaction(pool, async (client) => {
      const locked = await client.query<{ status: 'pending' | 'approved' | 'rejected' | 'held' | 'superseded' | 'applied' | 'rolled_back'; version: number }>(
        'SELECT status, version FROM proposals WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [request.tenantId, row.id]
      );
      const current = locked.rows[0];
      if (!current || current.status !== 'pending' || current.version !== row.version) return;
      const status = transitionAutoApply(current.status);
      const inserted = await client.query(`INSERT INTO proposal_applications(id, tenant_id, proposal_id, conflict_id, status, rollback_snapshot, actor, request_id)
        VALUES ($1, $2, $3, $4, 'applied', $5::jsonb, 'worker:auto-apply', $6)
        ON CONFLICT (tenant_id, proposal_id) DO NOTHING RETURNING id`, [applicationId, request.tenantId, row.id, row.conflict_id, JSON.stringify(snapshot), request.requestId]);
      if (!inserted.rowCount) return;
      await client.query(`UPDATE proposals SET status = $3, confidence_bp = $4, confidence_signals = $5::jsonb, version = version + 1, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [request.tenantId, row.id, status, confidence.scoreBp, JSON.stringify(confidence.signals)]);
      const metadata = redactMetadata({
        proposalId: row.id,
        conflictKey: row.conflict_key,
        storedConfidenceBp: row.confidence_bp,
        gatedConfidenceBp: confidence.scoreBp,
        confidenceVersion: confidence.version,
        denials: gate.denials,
        reversible: true
      }, config.LOG_PRIVACY_MODE);
      await client.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
        VALUES ($1, $2, 'proposal_auto_applied', 'worker:auto-apply', $3, 'proposal', $4, $5::jsonb, $6)`, [
        randomUUID(), request.tenantId, request.requestId, row.id, JSON.stringify(metadata), sha256(stableStringify(metadata))
      ]);
      applied += 1;
    });
  }
  const after = await sourceMirrorHash(pool, request.tenantId);
  if (before !== after) throw new Error('source_mirror_changed_during_auto_apply');
  return { scanned: pending.rowCount ?? pending.rows.length, applied, denied, sensitiveDenied, sourceMirrorHashBefore: before, sourceMirrorHashAfter: after };
}

export async function rollbackAutoApply(
  pool: DatabasePool,
  config: AppConfig,
  request: { tenantId: string; proposalId: string; requestId: string; actor: string }
): Promise<Record<string, unknown> | undefined> {
  return inTransaction(pool, async (client) => {
    const application = await client.query<{ id: string; status: 'applied' | 'rolled_back'; rollback_snapshot: { proposal: { version: number } } }>(
      `SELECT id, status, rollback_snapshot FROM proposal_applications WHERE tenant_id = $1 AND proposal_id = $2 FOR UPDATE`,
      [request.tenantId, request.proposalId]
    );
    const row = application.rows[0];
    if (!row) return undefined;
    const proposal = await client.query<{ status: 'applied' | 'pending' | 'approved' | 'rejected' | 'held' | 'superseded' | 'rolled_back' }>(
      'SELECT status FROM proposals WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [request.tenantId, request.proposalId]
    );
    const current = proposal.rows[0];
    if (!current) return undefined;
    const status = transitionRollback(current.status);
    await client.query(`UPDATE proposals SET status = $3, version = version + 1, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [request.tenantId, request.proposalId, status]);
    await client.query(`UPDATE proposal_applications SET status = 'rolled_back', rolled_back_at = now() WHERE id = $1`, [row.id]);
    const metadata = redactMetadata({ proposalId: request.proposalId, applicationId: row.id, restoredStatus: status }, config.LOG_PRIVACY_MODE);
    await client.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
      VALUES ($1, $2, 'proposal_auto_apply_rolled_back', $3, $4, 'proposal', $5, $6::jsonb, $7)`, [
      randomUUID(), request.tenantId, request.actor, request.requestId, request.proposalId, JSON.stringify(metadata), sha256(stableStringify(metadata))
    ]);
    const updated = await client.query(`SELECT * FROM proposals WHERE tenant_id = $1 AND id = $2`, [request.tenantId, request.proposalId]);
    return updated.rows[0] ?? { proposalId: request.proposalId, status, applicationId: row.id };
  });
}
