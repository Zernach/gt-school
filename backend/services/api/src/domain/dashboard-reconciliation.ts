export interface DashboardFigures {
  ingestedAccepted: number;
  latestRunAccepted: number;
  invariantFail: number;
  conflictsActive: number;
  proposalsPending: number;
  spendActual: number;
  spendCap: number;
}

export interface ReconciliationCheck {
  name: string;
  actual: number;
  expected: number;
  ok: boolean;
}

export interface DashboardReconciliation {
  ok: boolean;
  checks: ReconciliationCheck[];
}

export function reconcileDashboardFigures(figures: DashboardFigures): DashboardReconciliation {
  const checks: ReconciliationCheck[] = [
    {
      name: 'ingestion_matches_active_snapshots',
      actual: figures.ingestedAccepted,
      expected: figures.latestRunAccepted,
      ok: figures.ingestedAccepted === figures.latestRunAccepted
    },
    {
      name: 'conflicts_match_invariant_fail',
      actual: figures.conflictsActive,
      expected: figures.invariantFail,
      ok: figures.conflictsActive === figures.invariantFail
    },
    {
      name: 'pending_proposals_within_active_conflicts',
      actual: figures.proposalsPending,
      expected: figures.conflictsActive,
      ok: figures.proposalsPending <= figures.conflictsActive
    },
    {
      name: 'spend_within_daily_cap',
      actual: figures.spendActual,
      expected: figures.spendCap,
      ok: figures.spendActual <= figures.spendCap
    }
  ];
  return { ok: checks.every(({ ok }) => ok), checks };
}

export function publicEntitySummary(summary: Record<string, unknown>): Record<string, unknown> {
  const { raw: _raw, ...rest } = summary;
  void _raw;
  return rest;
}
