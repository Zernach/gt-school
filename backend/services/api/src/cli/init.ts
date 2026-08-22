import { loadConfig } from '../config.js';
import { sha256 } from '../domain/stable.js';
import { createPool } from '../persistence/database.js';
import { loadAppSourceFixtures } from '../persistence/fixture-loader.js';
import { provisionRuntimeRole, runMigrations } from '../persistence/migrations.js';

const config = loadConfig();
if (!config.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL is required for initialization');
const pool = createPool(config.DATABASE_ADMIN_URL, 'keystone-init');
try {
  const migrations = await runMigrations(pool, config.MIGRATIONS_ROOT);
  await loadAppSourceFixtures(pool, config.FIXTURE_ROOT, config.CANONICAL_SEED);
  await pool.query(`INSERT INTO tenants(id, slug, client_key_hash, reviewer_key_hash)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, client_key_hash = EXCLUDED.client_key_hash, reviewer_key_hash = EXCLUDED.reviewer_key_hash`, [
    config.DEMO_TENANT_ID,
    config.DEMO_TENANT_SLUG,
    sha256(config.DEMO_CLIENT_KEY),
    sha256(config.DEMO_REVIEWER_KEY)
  ]);
  await provisionRuntimeRole(pool, config.RUNTIME_DATABASE_USER, config.RUNTIME_DATABASE_PASSWORD);
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'initialization_complete', migrations, seed: config.CANONICAL_SEED })}\n`);
} finally {
  await pool.end();
}
