import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { createClient, type RedisClientType } from 'redis';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { synchronize } from '../ingestion/sync.js';
import { publishReadyJobs } from '../jobs/service.js';
import { createPool, databaseReady, inTransaction } from '../persistence/database.js';
import { createProvider } from '../reconciliation/provider.js';
import { reconcileConflicts } from '../reconciliation/reconcile.js';
import { createSourceAdapters } from '../sources/index.js';

const jobPayloadSchema = z.object({
  generation: z.number().int().min(1).max(3).default(3),
  faultSource: z.enum(['crm', 'app', 'payments']).optional(),
  faultMode: z.enum(['none', 'timeout', '5xx', 'partial']).optional()
}).passthrough();

interface JobRow {
  id: string;
  tenant_id: string;
  job_type: 'sync' | 'reconcile';
  request_id: string;
  idempotency_key: string;
  payload: unknown;
  attempt_count: number;
  max_attempts: number;
}

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, 'keystone-worker');
const queue: RedisClientType = createClient({ url: config.QUEUE_URL });
const consumer = `${hostname()}-${process.pid}`;
let stopping = false;
let lastLoopAt = Date.now();

function log(event: string, detail: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ level: 'info', service: 'worker', event, ...detail, at: new Date().toISOString() })}\n`);
}

async function claimJob(jobId: string): Promise<JobRow | undefined> {
  return inTransaction(pool, async (client) => {
    const result = await client.query<JobRow>(`UPDATE jobs SET status = 'running', attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now()), last_error = NULL
      WHERE id = $1 AND (
        status IN ('published','queued','retry_wait')
        OR (status = 'running' AND started_at < now() - ($2::bigint * interval '1 millisecond'))
      ) RETURNING id, tenant_id, job_type, request_id, idempotency_key, payload, attempt_count, max_attempts`, [jobId, config.QUEUE_CLAIM_IDLE_MS]);
    return result.rows[0];
  });
}

async function executeJob(jobId: string): Promise<void> {
  const job = await claimJob(jobId);
  if (!job) return;
  try {
    const payload = jobPayloadSchema.parse(job.payload);
    let result: unknown;
    if (job.job_type === 'sync') {
      const fault = payload.faultSource && payload.faultMode ? { source: payload.faultSource, mode: payload.faultMode } : undefined;
      result = await synchronize(pool, createSourceAdapters(pool, config, fault), config, {
        tenantId: job.tenant_id,
        generation: payload.generation,
        idempotencyKey: `job:${job.id}`,
        requestId: job.request_id
      });
    } else {
      result = await reconcileConflicts(pool, config, createProvider(config), { tenantId: job.tenant_id, jobId: job.id, requestId: job.request_id });
    }
    const halted = typeof result === 'object' && result !== null && 'status' in result && result.status === 'halted';
    await pool.query(`UPDATE jobs SET status = $2, result = $3::jsonb, completed_at = now() WHERE id = $1`, [job.id, halted ? 'halted' : 'complete', JSON.stringify(result)]);
    log('job_completed', { jobId: job.id, jobType: job.job_type, halted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'job_failed';
    const terminal = job.attempt_count >= job.max_attempts;
    await pool.query(`UPDATE jobs SET status = $2, last_error = $3, next_attempt_at = now() + (LEAST(attempt_count, 5) * interval '2 seconds'), completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END WHERE id = $1`, [job.id, terminal ? 'failed' : 'retry_wait', message.slice(0, 1000)]);
    log('job_failed', { jobId: job.id, jobType: job.job_type, terminal, error: message });
  }
}

async function processMessages(messages: Array<{ id: string; message: Record<string, string> }>): Promise<void> {
  for (const message of messages) {
    const jobId = message.message.job_id;
    if (jobId) await executeJob(jobId);
    await queue.xAck(config.QUEUE_STREAM, config.QUEUE_CONSUMER_GROUP, message.id);
  }
}

async function consume(): Promise<void> {
  try {
    await queue.xGroupCreate(config.QUEUE_STREAM, config.QUEUE_CONSUMER_GROUP, '0', { MKSTREAM: true });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) throw error;
  }
  while (!stopping) {
    lastLoopAt = Date.now();
    await publishReadyJobs(pool, queue, config.QUEUE_STREAM);
    const claimed = await queue.xAutoClaim(config.QUEUE_STREAM, config.QUEUE_CONSUMER_GROUP, consumer, config.QUEUE_CLAIM_IDLE_MS, '0-0', { COUNT: 10 });
    const reclaimed = claimed.messages.filter((message): message is NonNullable<typeof message> => message !== null);
    if (reclaimed.length) await processMessages(reclaimed);
    const response = await queue.xReadGroup(config.QUEUE_CONSUMER_GROUP, consumer, [{ key: config.QUEUE_STREAM, id: '>' }], { COUNT: 5, BLOCK: config.QUEUE_BLOCK_MS });
    for (const stream of response ?? []) await processMessages(stream.messages);
  }
}

async function handleHealthRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.url !== '/health') {
    response.writeHead(404).end('not found');
    return;
  }
  const database = await databaseReady(pool);
  const redisReady = await queue.ping().then((result) => result === 'PONG').catch(() => false);
  const loopFresh = Date.now() - lastLoopAt < config.QUEUE_BLOCK_MS * 4;
  const ready = database.ready && redisReady && loopFresh;
  response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: ready ? 'ok' : 'degraded', database, queue: { ready: redisReady }, consumer: { ready: loopFresh } }));
}

const healthServer = createServer((request, response) => {
  void handleHealthRequest(request, response);
});

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log('shutdown_started', { signal });
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  if (queue.isOpen) await queue.quit();
  await pool.end();
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
queue.on('error', (error) => log('queue_error', { error: error.message }));
await queue.connect();
healthServer.listen(config.WORKER_HEALTH_PORT, config.HOST, () => log('health_listening', { port: config.WORKER_HEALTH_PORT }));
await consume();
