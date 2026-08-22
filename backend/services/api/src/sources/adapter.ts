import type { SourceKind } from '../domain/fixture-types.js';

export interface SourceRecord {
  sourceKind: SourceKind;
  entityKind: string;
  sourceId: string;
  occurrence: number;
  payload: Record<string, unknown>;
  observedAt: string;
}

export interface SourceSnapshot {
  sourceKind: SourceKind;
  generation: number;
  schemaVersion: string;
  adapterVersion: string;
  records: SourceRecord[];
  rejectedCount: number;
  complete: boolean;
  latencyMs: number;
  diagnostics: Array<{ code: string; detail: string }>;
}

export interface SourceHealth {
  sourceKind: SourceKind;
  ready: boolean;
  latencyMs: number;
  detail?: string;
}

export interface ReadOnlySourceAdapter {
  readonly sourceKind: SourceKind;
  readonly schemaVersion: string;
  readonly adapterVersion: string;
  health(): Promise<SourceHealth>;
  readSnapshot(generation: number, signal?: AbortSignal): Promise<SourceSnapshot>;
}

export class SourceAdapterError extends Error {
  constructor(readonly code: 'source_timeout' | 'source_5xx' | 'source_partial' | 'source_invalid', message: string) {
    super(message);
    this.name = 'SourceAdapterError';
  }
}
