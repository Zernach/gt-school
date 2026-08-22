import type { ReadOnlySourceAdapter, SourceHealth, SourceSnapshot } from './adapter.js';
import { SourceAdapterError } from './adapter.js';

export type FaultMode = 'none' | 'timeout' | '5xx' | 'partial';

export class FaultInjectingAdapter implements ReadOnlySourceAdapter {
  get sourceKind() { return this.inner.sourceKind; }
  get schemaVersion() { return this.inner.schemaVersion; }
  get adapterVersion() { return `${this.inner.adapterVersion}+fault-v1`; }

  constructor(private readonly inner: ReadOnlySourceAdapter, private readonly mode: FaultMode) {}

  health(): Promise<SourceHealth> {
    if (this.mode === '5xx') return Promise.resolve({ sourceKind: this.sourceKind, ready: false, latencyMs: 0, detail: 'injected_5xx' });
    return this.inner.health();
  }

  async readSnapshot(generation: number, signal?: AbortSignal): Promise<SourceSnapshot> {
    if (this.mode === 'timeout') {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 60_000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new SourceAdapterError('source_timeout', 'injected source timeout'));
        }, { once: true });
      });
      throw new SourceAdapterError('source_timeout', 'injected source timeout');
    }
    if (this.mode === '5xx') throw new SourceAdapterError('source_5xx', 'injected source 5xx');
    const snapshot = await this.inner.readSnapshot(generation, signal);
    if (this.mode === 'partial') return { ...snapshot, records: snapshot.records.slice(0, Math.max(1, Math.floor(snapshot.records.length / 2))), complete: false, rejectedCount: 1, diagnostics: [{ code: 'injected_partial', detail: 'fixture snapshot intentionally partial' }] };
    return snapshot;
  }
}
