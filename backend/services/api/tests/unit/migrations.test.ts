import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../../src/domain/stable.js';
import type { DatabasePool } from '../../src/persistence/database.js';
import { provisionRuntimeRole, runMigrations } from '../../src/persistence/migrations.js';

let migrationsRoot: string;

beforeEach(async () => {
  migrationsRoot = await mkdtemp(join(tmpdir(), 'keystone-migrations-'));
});

afterEach(async () => {
  await rm(migrationsRoot, { recursive: true, force: true });
});

function fakePool(poolQuery: ReturnType<typeof vi.fn>, clientQuery: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })) {
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release });
  return { pool: { query: poolQuery, connect } as unknown as DatabasePool, connect, clientQuery, release };
}

describe('checksum-verified forward migrations', () => {
  it('filters, sorts, applies, and records numbered SQL files transactionally', async () => {
    await writeFile(join(migrationsRoot, '010_second.sql'), 'SELECT 10;\n');
    await writeFile(join(migrationsRoot, '002_first.sql'), 'SELECT 2;\n');
    await writeFile(join(migrationsRoot, 'README.md'), 'not a migration');
    const poolQuery = vi.fn(async (sql: string) => sql.includes('SELECT checksum') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 });
    const harness = fakePool(poolQuery);
    await expect(runMigrations(harness.pool, migrationsRoot)).resolves.toEqual(['002_first', '010_second']);
    expect(harness.connect).toHaveBeenCalledTimes(2);
    expect(harness.clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SELECT 2;\n',
      'INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)',
      'COMMIT',
      'BEGIN',
      'SELECT 10;\n',
      'INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)',
      'COMMIT'
    ]);
    expect(harness.clientQuery.mock.calls[2]?.[1]).toEqual(['002_first', sha256('SELECT 2;\n')]);
  });

  it('skips an already-applied migration only when its checksum matches', async () => {
    const sql = 'SELECT 1;\n';
    await writeFile(join(migrationsRoot, '001_existing.sql'), sql);
    const poolQuery = vi.fn(async (query: string) => query.includes('SELECT checksum')
      ? { rows: [{ checksum: sha256(sql) }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    const harness = fakePool(poolQuery);
    await expect(runMigrations(harness.pool, migrationsRoot)).resolves.toEqual([]);
    expect(harness.connect).not.toHaveBeenCalled();
  });

  it('aborts on an applied migration checksum mismatch', async () => {
    await writeFile(join(migrationsRoot, '001_existing.sql'), 'SELECT 1;\n');
    const poolQuery = vi.fn(async (query: string) => query.includes('SELECT checksum')
      ? { rows: [{ checksum: 'different-checksum' }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    const harness = fakePool(poolQuery);
    await expect(runMigrations(harness.pool, migrationsRoot)).rejects.toThrow('applied_migration_checksum_mismatch:001_existing');
    expect(harness.connect).not.toHaveBeenCalled();
  });

  it('rolls back a failing migration without recording it', async () => {
    await writeFile(join(migrationsRoot, '001_broken.sql'), 'BROKEN SQL;\n');
    const poolQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql === 'BROKEN SQL;\n') throw new Error('syntax error');
      return { rows: [], rowCount: 0 };
    });
    const harness = fakePool(poolQuery, clientQuery);
    await expect(runMigrations(harness.pool, migrationsRoot)).rejects.toThrow('syntax error');
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'BROKEN SQL;\n', 'ROLLBACK']);
    expect(harness.release).toHaveBeenCalledOnce();
  });
});

describe('least-privilege runtime role provisioning', () => {
  it('rejects an unsafe role identifier before issuing SQL', async () => {
    const query = vi.fn();
    await expect(provisionRuntimeRole({ query } as unknown as DatabasePool, 'runtime;DROP ROLE owner', 'fixture-password-long')).rejects.toThrow('database_role_identifier_invalid');
    expect(query).not.toHaveBeenCalled();
  });

  it('escapes password literals and quotes role/database identifiers', async () => {
    const query = vi.fn(async (sql: string) => sql === 'SELECT current_database()'
      ? { rows: [{ current_database: 'keystone' }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    await provisionRuntimeRole({ query } as unknown as DatabasePool, 'keystone_runtime', "fixture-password-'quoted'");
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain('ALTER ROLE "keystone_runtime" PASSWORD \'fixture-password-\'\'quoted\'\'\'');
    expect(statements).toContain('GRANT CONNECT ON DATABASE "keystone" TO "keystone_runtime"');
  });

  it('revokes broad writes before granting only explicit Keystone table mutations', async () => {
    const query = vi.fn(async (sql: string) => sql === 'SELECT current_database()'
      ? { rows: [{ current_database: 'keystone' }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    await provisionRuntimeRole({ query } as unknown as DatabasePool, 'keystone_runtime', 'fixture-password-long');
    const statements = query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(statements).toContain('REVOKE CREATE ON SCHEMA public, source_app FROM PUBLIC');
    expect(statements).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public');
    expect(statements).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA public');
    expect(statements).toContain('GRANT INSERT, UPDATE ON sync_runs, source_runs, source_snapshots, active_snapshots');
    expect(statements).toContain('GRANT INSERT ON source_records, field_observations, entity_links, household_memberships');
    expect(statements).not.toContain('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public');
  });

  it('keeps every source_app mutation privilege revoked', async () => {
    const query = vi.fn(async (sql: string) => sql === 'SELECT current_database()'
      ? { rows: [], rowCount: 0 }
      : { rows: [], rowCount: 0 });
    await provisionRuntimeRole({ query } as unknown as DatabasePool, 'keystone_runtime', 'fixture-password-long');
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA source_app TO "keystone_runtime"');
    expect(statements).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA source_app FROM "keystone_runtime"');
    expect(statements).toContain('GRANT CONNECT ON DATABASE "keystone" TO "keystone_runtime"');
  });
});
