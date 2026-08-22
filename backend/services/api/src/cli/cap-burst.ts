import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { sha256 } from '../domain/stable.js';
import { createPool } from '../persistence/database.js';
import { getOverview } from '../persistence/queries.js';
import {
  ensureSpendRun,
  markProviderCallStarted,
  reserveProviderCost,
  settleProviderCost
} from '../reconciliation/spend-ledger.js';

const config = loadConfig();
if (!config.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL is required for the isolated cap-burst harness');
const pool = createPool(config.DATABASE_URL, 'keystone-cap-burst');
const adminPool = createPool(config.DATABASE_ADMIN_URL, 'keystone-cap-burst-cleanup');
const tenantId = randomUUID();
const jobId = randomUUID();
const requestId = `cap-burst-${randomUUID()}`;
const suffix = tenantId.replaceAll('-', '').slice(0, 12);
const estimate = 10n;
const cap = 50n;
const attemptedCalls = 20;
let scorecard: Record<string, unknown> | undefined;

async function cleanupTenant(targetTenantId: string): Promise<void> {
  await adminPool.query('DELETE FROM audit_events WHERE tenant_id = $1', [targetTenantId]);
  await adminPool.query('DELETE FROM alert_events WHERE tenant_id = $1', [targetTenantId]);
  await adminPool.query('DELETE FROM spend_reservations WHERE tenant_id = $1', [targetTenantId]);
  await adminPool.query('DELETE FROM spend_buckets WHERE tenant_id = $1', [targetTenantId]);
  await adminPool.query('DELETE FROM spend_runs WHERE tenant_id = $1', [targetTenantId]);
  await adminPool.query('DELETE FROM jobs WHERE tenant_id = $1', [targetTenantId]);
  await adminPool.query('DELETE FROM tenants WHERE id = $1', [targetTenantId]);
}

try {
  const staleHarnessTenants = await adminPool.query<{ id: string }>("SELECT id FROM tenants WHERE slug LIKE 'cap-burst-%'");
  for (const stale of staleHarnessTenants.rows) await cleanupTenant(stale.id);
  await adminPool.query(
    `INSERT INTO tenants(id, slug, client_key_hash, reviewer_key_hash)
      VALUES ($1, $2, $3, $4)`,
    [tenantId, `cap-burst-${suffix}`, sha256(`viewer-${tenantId}`), sha256(`reviewer-${tenantId}`)]
  );
  await adminPool.query(
    `INSERT INTO jobs(id, tenant_id, job_type, idempotency_key, request_id, payload, status, max_attempts)
      VALUES ($1, $2, 'reconcile', $3, $4, '{}'::jsonb, 'running', 1)`,
    [jobId, tenantId, `cap-burst-${suffix}`, requestId]
  );

  const context = { tenantId, jobId, requestId, dailyCap: cap, runCap: cap };
  const spendRunId = await ensureSpendRun(pool, context);
  let providerCalls = 0;
  const results = await Promise.all(
    Array.from({ length: attemptedCalls }, async (_, index) => {
      const fingerprint = `cap-burst-action-${index}`;
      const reservation = await reserveProviderCost(pool, context, spendRunId, fingerprint, estimate);
      if (!reservation.allowed) return { fingerprint, reservation };
      assert.ok(reservation.reservationId, 'an allowed reservation must have an id');
      await markProviderCallStarted(pool, reservation.reservationId);
      providerCalls += 1;
      await settleProviderCost(pool, tenantId, reservation.reservationId, estimate);
      return { fingerprint, reservation };
    })
  );

  const allowed = results.filter(({ reservation }) => reservation.allowed);
  const denied = results.filter(({ reservation }) => !reservation.allowed);
  assert.equal(allowed.length, 5, 'the burst must stop exactly at the configured cap');
  assert.equal(denied.length, 15, 'every call above the cap must be denied');
  assert.equal(providerCalls, 5, 'a denied reservation must never reach the provider-call boundary');
  assert.ok(denied.every(({ reservation }) => reservation.reason === 'daily_cap'));

  const beforeRetry = await pool.query<{ audit_count: string; alert_count: string; started_count: string }>(
    `SELECT
      (SELECT count(*) FROM audit_events WHERE tenant_id = $1 AND event_type = 'spend_cap_reached') AS audit_count,
      (SELECT count(*) FROM alert_events WHERE tenant_id = $1 AND alert_type = 'spend_cap_reached') AS alert_count,
      (SELECT count(*) FROM spend_reservations WHERE tenant_id = $1 AND provider_call_started_at IS NOT NULL) AS started_count`,
    [tenantId]
  );
  assert.equal(beforeRetry.rows[0]?.audit_count, '15');
  assert.equal(beforeRetry.rows[0]?.alert_count, '15');
  assert.equal(beforeRetry.rows[0]?.started_count, '5');

  const overview = await getOverview(pool, tenantId);
  const spend = overview.spend as Record<string, string>;
  assert.equal(spend.cap_microcents, cap.toString());
  assert.equal(spend.reserved_microcents, cap.toString());
  assert.equal(spend.actual_microcents, cap.toString());
  assert.equal(spend.released_microcents, '0');

  const duplicateRetry = await reserveProviderCost(pool, context, spendRunId, results[0]!.fingerprint, estimate);
  assert.deepEqual(duplicateRetry.reason, 'duplicate');
  const newRetry = await reserveProviderCost(pool, context, spendRunId, 'cap-burst-after-cap', estimate);
  assert.equal(newRetry.allowed, false);
  assert.equal(newRetry.reason, 'daily_cap');

  const afterRetry = await pool.query<{ reservations: string; audits: string; alerts: string; started: string }>(
    `SELECT
      (SELECT count(*) FROM spend_reservations WHERE tenant_id = $1) AS reservations,
      (SELECT count(*) FROM audit_events WHERE tenant_id = $1 AND event_type = 'spend_cap_reached') AS audits,
      (SELECT count(*) FROM alert_events WHERE tenant_id = $1 AND alert_type = 'spend_cap_reached') AS alerts,
      (SELECT count(*) FROM spend_reservations WHERE tenant_id = $1 AND provider_call_started_at IS NOT NULL) AS started`,
    [tenantId]
  );
  assert.deepEqual(afterRetry.rows[0], { reservations: '5', audits: '16', alerts: '16', started: '5' });

  scorecard = {
    status: 'pass',
    attemptedCalls,
    allowedCalls: allowed.length,
    deniedCalls: denied.length,
    exactCapMicrocents: cap.toString(),
    providerCalls,
    capStopAudits: Number(beforeRetry.rows[0]?.audit_count),
    capStopAlerts: Number(beforeRetry.rows[0]?.alert_count),
    duplicateRetry: duplicateRetry.reason,
    newActionRetry: newRetry.reason,
    dashboardSpend: spend
  };
} finally {
  await cleanupTenant(tenantId);
  await pool.end();
  await adminPool.end();
}

process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
