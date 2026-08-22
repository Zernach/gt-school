import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DatabasePool } from './database.js';
import { inTransaction } from './database.js';
import { sha256 } from '../domain/stable.js';

export async function runMigrations(pool: DatabasePool, migrationsRoot: string): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationsRoot)).filter((file) => /^\d+.*\.sql$/u.test(file)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const version = basename(file, '.sql');
    const sql = await readFile(join(migrationsRoot, file), 'utf8');
    const checksum = sha256(sql);
    const existing = await pool.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE version = $1', [version]);
    if (existing.rowCount) {
      if (existing.rows[0]?.checksum !== checksum) throw new Error(`applied_migration_checksum_mismatch:${version}`);
      continue;
    }
    await inTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [version, checksum]);
    });
    applied.push(version);
  }
  return applied;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(identifier)) throw new Error('database_role_identifier_invalid');
  return `"${identifier}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function provisionRuntimeRole(pool: DatabasePool, role: string, password: string): Promise<void> {
  const identifier = quoteIdentifier(role);
  await pool.query(`DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(role)}) THEN CREATE ROLE ${identifier} LOGIN; END IF; END $role$`);
  await pool.query(`ALTER ROLE ${identifier} PASSWORD ${quoteLiteral(password)}`);
  await pool.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier((await pool.query<{ current_database: string }>('SELECT current_database()')).rows[0]?.current_database ?? 'keystone')} TO ${identifier}`);
  await pool.query('REVOKE CREATE ON SCHEMA public, source_app FROM PUBLIC');
  await pool.query(`GRANT USAGE ON SCHEMA public, source_app TO ${identifier}`);
  await pool.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ${identifier}`);
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${identifier}`);
  await pool.query(`GRANT INSERT, UPDATE ON sync_runs, source_runs, source_snapshots, active_snapshots,
    canonical_entities, households, invariant_runs, conflicts, proposals, spend_buckets, spend_runs,
    spend_reservations, jobs TO ${identifier}`);
  await pool.query(`GRANT INSERT ON source_records, field_observations, entity_links, household_memberships,
    invariant_results, proposal_decisions, fixture_rejections, audit_events, alert_events TO ${identifier}`);
  await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier}`);
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA source_app TO ${identifier}`);
  await pool.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA source_app FROM ${identifier}`);
}
