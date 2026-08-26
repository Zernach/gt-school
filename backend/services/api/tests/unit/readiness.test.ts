import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedisClientType } from 'redis';
import { describe, expect, test, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/http/app.js';
import type { DatabasePool } from '../../src/persistence/database.js';

function dependencies(readinessSentinelPath = '') {
  const pool = { query: vi.fn(async (statement: string) => ({
    rows: statement.includes('FROM tenants')
      ? [{ id: '00000000-0000-4000-8000-000000000001', slug: 'demo-school', role: 'reviewer' }]
      : [{ '?column?': 1 }],
    rowCount: 1
  })) } as unknown as DatabasePool;
  const queue = { ping: vi.fn(async () => 'PONG') } as unknown as RedisClientType;
  const adapters = (['crm', 'app', 'payments'] as const).map((sourceKind) => ({
    sourceKind,
    schemaVersion: 'fixtures-v1',
    adapterVersion: 'test',
    health: vi.fn(async () => ({ sourceKind, ready: true, latencyMs: 1 })),
    readSnapshot: vi.fn()
  }));
  return {
    config: loadConfig({ NODE_ENV: 'test', READINESS_SENTINEL_PATH: readinessSentinelPath }),
    pool,
    queue,
    adapters
  };
}

describe('public readiness', () => {
  test('keeps /health dependency-only while /ready requires a configured bootstrap sentinel', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keystone-ready-'));
    const sentinel = join(directory, 'bootstrapped');
    const app = await buildApp(dependencies(sentinel));
    try {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      const notReady = await app.inject({ method: 'GET', url: '/ready' });
      expect(notReady.statusCode).toBe(503);
      expect(notReady.json()).toMatchObject({ data: { bootstrap: { ready: false } } });

      await writeFile(sentinel, 'ready\n', 'utf8');
      const ready = await app.inject({ method: 'GET', url: '/ready' });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toMatchObject({ data: { status: 'ok', bootstrap: { ready: true } } });
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('refuses dashboard evidence while bootstrap is incomplete without blocking bootstrap job polling', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keystone-ready-'));
    const sentinel = join(directory, 'bootstrapped');
    const dependenciesWithSentinel = dependencies(sentinel);
    const app = await buildApp(dependenciesWithSentinel);
    const headers = { 'x-keystone-client-key': 'fixture-demo-reviewer-key-only' };
    try {
      const overview = await app.inject({ method: 'GET', url: '/api/v1/overview', headers });
      expect(overview.statusCode).toBe(503);
      expect(overview.json()).toMatchObject({
        error: { code: 'bootstrap_in_progress', message: 'The transient demo data is being restored.' }
      });

      const run = await app.inject({ method: 'GET', url: '/api/v1/runs/00000000-0000-4000-8000-000000000002', headers });
      expect(run.statusCode).not.toBe(503);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
