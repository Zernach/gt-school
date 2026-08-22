import { loadConfig } from '../config.js';

const config = loadConfig();
const apiPort = process.env.API_PORT ?? String(config.API_CONTAINER_PORT);
const baseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const headers = { 'x-keystone-client-key': config.DEMO_CLIENT_KEY };
const runs = 20;

async function fetchChecked(path: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) throw new Error(`benchmark_request_failed:${path}:${response.status}`);
  await response.arrayBuffer();
}

async function measure(operation: () => Promise<void>): Promise<number[]> {
  const timings: number[] = [];
  for (let iteration = 0; iteration < runs; iteration += 1) {
    const started = performance.now();
    await operation();
    timings.push(performance.now() - started);
  }
  return timings.sort((left, right) => left - right);
}

function summarize(timings: readonly number[], targetMs: number): Record<string, number | boolean> {
  const p50Ms = Number(timings[Math.floor(timings.length * 0.5)]?.toFixed(2));
  const p95Ms = Number(timings[Math.ceil(timings.length * 0.95) - 1]?.toFixed(2));
  return {
    runs: timings.length,
    p50Ms,
    p95Ms,
    maximumMs: Number(timings.at(-1)?.toFixed(2)),
    targetMs,
    pass: p95Ms < targetMs
  };
}

const entityId = 'entity:0338d5d7-d346-49ae-b8ad-02157e262e26';
const crossSourceEntity = await measure(() => fetchChecked(`/api/v1/entities/${entityId}`));
const dashboardRoutes = ['/api/v1/overview', '/api/v1/conflicts?limit=50', '/api/v1/proposals?status=pending&limit=50'];
const dashboardBundle = await measure(async () => { await Promise.all(dashboardRoutes.map((path) => fetchChecked(path))); });
const summary = {
  crossSourceEntity: summarize(crossSourceEntity, 1000),
  dashboardApiBundle: summarize(dashboardBundle, 1000)
};

process.stdout.write(`${JSON.stringify({
  status: Object.values(summary).every(({ pass }) => pass) ? 'pass' : 'fail',
  seed: config.CANONICAL_SEED,
  measuredAt: new Date().toISOString(),
  entityId,
  dashboardRoutes,
  summary
}, null, 2)}\n`);
