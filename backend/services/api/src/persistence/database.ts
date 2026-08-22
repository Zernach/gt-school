import pg from 'pg';

const { Pool } = pg;
export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;

export function createPool(connectionString: string, applicationName: string): DatabasePool {
  return new Pool({
    connectionString,
    application_name: applicationName,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true
  });
}

export async function inTransaction<T>(pool: DatabasePool, work: (client: DatabaseClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseReady(pool: DatabasePool): Promise<{ ready: boolean; latencyMs: number; error?: string }> {
  const started = performance.now();
  try {
    await pool.query('SELECT 1');
    return { ready: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { ready: false, latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : 'database_unavailable' };
  }
}
