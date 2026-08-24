import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('Pages deployment contract', () => {
  test('declares the backend service binding and generated Pages binding types', async () => {
    const [config, types] = await Promise.all([
      readFile(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8'),
      readFile(resolve(process.cwd(), 'functions/worker-configuration.d.ts'), 'utf8')
    ]);
    expect(config).toContain('"KEYSTONE_DEMO_API"');
    expect(config).toContain('"gt-school-demo-api"');
    expect(types).toContain('KEYSTONE_DEMO_API');
  });

  test('invokes a Function only for API requests and excludes static assets', async () => {
    const routes = await readFile(resolve(process.cwd(), 'public/_routes.json'), 'utf8');
    expect(routes).toContain('"/api/*"');
    expect(routes).toContain('"/assets/*"');
    expect(routes).toContain('"/favicon.ico"');
  });
});
