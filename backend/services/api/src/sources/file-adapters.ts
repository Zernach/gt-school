import { access } from 'node:fs/promises';
import type { FixtureSet, SourceKind } from '../domain/fixture-types.js';
import { loadFixtureSet } from '../fixtures/reader.js';
import type { ReadOnlySourceAdapter, SourceHealth, SourceRecord, SourceSnapshot } from './adapter.js';

export type FixtureSetLoader = (generation: number) => Promise<FixtureSet>;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('source_aborted');
}

function observedAt(payload: Record<string, unknown>): string {
  const value = payload.updated_at ?? payload.occurred_at ?? payload.created_at;
  return typeof value === 'string' ? value : new Date(0).toISOString();
}

export class FileFixtureAdapter implements ReadOnlySourceAdapter {
  readonly schemaVersion = 'fixtures-v1';
  readonly adapterVersion = 'file-adapter-v1';

  constructor(
    readonly sourceKind: Extract<SourceKind, 'crm' | 'payments'>,
    private readonly fixtureRoot: string,
    private readonly loadFixtures: FixtureSetLoader = (generation) => loadFixtureSet(fixtureRoot, generation)
  ) {}

  async health(): Promise<SourceHealth> {
    const started = performance.now();
    try {
      await access(`${this.fixtureRoot}/manifest.json`);
      return { sourceKind: this.sourceKind, ready: true, latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      return { sourceKind: this.sourceKind, ready: false, latencyMs: Math.round(performance.now() - started), detail: error instanceof Error ? error.message : 'fixture_unavailable' };
    }
  }

  async readSnapshot(generation: number, signal?: AbortSignal): Promise<SourceSnapshot> {
    const started = performance.now();
    throwIfAborted(signal);
    const fixtures = await this.loadFixtures(generation);
    throwIfAborted(signal);
    const records: SourceRecord[] = [];
    if (this.sourceKind === 'crm') {
      for (const contact of fixtures.crmContacts) records.push({ sourceKind: 'crm', entityKind: 'contact', sourceId: contact.crm_id, occurrence: 1, payload: contact, observedAt: observedAt(contact) });
      for (const deal of fixtures.crmDeals) records.push({ sourceKind: 'crm', entityKind: 'deal', sourceId: deal.deal_id, occurrence: 1, payload: deal, observedAt: observedAt(deal) });
    } else {
      const occurrences = new Map<string, number>();
      for (const payment of fixtures.payments) {
        const occurrence = (occurrences.get(payment.payment_id) ?? 0) + 1;
        occurrences.set(payment.payment_id, occurrence);
        records.push({ sourceKind: 'payments', entityKind: 'payment', sourceId: payment.fixture_record_id, occurrence, payload: payment, observedAt: payment.occurred_at });
      }
    }
    return { sourceKind: this.sourceKind, generation, schemaVersion: this.schemaVersion, adapterVersion: this.adapterVersion, records, rejectedCount: 0, complete: true, latencyMs: Math.round(performance.now() - started), diagnostics: [] };
  }
}
