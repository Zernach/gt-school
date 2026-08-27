import type { OverviewData, SourceStatus } from '../types';
import { Accordion } from './Accordion';
import { dashboardStory } from './dashboardStory';
import { humanize, StatusBadge } from './StatusBadge';

function numeric(value: string | number | undefined | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function number(value: string | number | undefined | null): string {
  return numeric(value).toLocaleString('en-US');
}

function spendDollars(microcents: string): string {
  return `$${(numeric(microcents) / 100_000_000).toFixed(4)}`;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : date.toLocaleString('en-US');
}

function sourceLabel(source: SourceStatus['source_kind']): string {
  return source === 'crm' ? 'CRM' : source === 'payments' ? 'PAYMENTS' : 'APP';
}

function percentage(value: number, total: number): string {
  if (!total) return 'Not available';
  return `${((value / total) * 100).toFixed(1)}%`;
}

function proposalCount(proposals: OverviewData['proposals'], status: string): number {
  return numeric(proposals.find((proposal) => proposal.status === status)?.count);
}

export function Overview({ overview, defaultOpen = true }: { overview: OverviewData; defaultOpen?: boolean }) {
  const pending = proposalCount(overview.proposals, 'pending');
  const held = proposalCount(overview.proposals, 'held');
  const applied = proposalCount(overview.proposals, 'applied');
  const unchecked = numeric(overview.invariant?.summary.unchecked);
  const errors = numeric(overview.invariant?.summary.error);
  const passes = numeric(overview.invariant?.summary.pass);
  const fails = numeric(overview.invariant?.summary.fail);
  const evaluations = passes + fails + unchecked + errors;
  const checked = passes + fails;
  const reserved = numeric(overview.spend.reserved_microcents);
  const actual = numeric(overview.spend.actual_microcents);
  const cap = numeric(overview.spend.cap_microcents);
  const mismatched = overview.reconciliation?.checks.filter(({ ok }) => !ok) ?? [];
  const completeSources = overview.sources.filter((source) => source.status === 'complete').length;
  const acceptedRecords = overview.sources.reduce((total, source) => total + numeric(source.accepted_count), 0);
  const rejectedRecords = overview.sources.reduce((total, source) => total + numeric(source.rejected_count), 0);
  const latestGeneration = overview.latestRun?.requested_generation ?? Math.max(...overview.sources.map((source) => source.generation), 0);
  const latestRunSourceStatuses = Object.values(overview.latestRun?.source_availability ?? {});
  const latestRunSourcesComplete = latestRunSourceStatuses.length > 0 && latestRunSourceStatuses.every((status) => status === 'complete');
  const hasCompleteEvidence = Boolean(
    overview.sources.length > 0
      && completeSources === overview.sources.length
      && overview.latestRun?.status === 'complete'
      && latestRunSourcesComplete
      && overview.invariant?.status === 'complete'
      && unchecked === 0
      && errors === 0
      && overview.reconciliation?.ok
  );
  const hasIncompleteEvidence = !hasCompleteEvidence && (!overview.reconciliation || overview.sources.some((source) => source.status !== 'complete') || overview.latestRun?.status !== 'complete' || !latestRunSourcesComplete || overview.invariant?.status !== 'complete' || unchecked > 0 || errors > 0);
  const posture = overview.reconciliation && !overview.reconciliation.ok
    ? {
        status: 'failed',
        heading: 'Figures need investigation',
        description: 'The dashboard does not agree with its underlying logs. Treat counts as unverified until the mismatch is resolved.'
      }
    : !overview.sources.length || !overview.latestRun || !overview.invariant
      ? {
          status: 'unchecked',
          heading: 'Evidence baseline is not ready',
          description: 'There is not yet a complete source snapshot and invariant run to support review.'
        }
      : hasIncompleteEvidence
        ? {
            status: 'partial',
            heading: 'Evidence is incomplete',
            description: 'Some source or rule results are unavailable. Missing evidence is not treated as a clean result.'
          }
        : {
            status: 'complete',
            heading: pending ? 'Ready for guarded review' : 'Evidence is aligned',
            description: pending ? 'The evidence reconciles, and pending proposals still require an explicit reviewer decision.' : 'Sources, invariant results, and proposal counts reconcile for this view.'
          };
  const windowLabel = overview.evidenceWindow?.from
    ? `Conflicts and proposals last seen from ${dateTime(overview.evidenceWindow.from)}`
    : 'All active conflicts and proposals';
  const actionLabel = pending > 0 ? `Review ${number(pending)} pending proposal${pending === 1 ? '' : 's'}` : overview.conflicts.active !== '0' ? 'Inspect active conflicts' : 'Open conflict evidence';

  return (
    <Accordion
      id="trust-overview-accordion"
      title={dashboardStory.overview.title}
      headingId="overview-heading"
      descriptionId="overview-description"
      defaultOpen={defaultOpen}
      className="overview-section"
      heading={
        <div className="section-heading overview-heading">
          <div>
            <p className="eyebrow">{dashboardStory.overview.step}</p>
            <h2 id="overview-heading">{dashboardStory.overview.title}</h2>
            <p id="overview-description" className="section-description">{dashboardStory.overview.description}</p>
          </div>
          <div className="overview-status">
            {overview.latestRun ? <StatusBadge status={overview.latestRun.status} label={`Sync ${overview.latestRun.status}`} /> : <StatusBadge status="unchecked" label="Not synced" />}
            <span className="muted">Generation {latestGeneration || 'not recorded'}</span>
          </div>
        </div>
      }
    >
      <div className="overview-content">

      <div className="window-context" aria-label="Evidence window scope">
        <div className="window-context-main">
          <span className="card-label">Scope</span>
          <strong>{windowLabel}</strong>
          <p>Use this scope when comparing conflict and proposal counts. Source freshness and the latest invariant run are shown as supporting context.</p>
        </div>
        <dl className="window-facts">
          <div><dt>Latest sync</dt><dd>{dateTime(overview.latestRun?.completed_at)}</dd></div>
          <div><dt>Source snapshots</dt><dd>{completeSources} of {overview.sources.length || 0} complete</dd></div>
        </dl>
      </div>

      {overview.latestAlert ? <div className="warning-banner" role="status"><span aria-hidden="true">△</span><div><strong>{overview.latestAlert.severity === 'critical' ? 'Critical alert' : 'Alert'}</strong><p>{overview.latestAlert.message || humanize(overview.latestAlert.alert_type)}</p><small>Created {dateTime(overview.latestAlert.created_at)}</small></div></div> : null}
      {overview.reconciliation && !overview.reconciliation.ok
        ? <div className="warning-banner" role="alert"><span aria-hidden="true">△</span><div><strong>Dashboard figures do not match logs</strong><p>{mismatched.map(({ name, actual: value, expected }) => `${name.replaceAll('_', ' ')}: ${value} vs ${expected}`).join('; ')}</p><small>Pause reviewer decisions until the accounting is understood.</small></div></div>
        : null}

      <div className="overview-guidance">
        <article className={`guidance-card guidance-${posture.status}`}>
          <div className="guidance-card-heading"><p className="eyebrow">Trust posture</p><StatusBadge status={posture.status} label={posture.heading} /></div>
          <h3>{posture.heading}</h3>
          <p>{posture.description}</p>
          <dl className="guidance-facts">
            <div><dt>Figures</dt><dd>{overview.reconciliation ? overview.reconciliation.ok ? 'Reconciled' : 'Needs investigation' : 'Not recorded'}</dd></div>
            <div><dt>Rule coverage</dt><dd>{evaluations ? `${percentage(checked, evaluations)} checked` : 'No run recorded'}</dd></div>
            <div><dt>Source writes</dt><dd>Zero</dd></div>
          </dl>
        </article>
        <article className="guidance-card guidance-action">
          <p className="eyebrow">Next best action</p>
          <h3>{pending ? 'Review before approving' : 'Start with conflict evidence'}</h3>
          <p>{pending ? `${number(pending)} proposals are pending. Open the evidence, inspect lineage, then choose approve, reject, or hold with a reason.` : 'Open a conflict to see the exact rule, source lineage, audit history, and any linked support ticket.'}</p>
          <a className="primary-button" href="#conflicts-heading">{actionLabel}</a>
        </article>
      </div>

      <div className="metric-grid" aria-label="Evidence summary">
        <article className="metric-card"><span>Active conflicts</span><strong>{number(overview.conflicts.active)}</strong><small>{pending ? `${number(pending)} proposals awaiting review · ${number(overview.conflicts.resolved)} resolved` : `${number(overview.conflicts.resolved)} resolved`}</small></article>
        <article className="metric-card"><span>Evidence coverage</span><strong>{evaluations ? percentage(checked, evaluations) : '—'}</strong><small>Latest run · {number(checked)} of {number(evaluations)} checked{fails ? ` · ${number(fails)} failures` : ''}{unchecked ? ` · ${number(unchecked)} unavailable` : ''}</small></article>
        <article className="metric-card"><span>Sources active</span><strong>{completeSources}/{overview.sources.length || 0}</strong><small>{number(acceptedRecords)} accepted · {number(rejectedRecords)} rejected</small></article>
        <article className="metric-card"><span>Pending review</span><strong>{number(pending)}</strong><small>{number(held)} held · source writes: zero</small></article>
        <article className="metric-card"><span>Daily spend</span><strong>{spendDollars(overview.spend.actual_microcents)}</strong><small>{cap ? `${percentage(actual, cap)} of ${spendDollars(overview.spend.cap_microcents)} cap` : 'No cap recorded'}{reserved > actual ? ` · ${spendDollars(overview.spend.reserved_microcents)} reserved` : ''}</small></article>
        <article className="metric-card"><span>Auto-applied</span><strong>{number(applied)}</strong><small>{applied ? 'reversible Keystone ledger' : 'no automatic changes recorded'}</small></article>
        <article className="metric-card"><span>Incident groups</span><strong>{number(overview.stretch?.incidentGroups)}</strong><small>{number(overview.stretch?.extractedTickets)} extracted tickets</small></article>
      </div>

      <p className="muted privacy-note">Safety: {overview.privacy?.mode ?? 'redacted'} logs · retain {overview.privacy?.retentionDays ?? 30} days · {overview.privacy?.audit ?? 'append-only hashed metadata'}.</p>
      <div id="source-freshness" className="source-strip" aria-label="Source freshness">
        {overview.sources.length ? overview.sources.map((source) => (
          <article key={source.source_kind} className={`source-card source-${source.status}`}>
            <div><strong>{sourceLabel(source.source_kind)}</strong><StatusBadge status={source.status} /></div>
            <span>{number(source.accepted_count)} records · generation {source.generation}</span>
            <small>{number(source.rejected_count)} rejected</small>
            <time dateTime={source.activated_at}>Activated {dateTime(source.activated_at)}</time>
          </article>
        )) : <p className="empty-inline">No complete source snapshot is active yet.</p>}
      </div>
      </div>
    </Accordion>
  );
}
