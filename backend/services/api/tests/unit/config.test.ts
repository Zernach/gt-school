import { loadConfig } from '../../src/config.js';

const baseEnvironment = { NODE_ENV: 'test' } as const;

describe('configuration defaults', () => {
  it('loads a complete secret-free local configuration', () => {
    const config = loadConfig(baseEnvironment);
    expect(config).toMatchObject({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      API_CONTAINER_PORT: 3000,
      WORKER_HEALTH_PORT: 3001,
      READINESS_SENTINEL_PATH: '',
      RUNTIME_DATABASE_USER: 'keystone_runtime',
      RUNTIME_DATABASE_PASSWORD: 'fixture-runtime-password-only',
      QUEUE_URL: 'redis://127.0.0.1:6379/0',
      QUEUE_STREAM: 'keystone_jobs_v1',
      QUEUE_CONSUMER_GROUP: 'keystone_workers_v1',
      QUEUE_CLAIM_IDLE_MS: 30_000,
      QUEUE_BLOCK_MS: 5000,
      DEMO_TENANT_ID: '00000000-0000-4000-8000-000000000001',
      DEMO_TENANT_SLUG: 'demo-school',
      DEMO_CLIENT_KEY: 'fixture-demo-client-key-only',
      DEMO_REVIEWER_KEY: 'fixture-demo-reviewer-key-only',
      SYNC_TRIGGER_SECRET: 'fixture-sync-trigger-secret-only',
      RECONCILE_TRIGGER_SECRET: 'fixture-reconcile-trigger-secret-only',
      STRETCH_TRIGGER_SECRET: 'fixture-stretch-trigger-secret-only',
      REQUEST_BODY_LIMIT_BYTES: 1_048_576,
      SOURCE_RECORD_LIMIT_BYTES: 262_144,
      SOURCE_TIMEOUT_MS: 5000,
      SOURCE_RETRY_LIMIT: 2,
      JOB_RETRY_LIMIT: 3,
      JOB_POLL_INTERVAL_MS: 10_000,
      DAILY_SPEND_CAP_MICROCENTS: 1_000_000,
      PER_RUN_SPEND_CAP_MICROCENTS: 500_000,
      PROVIDER_MODE: 'local',
      PROVIDER_MODEL: 'keystone-deterministic-v1',
      PRICE_TABLE_VERSION: 'prices-v1',
      CANONICAL_SEED: 424242,
      LOG_PRIVACY_MODE: 'redacted',
      LOG_RETENTION_DAYS: 30,
      OSCILLATION_HOLD_THRESHOLD: 3,
      RECONCILE_SCHEDULE_MS: 86_400_000
    });
  });

  it('uses absolute default roots', () => {
    const config = loadConfig(baseEnvironment);
    expect(config.FIXTURE_ROOT).toMatch(/^\//u);
    expect(config.MIGRATIONS_ROOT).toMatch(/^\//u);
    expect(config.CONFIG_ROOT).toMatch(/^\//u);
    expect(config.FIXTURE_ROOT).toContain('fixtures/generated');
    expect(config.MIGRATIONS_ROOT).toContain('backend/services/database/migrations');
    expect(config.CONFIG_ROOT).toMatch(/\/config$/u);
  });

  it('does not invent an external provider key', () => {
    expect(loadConfig(baseEnvironment).PROVIDER_API_KEY).toBeUndefined();
  });
});

describe('configuration coercion and overrides', () => {
  it.each([
    ['API_CONTAINER_PORT', '3100', 3100],
    ['WORKER_HEALTH_PORT', '3101', 3101],
    ['READINESS_SENTINEL_PATH', '/tmp/keystone.ready', '/tmp/keystone.ready'],
    ['QUEUE_CLAIM_IDLE_MS', '1250', 1250],
    ['QUEUE_BLOCK_MS', '25', 25],
    ['REQUEST_BODY_LIMIT_BYTES', '4096', 4096],
    ['SOURCE_RECORD_LIMIT_BYTES', '2048', 2048],
    ['SOURCE_TIMEOUT_MS', '250', 250],
    ['SOURCE_RETRY_LIMIT', '0', 0],
    ['JOB_RETRY_LIMIT', '7', 7],
    ['JOB_POLL_INTERVAL_MS', '500', 500],
    ['DAILY_SPEND_CAP_MICROCENTS', '900000', 900_000],
    ['PER_RUN_SPEND_CAP_MICROCENTS', '800', 800],
    ['CANONICAL_SEED', '0', 0],
    ['LOG_RETENTION_DAYS', '90', 90],
    ['OSCILLATION_HOLD_THRESHOLD', '4', 4],
    ['RECONCILE_SCHEDULE_MS', '0', 0]
  ] as const)('coerces %s from an environment string', (key, raw, expected) => {
    const config = loadConfig({ ...baseEnvironment, [key]: raw });
    expect(config[key]).toBe(expected);
  });

  it('accepts every supported runtime environment', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).NODE_ENV).toBe('development');
    expect(loadConfig({ NODE_ENV: 'test' }).NODE_ENV).toBe('test');
    expect(loadConfig({ NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });

  it('accepts explicit service and storage locations', () => {
    const config = loadConfig({
      ...baseEnvironment,
      HOST: '0.0.0.0',
      DATABASE_URL: 'postgresql://runtime:fixture@database:5432/keystone',
      DATABASE_ADMIN_URL: 'postgresql://owner:fixture@database:5432/keystone',
      QUEUE_URL: 'redis://queue:6379/1',
      FIXTURE_ROOT: '/fixtures',
      MIGRATIONS_ROOT: '/migrations',
      CONFIG_ROOT: '/config'
    });
    expect(config).toMatchObject({
      HOST: '0.0.0.0',
      DATABASE_URL: 'postgresql://runtime:fixture@database:5432/keystone',
      DATABASE_ADMIN_URL: 'postgresql://owner:fixture@database:5432/keystone',
      QUEUE_URL: 'redis://queue:6379/1',
      FIXTURE_ROOT: '/fixtures',
      MIGRATIONS_ROOT: '/migrations',
      CONFIG_ROOT: '/config'
    });
  });

  it('accepts explicit identifiers and fixture-only secrets', () => {
    const config = loadConfig({
      ...baseEnvironment,
      RUNTIME_DATABASE_USER: 'runtime_reader_2',
      RUNTIME_DATABASE_PASSWORD: 'a-long-fixture-password',
      QUEUE_STREAM: 'jobs_v2',
      QUEUE_CONSUMER_GROUP: 'workers_v2',
      DEMO_TENANT_ID: '11111111-1111-4111-8111-111111111111',
      DEMO_TENANT_SLUG: 'tenant-two',
      DEMO_CLIENT_KEY: 'fixture-client-two',
      DEMO_REVIEWER_KEY: 'fixture-reviewer-two',
      SYNC_TRIGGER_SECRET: 'fixture-sync-secret-two',
      RECONCILE_TRIGGER_SECRET: 'fixture-reconcile-two',
      STRETCH_TRIGGER_SECRET: 'fixture-stretch-secret-two'
    });
    expect(config.RUNTIME_DATABASE_USER).toBe('runtime_reader_2');
    expect(config.DEMO_TENANT_ID).toBe('11111111-1111-4111-8111-111111111111');
    expect(config.DEMO_TENANT_SLUG).toBe('tenant-two');
    expect(config.QUEUE_STREAM).toBe('jobs_v2');
    expect(config.QUEUE_CONSUMER_GROUP).toBe('workers_v2');
  });

  it('allows full logging only when explicitly configured', () => {
    expect(loadConfig({ ...baseEnvironment, LOG_PRIVACY_MODE: 'full' }).LOG_PRIVACY_MODE).toBe('full');
  });

  it('accepts external mode only with a sufficiently long key', () => {
    const config = loadConfig({
      ...baseEnvironment,
      PROVIDER_MODE: 'external',
      PROVIDER_API_KEY: 'fixture-provider-key-only',
      PROVIDER_MODEL: 'provider-model-fixture'
    });
    expect(config.PROVIDER_MODE).toBe('external');
    expect(config.PROVIDER_API_KEY).toBe('fixture-provider-key-only');
    expect(config.PROVIDER_MODEL).toBe('provider-model-fixture');
  });
});

describe('configuration rejection', () => {
  it.each([
    ['NODE_ENV', 'staging'],
    ['API_CONTAINER_PORT', '0'],
    ['API_CONTAINER_PORT', '-1'],
    ['API_CONTAINER_PORT', '1.5'],
    ['WORKER_HEALTH_PORT', 'NaN'],
    ['QUEUE_CLAIM_IDLE_MS', '0'],
    ['QUEUE_BLOCK_MS', '-10'],
    ['REQUEST_BODY_LIMIT_BYTES', '0'],
    ['SOURCE_RECORD_LIMIT_BYTES', '0'],
    ['SOURCE_TIMEOUT_MS', '0'],
    ['SOURCE_RETRY_LIMIT', '-1'],
    ['SOURCE_RETRY_LIMIT', '1.5'],
    ['JOB_RETRY_LIMIT', '0'],
    ['JOB_POLL_INTERVAL_MS', '0'],
    ['DAILY_SPEND_CAP_MICROCENTS', '-1'],
    ['PER_RUN_SPEND_CAP_MICROCENTS', '-1'],
    ['CANONICAL_SEED', '-1'],
    ['CANONICAL_SEED', '1.5'],
    ['LOG_RETENTION_DAYS', '0'],
    ['OSCILLATION_HOLD_THRESHOLD', '0'],
    ['RECONCILE_SCHEDULE_MS', '-1'],
    ['LOG_PRIVACY_MODE', 'unsafe'],
    ['PROVIDER_MODE', 'magic']
  ])('rejects invalid %s=%s', (key, value) => {
    expect(() => loadConfig({ ...baseEnvironment, [key]: value })).toThrow(`configuration_invalid: ${key}`);
  });

  it.each([
    ['RUNTIME_DATABASE_USER', 'Uppercase'],
    ['RUNTIME_DATABASE_USER', 'starts-with-dash'],
    ['RUNTIME_DATABASE_USER', '2starts_with_number'],
    ['RUNTIME_DATABASE_USER', 'contains space'],
    ['RUNTIME_DATABASE_USER', 'a'.repeat(64)],
    ['DEMO_TENANT_ID', 'not-a-uuid']
  ])('rejects malformed identifier %s', (key, value) => {
    expect(() => loadConfig({ ...baseEnvironment, [key]: value })).toThrow('configuration_invalid');
  });

  it.each([
    'RUNTIME_DATABASE_PASSWORD',
    'DEMO_CLIENT_KEY',
    'DEMO_REVIEWER_KEY',
    'SYNC_TRIGGER_SECRET',
    'RECONCILE_TRIGGER_SECRET',
    'STRETCH_TRIGGER_SECRET'
  ])('rejects a short %s', (key) => {
    expect(() => loadConfig({ ...baseEnvironment, [key]: 'too-short' })).toThrow(`configuration_invalid: ${key}`);
  });

  it.each([
    'DATABASE_URL',
    'QUEUE_URL',
    'QUEUE_STREAM',
    'QUEUE_CONSUMER_GROUP',
    'DEMO_TENANT_SLUG',
    'PROVIDER_MODEL',
    'PRICE_TABLE_VERSION',
    'FIXTURE_ROOT',
    'MIGRATIONS_ROOT',
    'CONFIG_ROOT'
  ])('rejects an empty %s', (key) => {
    expect(() => loadConfig({ ...baseEnvironment, [key]: '' })).toThrow(`configuration_invalid: ${key}`);
  });

  it('requires a provider key in external mode', () => {
    expect(() => loadConfig({ ...baseEnvironment, PROVIDER_MODE: 'external' })).toThrow('PROVIDER_API_KEY: required when PROVIDER_MODE=external');
  });

  it('rejects a short external provider key', () => {
    expect(() => loadConfig({ ...baseEnvironment, PROVIDER_MODE: 'external', PROVIDER_API_KEY: 'short' })).toThrow('PROVIDER_API_KEY');
  });

  it('rejects a per-run cap above the hard daily cap', () => {
    expect(() => loadConfig({ ...baseEnvironment, DAILY_SPEND_CAP_MICROCENTS: '99', PER_RUN_SPEND_CAP_MICROCENTS: '100' })).toThrow('PER_RUN_SPEND_CAP_MICROCENTS: must not exceed daily cap');
  });

  it('allows the per-run cap to equal the daily cap exactly', () => {
    const config = loadConfig({ ...baseEnvironment, DAILY_SPEND_CAP_MICROCENTS: '100', PER_RUN_SPEND_CAP_MICROCENTS: '100' });
    expect(config.PER_RUN_SPEND_CAP_MICROCENTS).toBe(config.DAILY_SPEND_CAP_MICROCENTS);
  });

  it('reports multiple invalid paths in a single actionable error', () => {
    expect(() => loadConfig({ ...baseEnvironment, API_CONTAINER_PORT: '0', LOG_RETENTION_DAYS: '-1' })).toThrow(/API_CONTAINER_PORT.*LOG_RETENTION_DAYS/u);
  });
});
