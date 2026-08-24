import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedisClientType } from 'redis';
import { describe, expect, test, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/http/app.js';
import type { DatabasePool } from '../../src/persistence/database.js';

function dependencies(readinessSentinelPath = '') {
  const pool = { query: vi.fn(async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 })) } as unknown as DatabasePool;
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
});
