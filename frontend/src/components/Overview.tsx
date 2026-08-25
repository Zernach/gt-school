import type { OverviewData } from '../types';
import { StatusBadge } from './StatusBadge';

function number(value: string | number | undefined): string {
  return Number(value ?? 0).toLocaleString('en-US');
}

function spendDollars(microcents: string): string {
  return `$${(Number(microcents) / 100_000_000).toFixed(4)}`;
}

export function Overview({ overview }: { overview: OverviewData }) {
  const pending = overview.proposals.find(({ status }) => status === 'pending')?.count ?? 0;
  const applied = overview.proposals.find(({ status }) => status === 'applied')?.count ?? 0;
  const unchecked = overview.invariant?.summary.unchecked ?? 0;
  const reserved = Number(overview.spend.reserved_microcents);
  const actual = Number(overview.spend.actual_microcents);
  const mismatched = overview.reconciliation?.checks.filter(({ ok }) => !ok) ?? [];
  return (
    <section aria-labelledby="overview-heading" className="overview-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Current evidence window</p>
          <h2 id="overview-heading">Trust overview</h2>
          {overview.evidenceWindow?.from ? <p className="muted">From {new Date(overview.evidenceWindow.from).toLocaleString()}</p> : null}
        </div>
        {overview.latestRun ? <StatusBadge status={overview.latestRun.status} label={`Sync ${overview.latestRun.status}`} /> : <StatusBadge status="unchecked" label="Not synced" />}
      </div>
      {overview.latestAlert ? <div className="warning-banner" role="status"><span aria-hidden="true">△</span><div><strong>{overview.latestAlert.severity === 'critical' ? 'Critical alert' : 'Alert'}</strong><p>{overview.latestAlert.message || overview.latestAlert.alert_type.replaceAll('_', ' ')}</p></div></div> : null}
      {overview.reconciliation && !overview.reconciliation.ok
        ? <div className="warning-banner" role="alert"><span aria-hidden="true">△</span><div><strong>Dashboard figures do not match logs</strong><p>{mismatched.map(({ name, actual: value, expected }) => `${name.replaceAll('_', ' ')}: ${value} vs ${expected}`).join('; ')}</p></div></div>
        : overview.reconciliation?.ok
          ? <p className="reconciliation-ok"><StatusBadge status="complete" label="Figures match ingestion, invariant, and proposal logs" /></p>
          : null}
      <div className="metric-grid">
        <article className="metric-card"><span>Active conflicts</span><strong>{number(overview.conflicts.active)}</strong><small>deterministic failures</small></article>
        <article className="metric-card"><span>Pending review</span><strong>{number(pending)}</strong><small>source writes: zero</small></article>
        <article className="metric-card"><span>Unchecked rules</span><strong>{number(unchecked)}</strong><small>never counted as pass</small></article>
        <article className="metric-card"><span>Daily spend</span><strong>{spendDollars(overview.spend.actual_microcents)}</strong><small>cap {spendDollars(overview.spend.cap_microcents)}{reserved > actual ? ` · reserved ${spendDollars(overview.spend.reserved_microcents)}` : ''}</small></article>
        <article className="metric-card"><span>Auto-applied</span><strong>{number(applied)}</strong><small>reversible Keystone ledger</small></article>
        <article className="metric-card"><span>Incident groups</span><strong>{number(overview.stretch?.incidentGroups)}</strong><small>{number(overview.stretch?.extractedTickets)} extracted tickets</small></article>
      </div>
      <p className="muted privacy-note">Logs: {overview.privacy?.mode ?? 'redacted'} · retain {overview.privacy?.retentionDays ?? 30} days · {overview.privacy?.audit ?? 'append-only hashed metadata'}</p>
      <div className="source-strip" aria-label="Source freshness">
        {overview.sources.length ? overview.sources.map((source) => (
          <article key={source.source_kind} className="source-card">
            <div><strong>{source.source_kind.toLocaleUpperCase('en-US')}</strong><StatusBadge status={source.status} /></div>
            <span>{number(source.accepted_count)} records · generation {source.generation}</span>
            <time dateTime={source.activated_at}>{new Date(source.activated_at).toLocaleString()}</time>
          </article>
        )) : <p className="empty-inline">No complete source snapshot is active yet.</p>}
      </div>
    </section>
  );
}
