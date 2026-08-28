import { resolve } from 'node:path';
import { publicEntitySummary, reconcileDashboardFigures } from '../../src/domain/dashboard-reconciliation.js';
import { loadInvariantRegistry } from '../../src/domain/invariant-registry.js';
import { RULE_BY_TYPE, RULE_DEPENDENCIES, RULE_SET_VERSION } from '../../src/domain/invariants.js';

const committedConfigRoot = resolve(import.meta.dirname, '../../../../../config');

describe('committed invariant registry', () => {
  it('loads the versioned JSON and matches the runtime rule map', () => {
    const registry = loadInvariantRegistry(committedConfigRoot);
    expect(registry.version).toBe(RULE_SET_VERSION);
    expect(registry.rules).toHaveLength(14);
    expect(registry.rules.map(({ type }) => RULE_BY_TYPE[type])).toEqual(registry.rules.map(({ id }) => id));
    expect(registry.rules.every((rule) => RULE_DEPENDENCIES[rule.type].join(',') === rule.dependencies.join(','))).toBe(true);
  });
});

describe('dashboard figure reconciliation', () => {
  it('passes when ingestion, invariants, proposals, and spend agree', () => {
    expect(reconcileDashboardFigures({
      ingestedAccepted: 12_000,
      latestRunAccepted: 12_000,
      invariantFail: 305,
      conflictsActive: 305,
      proposalsPending: 305,
      spendActual: 6100,
      spendCap: 1_000_000
    })).toEqual({
      ok: true,
      checks: [
        { name: 'ingestion_matches_active_snapshots', actual: 12_000, expected: 12_000, ok: true },
        { name: 'conflicts_match_invariant_fail', actual: 305, expected: 305, ok: true },
        { name: 'pending_proposals_within_active_conflicts', actual: 305, expected: 305, ok: true },
        { name: 'spend_within_daily_cap', actual: 6100, expected: 1_000_000, ok: true }
      ]
    });
  });

  it('fails closed when a dashboard figure disagrees with the logs', () => {
    const result = reconcileDashboardFigures({
      ingestedAccepted: 65_000,
      latestRunAccepted: 12_000,
      invariantFail: 305,
      conflictsActive: 12,
      proposalsPending: 40,
      spendActual: 50,
      spendCap: 10
    });
    expect(result.ok).toBe(false);
    expect(result.checks.filter(({ ok }) => !ok).map(({ name }) => name)).toEqual([
      'ingestion_matches_active_snapshots',
      'conflicts_match_invariant_fail',
      'pending_proposals_within_active_conflicts',
      'spend_within_daily_cap'
    ]);
  });

  it('strips internal raw payloads from the public entity summary', () => {
    expect(publicEntitySummary({ registered: true, paid: true, raw: { app: { id: 'secret' } } })).toEqual({ registered: true, paid: true });
  });
});
