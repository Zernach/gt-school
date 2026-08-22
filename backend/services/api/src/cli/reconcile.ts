import { loadConfig } from '../config.js';
import { triggerAndWait } from './job-client.js';

const config = loadConfig();
const apiPort = process.env.API_PORT ?? String(config.API_CONTAINER_PORT);
const baseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const keyIndex = process.argv.indexOf('--idempotency-key');
const idempotencyKey = keyIndex === -1 ? `manual-reconcile-${new Date().toISOString().slice(0, 10)}` : process.argv[keyIndex + 1];
if (!idempotencyKey) throw new Error('--idempotency-key requires a value');
const completed = await triggerAndWait(config, baseUrl, 'reconcile', idempotencyKey);
process.stdout.write(`${JSON.stringify({
  status: completed.job.status === 'complete' ? 'pass' : completed.job.status,
  reference: completed.reference,
  attempts: completed.job.attempt_count,
  scorecard: completed.job.result
}, null, 2)}\n`);
if (completed.job.status !== 'complete') process.exitCode = 1;
