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
  const unchecked = overview.invariant?.summary.unchecked ?? 0;
  return (
    <section aria-labelledby="overview-heading" className="overview-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Current evidence window</p>
          <h2 id="overview-heading">Trust overview</h2>
        </div>
        {overview.latestRun ? <StatusBadge status={overview.latestRun.status} label={`Sync ${overview.latestRun.status}`} /> : <StatusBadge status="unchecked" label="Not synced" />}
      </div>
      <div className="metric-grid">
        <article className="metric-card"><span>Active conflicts</span><strong>{number(overview.conflicts.active)}</strong><small>deterministic failures</small></article>
        <article className="metric-card"><span>Pending review</span><strong>{number(pending)}</strong><small>source writes: zero</small></article>
        <article className="metric-card"><span>Unchecked rules</span><strong>{number(unchecked)}</strong><small>never counted as pass</small></article>
        <article className="metric-card"><span>Daily spend</span><strong>{spendDollars(overview.spend.actual_microcents)}</strong><small>cap {spendDollars(overview.spend.cap_microcents)}</small></article>
      </div>
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
