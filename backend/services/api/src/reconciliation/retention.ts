import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { PRIVACY_POLICY_VERSION, redactMetadata } from '../domain/redaction.js';
import { sha256, stableStringify } from '../domain/stable.js';
import type { DatabasePool } from '../persistence/database.js';
import { inTransaction } from '../persistence/database.js';

export interface RetentionResult {
  retentionDays: number;
  cutoffAt: string;
  alertsDeleted: number;
  policyVersion: typeof PRIVACY_POLICY_VERSION;
}

export async function retainLogs(
  pool: DatabasePool,
  config: AppConfig,
  request: { tenantId: string; requestId: string }
): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - config.LOG_RETENTION_DAYS * 86_400_000);
  return inTransaction(pool, async (client) => {
    const deleted = await client.query(`DELETE FROM alert_events WHERE tenant_id = $1 AND created_at < $2`, [request.tenantId, cutoff.toISOString()]);
    const alertsDeleted = deleted.rowCount ?? 0;
    await client.query(`INSERT INTO log_retention_runs(id, tenant_id, retention_days, alerts_deleted, cutoff_at)
      VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), request.tenantId, config.LOG_RETENTION_DAYS, alertsDeleted, cutoff.toISOString()]);
    const metadata = redactMetadata({
      retentionDays: config.LOG_RETENTION_DAYS,
      alertsDeleted,
      cutoffAt: cutoff.toISOString(),
      auditPolicy: 'redacted_append_only'
    }, config.LOG_PRIVACY_MODE);
    await client.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
      VALUES ($1, $2, 'logs_retained', 'worker:stretch', $3, 'tenant', $4, $5::jsonb, $6)`, [
      randomUUID(), request.tenantId, request.requestId, request.tenantId, JSON.stringify(metadata), sha256(stableStringify(metadata))
    ]);
    return {
      retentionDays: config.LOG_RETENTION_DAYS,
      cutoffAt: cutoff.toISOString(),
      alertsDeleted,
      policyVersion: PRIVACY_POLICY_VERSION
    };
  });
}
