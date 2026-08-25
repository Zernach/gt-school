import { createClient, type RedisClientType } from 'redis';
import { loadConfig } from './config.js';
import { loadInvariantRegistry } from './domain/invariant-registry.js';
import { buildApp } from './http/app.js';
import { createPool } from './persistence/database.js';
import { createSourceAdapters } from './sources/index.js';

const config = loadConfig();
loadInvariantRegistry(config.CONFIG_ROOT);
const pool = createPool(config.DATABASE_URL, 'keystone-api');
const queue: RedisClientType = createClient({ url: config.QUEUE_URL });
queue.on('error', (error) => process.stderr.write(`${JSON.stringify({ level: 'error', service: 'api', event: 'queue_error', error: error.message })}\n`));
await queue.connect();
const app = await buildApp({ config, pool, queue, adapters: createSourceAdapters(pool, config) });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutdown_started');
  await app.close();
  if (queue.isOpen) await queue.quit();
  await pool.end();
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
await app.listen({ host: config.HOST, port: config.API_CONTAINER_PORT });
