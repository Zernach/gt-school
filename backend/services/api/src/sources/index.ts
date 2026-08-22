import type { AppConfig } from '../config.js';
import type { SourceKind } from '../domain/fixture-types.js';
import type { DatabasePool } from '../persistence/database.js';
import type { FaultMode } from './fault-adapter.js';
import type { ReadOnlySourceAdapter } from './adapter.js';
import { AppPostgresAdapter } from './app-postgres-adapter.js';
import { FaultInjectingAdapter } from './fault-adapter.js';
import { FileFixtureAdapter } from './file-adapters.js';

export function createSourceAdapters(
  pool: DatabasePool,
  config: AppConfig,
  fault?: { source: SourceKind; mode: FaultMode }
): ReadOnlySourceAdapter[] {
  const adapters: ReadOnlySourceAdapter[] = [
    new FileFixtureAdapter('crm', config.FIXTURE_ROOT),
    new AppPostgresAdapter(pool, config.CANONICAL_SEED),
    new FileFixtureAdapter('payments', config.FIXTURE_ROOT)
  ];
  return adapters.map((adapter) => fault?.source === adapter.sourceKind ? new FaultInjectingAdapter(adapter, fault.mode) : adapter);
}
