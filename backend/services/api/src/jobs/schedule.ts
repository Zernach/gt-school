import type { RedisClientType } from 'redis';
import type { AppConfig } from '../config.js';
import type { DatabasePool } from '../persistence/database.js';
import { createDurableJob, publishJob, type JobReference } from './service.js';

export function scheduledReconcileIdempotencyKey(now = new Date()): string {
  return `scheduled:reconcile:${now.toISOString().slice(0, 10)}`;
}

export function dueScheduledReconcile(lastEnqueueAt: number, now: number, intervalMs: number): boolean {
  return intervalMs > 0 && now - lastEnqueueAt >= intervalMs;
}

export async function enqueueScheduledReconcile(
  pool: DatabasePool,
  queue: RedisClientType,
  config: AppConfig,
  now = new Date()
): Promise<JobReference | undefined> {
  if (config.RECONCILE_SCHEDULE_MS <= 0) return undefined;
  const reference = await createDurableJob(pool, config, {
    tenantId: config.DEMO_TENANT_ID,
    jobType: 'reconcile',
    idempotencyKey: scheduledReconcileIdempotencyKey(now),
    payload: { generation: 3, scheduled: true }
  });
  if (!reference.duplicate && reference.status === 'queued') {
    try {
      await publishJob(pool, queue, config.QUEUE_STREAM, reference.id);
    } catch {
      // publishReadyJobs republishes queued jobs after a deferred publish.
    }
  }
  return reference;
}
