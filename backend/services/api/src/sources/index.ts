import type { AppConfig } from '../config.js';
import type { SourceKind } from '../domain/fixture-types.js';
import { loadFixtureSet } from '../fixtures/reader.js';
import type { DatabasePool } from '../persistence/database.js';
import type { FaultMode } from './fault-adapter.js';
import type { ReadOnlySourceAdapter } from './adapter.js';
import { AppPostgresAdapter } from './app-postgres-adapter.js';
import { FaultInjectingAdapter } from './fault-adapter.js';
import { FileFixtureAdapter, type FixtureSetLoader } from './file-adapters.js';

export function cacheFixtureSetLoads(load: FixtureSetLoader): FixtureSetLoader {
  const cache = new Map<number, Promise<Awaited<ReturnType<FixtureSetLoader>>>>();
  return (generation) => {
    const existing = cache.get(generation);
    if (existing) return existing;
    const next = load(generation);
    cache.set(generation, next);
    void next.catch(() => {
      if (cache.get(generation) === next) cache.delete(generation);
    });
    return next;
  };
}

export function createSourceAdapters(
  pool: DatabasePool,
  config: AppConfig,
  fault?: { source: SourceKind; mode: FaultMode }
): ReadOnlySourceAdapter[] {
  const loadFixtures = cacheFixtureSetLoads((generation) => loadFixtureSet(config.FIXTURE_ROOT, generation));
  const adapters: ReadOnlySourceAdapter[] = [
    new FileFixtureAdapter('crm', config.FIXTURE_ROOT, loadFixtures),
    new AppPostgresAdapter(pool, config.CANONICAL_SEED),
    new FileFixtureAdapter('payments', config.FIXTURE_ROOT, loadFixtures)
  ];
  return adapters.map((adapter) => fault?.source === adapter.sourceKind ? new FaultInjectingAdapter(adapter, fault.mode) : adapter);
}
