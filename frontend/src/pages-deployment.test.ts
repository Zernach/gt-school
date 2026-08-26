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
    expect(routes).toContain('"/favicon.svg"');
  });

  test('ships the GT School browser-tab favicon as a static ICO plus matching fallbacks', async () => {
    const [html, ico, png, svg] = await Promise.all([
      readFile(resolve(process.cwd(), 'index.html'), 'utf8'),
      readFile(resolve(process.cwd(), 'public/favicon.ico')),
      readFile(resolve(process.cwd(), 'public/favicon.png')),
      readFile(resolve(process.cwd(), 'public/favicon.svg'), 'utf8')
    ]);
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('href="/favicon.svg"');
    expect(ico.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    expect(ico.byteLength).toBeGreaterThan(64);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(svg).toContain('href="/favicon.png"');
    expect(svg).toContain('aria-label="GT School"');
  });
});
