import type { AppConfig } from '../config.js';

export interface JobReference {
  id: string;
  status: string;
  duplicate: boolean;
}

export interface TerminalJob {
  id: string;
  status: 'complete' | 'failed' | 'halted';
  attempt_count: number;
  max_attempts: number;
  result: Record<string, unknown>;
  last_error: string | null;
}

interface Envelope<T> {
  data: T;
  requestId: string;
}

async function parseEnvelope<T>(response: Response): Promise<Envelope<T>> {
  const body = await response.text();
  if (!response.ok) throw new Error(`api_request_failed:${response.status}:${body.slice(0, 1000)}`);
  const parsed = JSON.parse(body) as Partial<Envelope<T>>;
  if (!parsed.data || typeof parsed.requestId !== 'string') throw new Error('api_response_invalid');
  return parsed as Envelope<T>;
}

export async function triggerAndWait(config: AppConfig, baseUrl: string, jobType: 'sync' | 'reconcile', idempotencyKey: string, generation = 3): Promise<{ reference: JobReference; job: TerminalJob }> {
  const secret = jobType === 'sync' ? config.SYNC_TRIGGER_SECRET : config.RECONCILE_TRIGGER_SECRET;
  const trigger = await fetch(`${baseUrl}/api/v1/jobs/${jobType}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-keystone-client-key': config.DEMO_REVIEWER_KEY,
      'x-keystone-trigger-secret': secret
    },
    body: JSON.stringify({ idempotencyKey, generation }),
    signal: AbortSignal.timeout(15_000)
  });
  const reference = (await parseEnvelope<JobReference>(trigger)).data;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/v1/runs/${reference.id}`, {
      headers: { 'x-keystone-client-key': config.DEMO_REVIEWER_KEY },
      signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    const job = (await parseEnvelope<TerminalJob>(response)).data;
    if (job.status === 'complete' || job.status === 'halted') return { reference, job };
    if (job.status === 'failed') throw new Error(`job_failed:${job.last_error ?? 'unknown'}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(config.JOB_POLL_INTERVAL_MS, 1000)));
  }
  throw new Error(`job_wait_timeout:${reference.id}`);
}
