import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '../persistence/database.js';
import { inTransaction } from '../persistence/database.js';
import { sha256, stableStringify, stableUuid } from '../domain/stable.js';

export interface SpendContext {
  tenantId: string;
  jobId: string;
  requestId: string;
  dailyCap: bigint;
  runCap: bigint;
}

export interface ReservationResult {
  allowed: boolean;
  reservationId?: string;
  reason?: 'daily_cap' | 'run_cap' | 'duplicate';
}

export async function ensureSpendRun(pool: DatabasePool, context: SpendContext): Promise<string> {
  const id = stableUuid(`spend-run:${context.tenantId}:${context.jobId}`);
  await pool.query(`INSERT INTO spend_runs(id, tenant_id, job_id, cap_microcents)
    VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [id, context.tenantId, context.jobId, context.runCap.toString()]);
  return id;
}

export async function reserveProviderCost(pool: DatabasePool, context: SpendContext, spendRunId: string, actionFingerprint: string, estimate: bigint): Promise<ReservationResult> {
  if (estimate < 0n) throw new Error('estimate_invalid');
  return inTransaction(pool, async (client) => {
    const duplicate = await client.query<{ id: string }>('SELECT id FROM spend_reservations WHERE tenant_id = $1 AND action_fingerprint = $2', [context.tenantId, actionFingerprint]);
    if (duplicate.rows[0]) return { allowed: false, reservationId: duplicate.rows[0].id, reason: 'duplicate' as const };
    await client.query(`INSERT INTO spend_buckets(tenant_id, spend_day, cap_microcents) VALUES ($1, (now() AT TIME ZONE 'UTC')::date, $2)
      ON CONFLICT (tenant_id, spend_day) DO UPDATE SET cap_microcents = EXCLUDED.cap_microcents`, [context.tenantId, context.dailyCap.toString()]);
    const bucket = await client.query<{ reserved_microcents: string; cap_microcents: string }>(`SELECT reserved_microcents, cap_microcents FROM spend_buckets
      WHERE tenant_id = $1 AND spend_day = (now() AT TIME ZONE 'UTC')::date FOR UPDATE`, [context.tenantId]);
    const run = await client.query<{ reserved_microcents: string; cap_microcents: string }>('SELECT reserved_microcents, cap_microcents FROM spend_runs WHERE id = $1 FOR UPDATE', [spendRunId]);
    const dailyAllowed = BigInt(bucket.rows[0]?.reserved_microcents ?? '0') + estimate <= BigInt(bucket.rows[0]?.cap_microcents ?? '0');
    const runAllowed = BigInt(run.rows[0]?.reserved_microcents ?? '0') + estimate <= BigInt(run.rows[0]?.cap_microcents ?? '0');
    if (!dailyAllowed || !runAllowed) {
      const reason = dailyAllowed ? 'run_cap' : 'daily_cap';
      const metadata = { reason, estimate: estimate.toString(), actionFingerprint };
      await client.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
        VALUES ($1, $2, 'spend_cap_reached', 'worker', $3, 'job', $4, $5::jsonb, $6)`, [randomUUID(), context.tenantId, context.requestId, context.jobId, JSON.stringify(metadata), sha256(stableStringify(metadata))]);
      await client.query(`INSERT INTO alert_events(id, tenant_id, alert_type, severity, message, metadata)
        VALUES ($1, $2, 'spend_cap_reached', 'critical', 'Reconciliation halted before provider call because a hard spend cap was reached.', $3::jsonb)`, [randomUUID(), context.tenantId, JSON.stringify(metadata)]);
      return { allowed: false, reason };
    }
    const reservationId = stableUuid(`reservation:${context.tenantId}:${actionFingerprint}`);
    await client.query(`INSERT INTO spend_reservations(id, tenant_id, spend_run_id, action_fingerprint, maximum_microcents, status)
      VALUES ($1, $2, $3, $4, $5, 'reserved')`, [reservationId, context.tenantId, spendRunId, actionFingerprint, estimate.toString()]);
    await client.query(`UPDATE spend_buckets SET reserved_microcents = reserved_microcents + $2, updated_at = now()
      WHERE tenant_id = $1 AND spend_day = (now() AT TIME ZONE 'UTC')::date`, [context.tenantId, estimate.toString()]);
    await client.query('UPDATE spend_runs SET reserved_microcents = reserved_microcents + $2 WHERE id = $1', [spendRunId, estimate.toString()]);
    return { allowed: true, reservationId };
  });
}

export async function markProviderCallStarted(pool: DatabasePool, reservationId: string): Promise<void> {
  await pool.query('UPDATE spend_reservations SET provider_call_started_at = now() WHERE id = $1 AND status = $2', [reservationId, 'reserved']);
}

export async function settleProviderCost(pool: DatabasePool, tenantId: string, reservationId: string, actual: bigint, chargeWorstCase = false): Promise<void> {
  await inTransaction(pool, async (client) => {
    const reservation = await client.query<{ spend_run_id: string; maximum_microcents: string; status: string }>('SELECT spend_run_id, maximum_microcents, status FROM spend_reservations WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [reservationId, tenantId]);
    const row = reservation.rows[0];
    if (!row) throw new Error('spend_reservation_not_found');
    if (row.status !== 'reserved') return;
    const maximum = BigInt(row.maximum_microcents);
    const charged = chargeWorstCase ? maximum : actual;
    if (charged < 0n || charged > maximum) throw new Error('actual_cost_invalid');
    const released = maximum - charged;
    await client.query(`UPDATE spend_reservations SET actual_microcents = $2, status = $3, settled_at = now() WHERE id = $1`, [reservationId, charged.toString(), chargeWorstCase ? 'charged_worst_case' : 'settled']);
    await client.query(`UPDATE spend_buckets SET reserved_microcents = reserved_microcents - $2, actual_microcents = actual_microcents + $3, released_microcents = released_microcents + $2, updated_at = now()
      WHERE tenant_id = $1 AND spend_day = (now() AT TIME ZONE 'UTC')::date`, [tenantId, released.toString(), charged.toString()]);
    await client.query(`UPDATE spend_runs SET reserved_microcents = reserved_microcents - $2, actual_microcents = actual_microcents + $3 WHERE id = $1`, [row.spend_run_id, released.toString(), charged.toString()]);
  });
}
