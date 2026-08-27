import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { scoreConfidence, signalsForConflict } from '../domain/confidence.js';
import type { DetectedConflict } from '../domain/fixture-types.js';
import { candidateAction } from '../domain/policy.js';
import { redactMetadata } from '../domain/redaction.js';
import { sha256, stableStringify, stableUuid } from '../domain/stable.js';
import type { DatabasePool } from '../persistence/database.js';
import { inTransaction } from '../persistence/database.js';
import type { ReconcilerProvider } from './provider.js';
import { validateProviderOutput } from './provider.js';
import { ensureSpendRun, markProviderCallStarted, reserveProviderCost, settleProviderCost } from './spend-ledger.js';

export interface ReconcileRequest {
  tenantId: string;
  jobId: string;
  requestId: string;
}

export interface ReconcileResult {
  status: 'complete' | 'halted';
  conflictCount: number;
  proposalsCreated: number;
  proposalsDeduplicated: number;
  providerCalls: number;
  sourceMirrorHashBefore: string;
  sourceMirrorHashAfter: string;
  durationMs: number;
  haltReason?: string;
}

interface ConflictRow {
  id: string;
  conflict_key: string;
  rule_id: string;
  rule_version: string;
  type: DetectedConflict['type'];
  entity_refs: string[];
  sources_involved: DetectedConflict['sources_involved'];
  disagreeing_fields: string[];
  expected_verdict: 'fail';
  evidence: Record<string, unknown>;
}

const PROVIDER_WORK_CONCURRENCY = 8;

interface ReservedConflict {
  row: ConflictRow;
  conflict: DetectedConflict;
  action: ReturnType<typeof candidateAction>;
  reservationId: string;
}

async function forEachConcurrent<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(items.length, concurrency);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item) await worker(item);
    }
  }));
}

async function sourceMirrorHash(pool: DatabasePool, tenantId: string): Promise<string> {
  const result = await pool.query<{ payload_hash: string }>(`SELECT records.payload_hash FROM source_records records
    JOIN active_snapshots active ON active.snapshot_id = records.snapshot_id AND active.tenant_id = records.tenant_id
    WHERE records.tenant_id = $1 ORDER BY records.payload_hash`, [tenantId]);
  return sha256(result.rows.map(({ payload_hash }) => payload_hash).join(''));
}

export async function reconcileConflicts(pool: DatabasePool, config: AppConfig, provider: ReconcilerProvider, request: ReconcileRequest): Promise<ReconcileResult> {
  const started = performance.now();
  const lockClient = await pool.connect();
  const lockKey = `keystone-reconcile:${request.tenantId}`;
  const lock = await lockClient.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [lockKey]);
  if (!lock.rows[0]?.acquired) {
    lockClient.release();
    throw new Error('reconcile_already_running');
  }
  try {
    const before = await sourceMirrorHash(pool, request.tenantId);
    const conflicts = await pool.query<ConflictRow>(`SELECT id, conflict_key, rule_id, rule_version, type, entity_refs, sources_involved, disagreeing_fields, expected_verdict, evidence
      FROM conflicts WHERE tenant_id = $1 AND status = 'active' ORDER BY conflict_key`, [request.tenantId]);
    const spendContext = { tenantId: request.tenantId, jobId: request.jobId, requestId: request.requestId, dailyCap: BigInt(config.DAILY_SPEND_CAP_MICROCENTS), runCap: BigInt(config.PER_RUN_SPEND_CAP_MICROCENTS) };
    const spendRunId = await ensureSpendRun(pool, spendContext);
    let proposalsCreated = 0;
    let proposalsDeduplicated = 0;
    let providerCalls = 0;
    let haltReason: string | undefined;
    const reserved: ReservedConflict[] = [];
    for (const row of conflicts.rows) {
      const conflict: DetectedConflict = { ...row };
      const action = candidateAction(conflict);
      const existing = await pool.query('SELECT id FROM proposals WHERE tenant_id = $1 AND action_fingerprint = $2', [request.tenantId, action.fingerprint]);
      if (existing.rowCount) {
        proposalsDeduplicated += 1;
        continue;
      }
      const reservation = await reserveProviderCost(pool, spendContext, spendRunId, action.fingerprint, provider.maximumCallCostMicrocents);
      if (!reservation.allowed) {
        if (reservation.reason === 'duplicate') {
          proposalsDeduplicated += 1;
          continue;
        }
        haltReason = reservation.reason ?? 'spend_cap_reached';
        break;
      }
      const reservationId = reservation.reservationId;
      if (!reservationId) throw new Error('spend_reservation_id_missing');
      reserved.push({ row, conflict, action, reservationId });
    }
    await forEachConcurrent(reserved, PROVIDER_WORK_CONCURRENCY, async ({ row, conflict, action, reservationId }) => {
      await markProviderCallStarted(pool, reservationId);
      let output;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(new Error('provider_timeout')), config.SOURCE_TIMEOUT_MS);
        output = validateProviderOutput(await provider.propose(conflict, action, controller.signal), action.fingerprint);
        providerCalls += 1;
        await settleProviderCost(pool, request.tenantId, reservationId, BigInt(output.actualCostMicrocents));
      } catch (error) {
        await settleProviderCost(pool, request.tenantId, reservationId, provider.maximumCallCostMicrocents, true);
        const metadata = redactMetadata({ conflictKey: conflict.conflict_key, error: error instanceof Error ? error.message : 'provider_invalid' }, config.LOG_PRIVACY_MODE);
        await pool.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
          VALUES ($1, $2, 'proposal_generation_failed', 'worker', $3, 'conflict', $4, $5::jsonb, $6)`, [randomUUID(), request.tenantId, request.requestId, conflict.conflict_key, JSON.stringify(metadata), sha256(stableStringify(metadata))]);
        return;
      } finally {
        if (timer) clearTimeout(timer);
      }
      const confidence = scoreConfidence(signalsForConflict(conflict, action.sensitiveFields.length > 0));
      const proposalId = stableUuid(`proposal:${request.tenantId}:${action.fingerprint}`);
      const evidence = { conflict: conflict.evidence, provider_summary: output.summary, provider_evidence_refs: output.evidenceRefs, confidence: confidence.signals, policy_version: action.policyVersion };
      await inTransaction(pool, async (client) => {
        const inserted = await client.query(`INSERT INTO proposals(id, tenant_id, conflict_id, action_fingerprint, action, evidence, confidence_bp, confidence_signals, sensitive_fields, sensitive_hold, estimated_cost_microcents, actual_cost_microcents, status)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::text[], $10, $11, $12, 'pending')
          ON CONFLICT (tenant_id, action_fingerprint) DO NOTHING RETURNING id`, [proposalId, request.tenantId, row.id, action.fingerprint, JSON.stringify(action), JSON.stringify(evidence), confidence.scoreBp, JSON.stringify(confidence.signals), action.sensitiveFields, action.sensitiveFields.length > 0, provider.maximumCallCostMicrocents.toString(), String(output.actualCostMicrocents)]);
        if (!inserted.rowCount) return;
        const auditMetadata = redactMetadata({ proposalId, conflictKey: conflict.conflict_key, confidenceBp: confidence.scoreBp, sensitiveHold: action.sensitiveFields.length > 0, inputTokens: output.inputTokens, outputTokens: output.outputTokens, actualCostMicrocents: output.actualCostMicrocents }, config.LOG_PRIVACY_MODE);
        await client.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
          VALUES ($1, $2, 'proposal_created', 'worker', $3, 'proposal', $4, $5::jsonb, $6)`, [randomUUID(), request.tenantId, request.requestId, proposalId, JSON.stringify(auditMetadata), sha256(stableStringify(auditMetadata))]);
        proposalsCreated += 1;
      });
    });
    const after = await sourceMirrorHash(pool, request.tenantId);
    if (before !== after) throw new Error('source_mirror_changed_during_reconciliation');
    return {
      status: haltReason ? 'halted' : 'complete',
      conflictCount: conflicts.rowCount ?? conflicts.rows.length,
      proposalsCreated,
      proposalsDeduplicated,
      providerCalls,
      sourceMirrorHashBefore: before,
      sourceMirrorHashAfter: after,
      durationMs: Math.round(performance.now() - started),
      ...(haltReason ? { haltReason } : {})
    };
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
    lockClient.release();
  }
}
