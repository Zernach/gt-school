import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';
import type { AppConfig } from '../config.js';
import { stableUuid } from '../domain/stable.js';
import type { DatabasePool } from '../persistence/database.js';

export type JobType = 'sync' | 'reconcile' | 'stretch';

export interface CreateJobRequest {
  tenantId: string;
  jobType: JobType;
  idempotencyKey: string;
  requestId?: string;
  payload: Record<string, unknown>;
}

export interface JobReference {
  id: string;
  status: string;
  duplicate: boolean;
}

export async function createDurableJob(pool: DatabasePool, config: AppConfig, request: CreateJobRequest): Promise<JobReference> {
  const id = stableUuid(`job:${request.tenantId}:${request.jobType}:${request.idempotencyKey}`);
  const requestId = request.requestId ?? randomUUID();
  const inserted = await pool.query<{ id: string; status: string }>(`INSERT INTO jobs(id, tenant_id, job_type, idempotency_key, request_id, payload, status, max_attempts)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued', $7)
    ON CONFLICT (tenant_id, job_type, idempotency_key) DO NOTHING RETURNING id, status`, [id, request.tenantId, request.jobType, request.idempotencyKey, requestId, JSON.stringify(request.payload), config.JOB_RETRY_LIMIT]);
  if (inserted.rows[0]) return { ...inserted.rows[0], duplicate: false };
  const existing = await pool.query<{ id: string; status: string }>('SELECT id, status FROM jobs WHERE tenant_id = $1 AND job_type = $2 AND idempotency_key = $3', [request.tenantId, request.jobType, request.idempotencyKey]);
  if (!existing.rows[0]) throw new Error('job_upsert_failed');
  return { ...existing.rows[0], duplicate: true };
}

export async function publishJob(pool: DatabasePool, queue: RedisClientType, stream: string, jobId: string): Promise<string> {
  const streamId = await queue.xAdd(stream, '*', { job_id: jobId });
  await pool.query(`UPDATE jobs SET stream_id = $2, status = CASE WHEN status IN ('queued','retry_wait') THEN 'published' ELSE status END WHERE id = $1`, [jobId, streamId]);
  return streamId;
}

export async function publishReadyJobs(pool: DatabasePool, queue: RedisClientType, stream: string, limit = 100): Promise<number> {
  const jobs = await pool.query<{ id: string }>(`SELECT id FROM jobs WHERE status IN ('queued','retry_wait') AND next_attempt_at <= now() ORDER BY created_at LIMIT $1`, [limit]);
  for (const job of jobs.rows) await publishJob(pool, queue, stream, job.id);
  return jobs.rows.length;
}
