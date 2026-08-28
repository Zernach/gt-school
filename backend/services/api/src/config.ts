import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const localEnvironment = [
  resolve(process.cwd(), 'backend/docker/.env'),
  resolve(import.meta.dirname, '../../../docker/.env')
].find((candidate) => existsSync(candidate));
if (localEnvironment) loadDotenv({ path: localEnvironment, quiet: true });

const positiveInteger = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const nonnegativeInteger = (fallback: number) => z.coerce.number().int().nonnegative().default(fallback);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  API_CONTAINER_PORT: positiveInteger(3000),
  WORKER_HEALTH_PORT: positiveInteger(3001),
  READINESS_SENTINEL_PATH: z.string().default(''),
  DATABASE_URL: z.string().min(1).default('postgresql://keystone_runtime:fixture-runtime-password-only@127.0.0.1:5432/keystone'),
  DATABASE_ADMIN_URL: z.string().min(1).optional(),
  RUNTIME_DATABASE_USER: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/u).default('keystone_runtime'),
  RUNTIME_DATABASE_PASSWORD: z.string().min(12).default('fixture-runtime-password-only'),
  QUEUE_URL: z.string().min(1).default('redis://127.0.0.1:6379/0'),
  QUEUE_STREAM: z.string().min(1).default('keystone_jobs_v1'),
  QUEUE_CONSUMER_GROUP: z.string().min(1).default('keystone_workers_v1'),
  QUEUE_CLAIM_IDLE_MS: positiveInteger(30_000),
  QUEUE_BLOCK_MS: positiveInteger(5000),
  DEMO_TENANT_ID: z.string().uuid().default('00000000-0000-4000-8000-000000000002'),
  DEMO_TENANT_SLUG: z.string().min(1).default('demo-school-10pct'),
  DEMO_CLIENT_KEY: z.string().min(16).default('fixture-demo-client-key-only'),
  DEMO_REVIEWER_KEY: z.string().min(16).default('fixture-demo-reviewer-key-only'),
  SYNC_TRIGGER_SECRET: z.string().min(16).default('fixture-sync-trigger-secret-only'),
  RECONCILE_TRIGGER_SECRET: z.string().min(16).default('fixture-reconcile-trigger-secret-only'),
  STRETCH_TRIGGER_SECRET: z.string().min(16).default('fixture-stretch-trigger-secret-only'),
  REQUEST_BODY_LIMIT_BYTES: positiveInteger(1_048_576),
  SOURCE_RECORD_LIMIT_BYTES: positiveInteger(262_144),
  SOURCE_TIMEOUT_MS: positiveInteger(5000),
  SOURCE_RETRY_LIMIT: nonnegativeInteger(2),
  JOB_RETRY_LIMIT: positiveInteger(3),
  JOB_POLL_INTERVAL_MS: positiveInteger(10_000),
  DAILY_SPEND_CAP_MICROCENTS: nonnegativeInteger(1_000_000),
  PER_RUN_SPEND_CAP_MICROCENTS: nonnegativeInteger(500_000),
  PROVIDER_MODE: z.enum(['local', 'external']).default('local'),
  PROVIDER_MODEL: z.string().min(1).default('keystone-deterministic-v1'),
  PROVIDER_API_KEY: z.string().min(16).optional(),
  PRICE_TABLE_VERSION: z.string().min(1).default('prices-v1'),
  CANONICAL_SEED: nonnegativeInteger(424242),
  FIXTURE_ROOT: z.string().min(1).default(resolve(process.cwd(), 'fixtures/generated')),
  MIGRATIONS_ROOT: z.string().min(1).default(resolve(process.cwd(), 'backend/services/database/migrations')),
  CONFIG_ROOT: z.string().min(1).default(resolve(process.cwd(), 'config')),
  LOG_PRIVACY_MODE: z.enum(['redacted', 'full']).default('redacted'),
  LOG_RETENTION_DAYS: positiveInteger(30),
  OSCILLATION_HOLD_THRESHOLD: positiveInteger(3),
  RECONCILE_SCHEDULE_MS: nonnegativeInteger(86_400_000)
}).superRefine((value, context) => {
  if (value.PROVIDER_MODE === 'external' && !value.PROVIDER_API_KEY) {
    context.addIssue({ code: 'custom', path: ['PROVIDER_API_KEY'], message: 'required when PROVIDER_MODE=external' });
  }
  if (value.PER_RUN_SPEND_CAP_MICROCENTS > value.DAILY_SPEND_CAP_MICROCENTS) {
    context.addIssue({ code: 'custom', path: ['PER_RUN_SPEND_CAP_MICROCENTS'], message: 'must not exceed daily cap' });
  }
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const paths = parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`).join('; ');
    throw new Error(`configuration_invalid: ${paths}`);
  }
  return parsed.data;
}
