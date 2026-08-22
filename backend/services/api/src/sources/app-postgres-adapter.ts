import type { DatabasePool } from '../persistence/database.js';
import type { ReadOnlySourceAdapter, SourceHealth, SourceRecord, SourceSnapshot } from './adapter.js';

interface FixtureRow {
  source_id: string;
  payload: Record<string, unknown>;
  observed_at: Date;
}

export class AppPostgresAdapter implements ReadOnlySourceAdapter {
  readonly sourceKind = 'app' as const;
  readonly schemaVersion = 'fixtures-v1';
  readonly adapterVersion = 'app-postgres-readonly-v1';

  constructor(private readonly pool: DatabasePool, private readonly seed: number) {}

  async health(): Promise<SourceHealth> {
    const started = performance.now();
    try {
      await this.pool.query('SELECT 1 FROM source_app.fixture_manifests WHERE seed = $1', [this.seed]);
      return { sourceKind: 'app', ready: true, latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      return { sourceKind: 'app', ready: false, latencyMs: Math.round(performance.now() - started), detail: error instanceof Error ? error.message : 'app_source_unavailable' };
    }
  }

  async readSnapshot(generation: number, signal?: AbortSignal): Promise<SourceSnapshot> {
    const started = performance.now();
    if (signal?.aborted) throw signal.reason;
    const [students, enrollments] = await Promise.all([
      this.pool.query<FixtureRow>('SELECT source_id, payload, observed_at FROM source_app.students WHERE seed = $1 AND generation = $2 ORDER BY source_id', [this.seed, generation]),
      this.pool.query<FixtureRow>('SELECT source_id, payload, observed_at FROM source_app.enrollments WHERE seed = $1 AND generation = $2 ORDER BY source_id', [this.seed, generation])
    ]);
    if (signal?.aborted) throw signal.reason;
    const records: SourceRecord[] = [
      ...students.rows.map((row) => ({ sourceKind: 'app' as const, entityKind: 'student', sourceId: row.source_id, occurrence: 1, payload: row.payload, observedAt: row.observed_at.toISOString() })),
      ...enrollments.rows.map((row) => ({ sourceKind: 'app' as const, entityKind: 'enrollment', sourceId: row.source_id, occurrence: 1, payload: row.payload, observedAt: row.observed_at.toISOString() }))
    ];
    return { sourceKind: 'app', generation, schemaVersion: this.schemaVersion, adapterVersion: this.adapterVersion, records, rejectedCount: 0, complete: true, latencyMs: Math.round(performance.now() - started), diagnostics: [] };
  }
}
