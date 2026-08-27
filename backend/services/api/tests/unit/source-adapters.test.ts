import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { stableStringify } from '../../src/domain/stable.js';
import type { DatabasePool } from '../../src/persistence/database.js';
import { AppPostgresAdapter } from '../../src/sources/app-postgres-adapter.js';
import type { ReadOnlySourceAdapter, SourceSnapshot } from '../../src/sources/adapter.js';
import { SourceAdapterError } from '../../src/sources/adapter.js';
import { FaultInjectingAdapter } from '../../src/sources/fault-adapter.js';
import { FileFixtureAdapter } from '../../src/sources/file-adapters.js';
import { cacheFixtureSetLoads, createSourceAdapters } from '../../src/sources/index.js';
import { makeContact, makeDeal, makeEnrollment, makePayment, makeStudent } from '../helpers/fixtures.js';

let fixtureRoot = '';

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'keystone-source-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function jsonl(path: string, values: readonly unknown[]): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${values.map((value) => stableStringify(value)).join('\n')}\n`, 'utf8');
}

async function minimumRoot(payments = [makePayment()]): Promise<void> {
  const student = makeStudent();
  await mkdir(join(fixtureRoot, 'base'), { recursive: true });
  await Promise.all([
    jsonl(join(fixtureRoot, 'base', 'crm_contacts.jsonl'), [makeContact(0, student)]),
    jsonl(join(fixtureRoot, 'base', 'crm_deals.jsonl'), [makeDeal()]),
    jsonl(join(fixtureRoot, 'base', 'app_students.jsonl'), [student]),
    jsonl(join(fixtureRoot, 'base', 'app_enrollments.jsonl'), [makeEnrollment(0, student)]),
    jsonl(join(fixtureRoot, 'base', 'payments.jsonl'), payments),
    writeFile(join(fixtureRoot, 'manifest.json'), '{}\n', 'utf8')
  ]);
}

function snapshot(records = 4): SourceSnapshot {
  return {
    sourceKind: 'crm',
    generation: 3,
    schemaVersion: 'test-schema',
    adapterVersion: 'test-adapter',
    records: Array.from({ length: records }, (_, index) => ({
      sourceKind: 'crm' as const,
      entityKind: 'contact',
      sourceId: `crm-${index}`,
      occurrence: 1,
      payload: { crm_id: `crm-${index}` },
      observedAt: '2026-01-15T12:00:00.000Z'
    })),
    rejectedCount: 0,
    complete: true,
    latencyMs: 2,
    diagnostics: []
  };
}

function fakeAdapter(overrides: Partial<ReadOnlySourceAdapter> = {}): ReadOnlySourceAdapter {
  return {
    sourceKind: 'crm',
    schemaVersion: 'test-schema',
    adapterVersion: 'test-adapter',
    health: vi.fn(async () => ({ sourceKind: 'crm' as const, ready: true, latencyMs: 1 })),
    readSnapshot: vi.fn(async () => snapshot()),
    ...overrides
  };
}

describe('read-only source adapter contract', () => {
  it('exposes only health and snapshot reads, with no mutation method', () => {
    const adapter = fakeAdapter();
    expect(Object.keys(adapter).sort()).toEqual(['adapterVersion', 'health', 'readSnapshot', 'schemaVersion', 'sourceKind']);
    expect('write' in adapter).toBe(false);
    expect('update' in adapter).toBe(false);
    expect('delete' in adapter).toBe(false);
  });

  it.each([
    ['source_timeout', 'timed out'],
    ['source_5xx', 'upstream unavailable'],
    ['source_partial', 'partial page'],
    ['source_invalid', 'bad source data']
  ] as const)('creates a structured %s source error', (code, message) => {
    const error = new SourceAdapterError(code, message);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SourceAdapterError');
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });
});

describe('file-backed CRM adapter', () => {
  it('reports ready only when the generated manifest is accessible', async () => {
    await minimumRoot();
    const health = await new FileFixtureAdapter('crm', fixtureRoot).health();
    expect(health.sourceKind).toBe('crm');
    expect(health.ready).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.detail).toBeUndefined();
  });

  it('reports degraded health instead of throwing for an absent root', async () => {
    const health = await new FileFixtureAdapter('crm', join(fixtureRoot, 'missing')).health();
    expect(health.sourceKind).toBe('crm');
    expect(health.ready).toBe(false);
    expect(health.detail).toMatch(/ENOENT/u);
  });

  it('reads contacts and deals into one complete CRM snapshot', async () => {
    await minimumRoot();
    const result = await new FileFixtureAdapter('crm', fixtureRoot).readSnapshot(1);
    expect(result).toMatchObject({
      sourceKind: 'crm',
      generation: 1,
      schemaVersion: 'fixtures-v1',
      adapterVersion: 'file-adapter-v1',
      rejectedCount: 0,
      complete: true,
      diagnostics: []
    });
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ sourceKind: 'crm', entityKind: 'contact', sourceId: 'crm-0', occurrence: 1 });
    expect(result.records[1]).toMatchObject({ sourceKind: 'crm', entityKind: 'deal', sourceId: 'deal-0', occurrence: 1 });
  });

  it('derives CRM observation time from updated_at', async () => {
    await minimumRoot();
    const result = await new FileFixtureAdapter('crm', fixtureRoot).readSnapshot(1);
    expect(result.records.every(({ observedAt }) => observedAt === '2026-01-15T12:00:00.000Z')).toBe(true);
  });

  it('honors a signal aborted before any fixture read', async () => {
    await minimumRoot();
    const controller = new AbortController();
    controller.abort(new Error('test-cancelled'));
    await expect(new FileFixtureAdapter('crm', fixtureRoot).readSnapshot(1, controller.signal)).rejects.toThrow('test-cancelled');
  });

  it('does not add a source mutation method at runtime', () => {
    const adapter = new FileFixtureAdapter('crm', fixtureRoot);
    expect('writeSnapshot' in adapter).toBe(false);
    expect('applyProposal' in adapter).toBe(false);
  });
});

describe('file-backed payments adapter', () => {
  it('reads payment fixtures and uses occurrence time', async () => {
    await minimumRoot();
    const result = await new FileFixtureAdapter('payments', fixtureRoot).readSnapshot(1);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      sourceKind: 'payments',
      entityKind: 'payment',
      sourceId: 'payment-record-0',
      occurrence: 1,
      observedAt: '2026-01-15T12:00:00.000Z'
    });
  });

  it('counts duplicate provider IDs without collapsing fixture records', async () => {
    const first = makePayment(1, makeStudent(1), { payment_id: 'same-provider-id', fixture_record_id: 'first-occurrence' });
    const second = makePayment(2, makeStudent(2), { payment_id: 'same-provider-id', fixture_record_id: 'second-occurrence' });
    await minimumRoot([first, second]);
    const result = await new FileFixtureAdapter('payments', fixtureRoot).readSnapshot(1);
    expect(result.records.map(({ sourceId, occurrence }) => ({ sourceId, occurrence }))).toEqual([
      { sourceId: 'first-occurrence', occurrence: 1 },
      { sourceId: 'second-occurrence', occurrence: 2 }
    ]);
  });

  it('starts occurrence counting independently for each provider ID', async () => {
    const first = makePayment(1, makeStudent(1), { payment_id: 'one', fixture_record_id: 'one-a' });
    const second = makePayment(2, makeStudent(2), { payment_id: 'two', fixture_record_id: 'two-a' });
    const third = makePayment(3, makeStudent(3), { payment_id: 'one', fixture_record_id: 'one-b' });
    await minimumRoot([first, second, third]);
    const result = await new FileFixtureAdapter('payments', fixtureRoot).readSnapshot(1);
    expect(result.records.map(({ occurrence }) => occurrence)).toEqual([1, 1, 2]);
  });

  it('reports payments manifest health under the payments source name', async () => {
    await minimumRoot();
    expect(await new FileFixtureAdapter('payments', fixtureRoot).health()).toMatchObject({ sourceKind: 'payments', ready: true });
  });
});

describe('Postgres app source adapter', () => {
  function poolWithRows(options: { students?: unknown[]; enrollments?: unknown[]; reject?: Error } = {}): DatabasePool {
    const query = vi.fn(async (sql: string) => {
      if (options.reject) throw options.reject;
      if (sql.includes('fixture_manifests')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('source_app.students')) return { rows: options.students ?? [] };
      if (sql.includes('source_app.enrollments')) return { rows: options.enrollments ?? [] };
      throw new Error(`unexpected_query:${sql}`);
    });
    return { query } as unknown as DatabasePool;
  }

  it('checks only the source manifest for health', async () => {
    const pool = poolWithRows();
    const health = await new AppPostgresAdapter(pool, 424242).health();
    expect(health).toMatchObject({ sourceKind: 'app', ready: true });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1 FROM source_app.fixture_manifests WHERE seed = $1', [424242]);
  });

  it('returns degraded health for a source database error', async () => {
    const health = await new AppPostgresAdapter(poolWithRows({ reject: new Error('source database unavailable') }), 424242).health();
    expect(health).toMatchObject({ sourceKind: 'app', ready: false, detail: 'source database unavailable' });
  });

  it('uses a generic diagnostic for a non-Error database rejection', async () => {
    const query = vi.fn(async () => Promise.reject('offline'));
    const pool = { query } as unknown as DatabasePool;
    expect(await new AppPostgresAdapter(pool, 1).health()).toMatchObject({ ready: false, detail: 'app_source_unavailable' });
  });

  it('reads students and enrollments concurrently from the requested generation', async () => {
    const observed = new Date('2026-01-15T12:00:00.000Z');
    const pool = poolWithRows({
      students: [{ source_id: makeStudent().id, payload: makeStudent(), observed_at: observed }],
      enrollments: [{ source_id: makeEnrollment().id, payload: makeEnrollment(), observed_at: observed }]
    });
    const result = await new AppPostgresAdapter(pool, 424242).readSnapshot(3);
    expect(result).toMatchObject({ sourceKind: 'app', generation: 3, schemaVersion: 'fixtures-v1', adapterVersion: 'app-postgres-readonly-v1', complete: true, rejectedCount: 0, diagnostics: [] });
    expect(result.records).toEqual([
      expect.objectContaining({ sourceKind: 'app', entityKind: 'student', sourceId: makeStudent().id, occurrence: 1, observedAt: observed.toISOString() }),
      expect.objectContaining({ sourceKind: 'app', entityKind: 'enrollment', sourceId: makeEnrollment().id, occurrence: 1, observedAt: observed.toISOString() })
    ]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('source_app.students'), [424242, 3]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('source_app.enrollments'), [424242, 3]);
  });

  it('returns a valid empty complete snapshot when the app tables are empty', async () => {
    const result = await new AppPostgresAdapter(poolWithRows(), 424242).readSnapshot(1);
    expect(result.records).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('honors an already-aborted signal before querying', async () => {
    const pool = poolWithRows();
    const controller = new AbortController();
    controller.abort(new Error('cancelled-before-query'));
    await expect(new AppPostgresAdapter(pool, 1).readSnapshot(1, controller.signal)).rejects.toThrow('cancelled-before-query');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('honors a signal aborted while source queries are in flight', async () => {
    const controller = new AbortController();
    const query = vi.fn(async () => {
      controller.abort(new Error('cancelled-after-query'));
      return { rows: [] };
    });
    const pool = { query } as unknown as DatabasePool;
    await expect(new AppPostgresAdapter(pool, 1).readSnapshot(1, controller.signal)).rejects.toThrow('cancelled-after-query');
  });
});

describe('fault-injecting adapter', () => {
  it('delegates health and reads in none mode', async () => {
    const inner = fakeAdapter();
    const adapter = new FaultInjectingAdapter(inner, 'none');
    expect(await adapter.health()).toEqual({ sourceKind: 'crm', ready: true, latencyMs: 1 });
    expect(await adapter.readSnapshot(3)).toEqual(snapshot());
    expect(inner.health).toHaveBeenCalledOnce();
    expect(inner.readSnapshot).toHaveBeenCalledWith(3, undefined);
  });

  it('preserves the source and schema while versioning the wrapper', () => {
    const adapter = new FaultInjectingAdapter(fakeAdapter(), 'partial');
    expect(adapter.sourceKind).toBe('crm');
    expect(adapter.schemaVersion).toBe('test-schema');
    expect(adapter.adapterVersion).toBe('test-adapter+fault-v1');
  });

  it('reports injected 5xx health without touching the inner source', async () => {
    const inner = fakeAdapter();
    const health = await new FaultInjectingAdapter(inner, '5xx').health();
    expect(health).toEqual({ sourceKind: 'crm', ready: false, latencyMs: 0, detail: 'injected_5xx' });
    expect(inner.health).not.toHaveBeenCalled();
  });

  it('fails a 5xx read with a structured retriable error', async () => {
    const inner = fakeAdapter();
    const error = await new FaultInjectingAdapter(inner, '5xx').readSnapshot(3).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SourceAdapterError);
    expect(error).toMatchObject({ code: 'source_5xx', message: 'injected source 5xx' });
    expect(inner.readSnapshot).not.toHaveBeenCalled();
  });

  it('turns an abort into a bounded source timeout', async () => {
    const controller = new AbortController();
    const promise = new FaultInjectingAdapter(fakeAdapter(), 'timeout').readSnapshot(3, controller.signal);
    controller.abort(new Error('outer deadline'));
    const error = await promise.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SourceAdapterError);
    expect(error).toMatchObject({ code: 'source_timeout', message: 'injected source timeout' });
  });

  it('returns exactly half of an even snapshot as explicitly partial', async () => {
    const inner = fakeAdapter({ readSnapshot: vi.fn(async () => snapshot(4)) });
    const result = await new FaultInjectingAdapter(inner, 'partial').readSnapshot(3);
    expect(result.records).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(result.rejectedCount).toBe(1);
    expect(result.diagnostics).toEqual([{ code: 'injected_partial', detail: 'fixture snapshot intentionally partial' }]);
  });

  it('rounds an odd partial snapshot down without returning zero', async () => {
    const inner = fakeAdapter({ readSnapshot: vi.fn(async () => snapshot(3)) });
    expect((await new FaultInjectingAdapter(inner, 'partial').readSnapshot(3)).records).toHaveLength(1);
  });

  it('preserves an empty underlying snapshot as empty but explicitly incomplete', async () => {
    const inner = fakeAdapter({ readSnapshot: vi.fn(async () => snapshot(0)) });
    const result = await new FaultInjectingAdapter(inner, 'partial').readSnapshot(3);
    expect(result.records).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it('does not mutate the complete snapshot returned by the inner adapter', async () => {
    const original = snapshot(4);
    const before = structuredClone(original);
    const inner = fakeAdapter({ readSnapshot: vi.fn(async () => original) });
    await new FaultInjectingAdapter(inner, 'partial').readSnapshot(3);
    expect(original).toEqual(before);
  });
});

describe('source adapter factory', () => {
  const pool = { query: vi.fn() } as unknown as DatabasePool;

  it('coalesces concurrent fixture loads for one generation and retries a rejected load', async () => {
    const fixture = {} as Awaited<ReturnType<Parameters<typeof cacheFixtureSetLoads>[0]>>;
    const load = vi.fn<(generation: number) => Promise<typeof fixture>>()
      .mockRejectedValueOnce(new Error('temporary fixture read failure'))
      .mockResolvedValue(fixture);
    const cached = cacheFixtureSetLoads(load);

    await expect(cached(3)).rejects.toThrow('temporary fixture read failure');
    const [first, second] = await Promise.all([cached(3), cached(3)]);

    expect(first).toBe(fixture);
    expect(second).toBe(fixture);
    expect(load).toHaveBeenCalledTimes(2);
    await cached(2);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('constructs exactly CRM, app, and payments in stable order', () => {
    const config = loadConfig({ NODE_ENV: 'test', FIXTURE_ROOT: '/fixtures' });
    const adapters = createSourceAdapters(pool, config);
    expect(adapters.map(({ sourceKind }) => sourceKind)).toEqual(['crm', 'app', 'payments']);
    expect(adapters[0]).toBeInstanceOf(FileFixtureAdapter);
    expect(adapters[1]).toBeInstanceOf(AppPostgresAdapter);
    expect(adapters[2]).toBeInstanceOf(FileFixtureAdapter);
  });

  it.each(['crm', 'app', 'payments'] as const)('wraps only the requested %s source for fault injection', (source) => {
    const config = loadConfig({ NODE_ENV: 'test', FIXTURE_ROOT: '/fixtures' });
    const adapters = createSourceAdapters(pool, config, { source, mode: 'partial' });
    expect(adapters.map((adapter) => adapter instanceof FaultInjectingAdapter)).toEqual([
      source === 'crm',
      source === 'app',
      source === 'payments'
    ]);
  });

  it('does not expose a mutation capability from any constructed adapter', () => {
    const adapters = createSourceAdapters(pool, loadConfig({ NODE_ENV: 'test', FIXTURE_ROOT: '/fixtures' }));
    for (const adapter of adapters) {
      expect('write' in adapter).toBe(false);
      expect('upsert' in adapter).toBe(false);
      expect('apply' in adapter).toBe(false);
    }
  });
});
