import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { loadConfig } from '../config.js';
import { createDurableJob, publishJob } from '../jobs/service.js';
import { createPool } from '../persistence/database.js';

type JobState = {
  status: string;
  attempt_count: number;
  last_error: string | null;
};

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, 'keystone-worker-recovery');
const queue: RedisClientType = createClient({ url: config.QUEUE_URL });
queue.on('error', (error) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'worker_recovery_queue_error', error: error.message })}\n`);
});

async function ensureConsumerGroup(): Promise<void> {
  try {
    await queue.xGroupCreate(config.QUEUE_STREAM, config.QUEUE_CONSUMER_GROUP, '0', { MKSTREAM: true });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) throw error;
  }
}

async function prepare(): Promise<Record<string, unknown>> {
  await ensureConsumerGroup();
  const reference = await createDurableJob(pool, config, {
    tenantId: config.DEMO_TENANT_ID,
    jobType: 'reconcile',
    idempotencyKey: `worker-recovery-${randomUUID()}`,
    requestId: randomUUID(),
    payload: {}
  });
  assert.equal(reference.duplicate, false);
  const firstStreamId = await publishJob(pool, queue, config.QUEUE_STREAM, reference.id);
  const secondStreamId = await publishJob(pool, queue, config.QUEUE_STREAM, reference.id);

  const abandonedConsumer = `abandoned-recovery-${process.pid}`;
  const response = await queue.xReadGroup(
    config.QUEUE_CONSUMER_GROUP,
    abandonedConsumer,
    [{ key: config.QUEUE_STREAM, id: '>' }],
    { COUNT: 1 }
  );
  const abandonedStreamId = response?.[0]?.messages[0]?.id;
  assert.equal(abandonedStreamId, firstStreamId, 'the first duplicate delivery must be left pending');
  await queue.sendCommand([
    'XCLAIM',
    config.QUEUE_STREAM,
    config.QUEUE_CONSUMER_GROUP,
    abandonedConsumer,
    '0',
    firstStreamId,
    'IDLE',
    String(config.QUEUE_CLAIM_IDLE_MS + 1000),
    'JUSTID'
  ]);
  return { status: 'prepared', jobId: reference.id, firstStreamId, secondStreamId };
}

async function pendingIds(): Promise<Set<string>> {
  const response = await queue.sendCommand([
    'XPENDING',
    config.QUEUE_STREAM,
    config.QUEUE_CONSUMER_GROUP,
    '-',
    '+',
    '100'
  ]);
  if (!Array.isArray(response)) return new Set();
  return new Set(response.flatMap((entry) => Array.isArray(entry) && typeof entry[0] === 'string' ? [entry[0]] : []));
}

async function verify(jobId: string, firstStreamId: string, secondStreamId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  let job: JobState | undefined;
  let pending = new Set([firstStreamId, secondStreamId]);
  while (Date.now() < deadline) {
    const result = await pool.query<JobState>('SELECT status, attempt_count, last_error FROM jobs WHERE id = $1', [jobId]);
    job = result.rows[0];
    pending = await pendingIds();
    if (job?.status === 'complete' && !pending.has(firstStreamId) && !pending.has(secondStreamId)) break;
    if (job?.status === 'failed') throw new Error(`worker_recovery_job_failed:${job.last_error ?? 'unknown'}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(job?.status, 'complete', 'the durable job must complete after restart');
  assert.equal(job?.attempt_count, 1, 'duplicate deliveries must not execute the durable job twice');
  assert.equal(job?.last_error, null);
  assert.equal(pending.has(firstStreamId), false, 'the reclaimed delivery must be acknowledged');
  assert.equal(pending.has(secondStreamId), false, 'the duplicate delivery must be acknowledged');
  return {
    status: 'pass',
    jobId,
    attempts: job.attempt_count,
    reclaimedDeliveryAcknowledged: true,
    duplicateDeliveryAcknowledged: true
  };
}

try {
  await queue.connect();
  const [command, jobId, firstStreamId, secondStreamId] = process.argv.slice(2);
  const scorecard = command === 'prepare'
    ? await prepare()
    : command === 'verify' && jobId && firstStreamId && secondStreamId
      ? await verify(jobId, firstStreamId, secondStreamId)
      : (() => { throw new Error('usage: worker-recovery prepare | verify <job-id> <first-stream-id> <second-stream-id>'); })();
  process.stdout.write(`${JSON.stringify(scorecard)}\n`);
} finally {
  if (queue.isOpen) await queue.quit();
  await pool.end();
}
