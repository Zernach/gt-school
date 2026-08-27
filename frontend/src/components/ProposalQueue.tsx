import type { Proposal } from '../types';
import { Accordion } from './Accordion';
import { dashboardStory } from './dashboardStory';
import { humanize, StatusBadge } from './StatusBadge';

const TYPES = ['paid_but_no_deal','payment_with_no_person','duplicate_by_email','cross_source_email_mismatch','required_source_missing','material_field_disagreement','enrolled_but_unpaid','dropped_sibling','stale_crm_pointer','merge_collapsed_record','duplicate_payment','wrong_amount_payment','refund_not_reflected','sensitive_field_only_fix'];
const SOURCE_LABELS: Record<string, string> = { app: 'App DB', crm: 'CRM', payments: 'Payments' };

function confidencePercent(value: number): string {
  return `${(value / 100).toFixed(0)}%`;
}

function signalValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Confirmed' : 'Not confirmed';
  if (value === null || value === undefined) return 'Unavailable';
  return typeof value === 'string' ? value : JSON.stringify(value) ?? 'Unavailable';
}

function signalLabel(value: string): string {
  return humanize(value.replace(/([a-z])([A-Z])/gu, '$1_$2'));
}

function sourceLabel(value: string): string {
  return SOURCE_LABELS[value] ?? humanize(value);
}

function nextStep(proposal: Proposal): { title: string; description: string } {
  if (proposal.status === 'pending' && proposal.sensitive_hold) {
    return {
      title: 'Blocked by a sensitive-field hold',
      description: `Review ${proposal.sensitive_fields.join(', ') || 'the flagged sensitive field'} in the full evidence view before deciding.`
    };
  }
  if (proposal.status === 'pending') {
    return {
      title: 'Your decision is needed',
      description: 'Open the full evidence, verify the proposed action, then approve, reject, or hold it with a reason.'
    };
  }
  if (proposal.status === 'applied') {
    return {
      title: 'Review the applied result',
      description: 'This was applied inside Keystone only. Open the evidence if you need to inspect or roll it back.'
    };
  }
  if (proposal.status === 'held') {
    return {
      title: 'Waiting for more evidence',
      description: 'Keep this proposal held until the unresolved evidence is clarified or a new run changes the recommendation.'
    };
  }
  if (proposal.status === 'approved') {
    return {
      title: 'Decision recorded in Keystone',
      description: 'The proposal was approved in the trust layer; source systems remain unchanged.'
    };
  }
  if (proposal.status === 'rejected') {
    return {
      title: 'Decision recorded in Keystone',
      description: 'The proposal was rejected in the trust layer; source systems remain unchanged.'
    };
  }
  return {
    title: 'No action available',
    description: 'This proposal is no longer awaiting a reviewer decision. Open the evidence for its history.'
  };
}

function createdLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Created time unavailable' : `Created ${date.toLocaleDateString('en-US')}`;
}

export function ProposalQueue({
  proposals,
  status,
  type = '',
  source = '',
  onStatus,
  onType,
  onSource,
  onConflict,
  defaultOpen = true
}: {
  proposals: Proposal[];
  status: string;
  type?: string;
  source?: string;
  onStatus: (status: string) => void;
  onType?: (type: string) => void;
  onSource?: (source: string) => void;
  onConflict: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const pendingCount = proposals.filter((proposal) => proposal.status === 'pending').length;
  const heldCount = proposals.filter((proposal) => proposal.status === 'held').length;
  const sensitiveCount = proposals.filter((proposal) => proposal.sensitive_hold).length;
  return (
    <Accordion
      id="proposal-queue-accordion"
      title={dashboardStory.proposals.title}
      headingId="queue-heading"
      descriptionId="queue-description"
      defaultOpen={defaultOpen}
      className="panel-section"
      heading={
        <div className="section-heading">
          <div>
            <p className="eyebrow">{dashboardStory.proposals.step}</p>
            <h2 id="queue-heading">{dashboardStory.proposals.title}</h2>
            <p id="queue-description" className="section-description">{dashboardStory.proposals.description}</p>
          </div>
        </div>
      }
    >
      <div className="boundary-callout" role="note" aria-label="How to review a proposal">
        <div className="boundary-callout-lead"><span className="boundary-icon" aria-hidden="true">◎</span><div><strong>Review before you decide</strong><p>Nothing here writes to CRM, the app database, or payments. Approve, reject, or hold changes Keystone’s audit trail only.</p></div></div>
        <ol>
          <li>Open the full evidence and compare the source records.</li>
          <li>Check the suggested field and value against the evidence.</li>
          <li>Choose a decision and leave a reason another reviewer can follow.</li>
        </ol>
      </div>
      <div className="queue-summary" aria-label="Proposal queue summary">
        <article className="queue-summary-card"><span>Showing</span><strong>{proposals.length}</strong><small>most recent matching proposals</small></article>
        <article className="queue-summary-card"><span>Need a decision</span><strong>{pendingCount}</strong><small>pending in this view</small></article>
        <article className="queue-summary-card"><span>Held for review</span><strong>{heldCount}</strong><small>waiting for more evidence</small></article>
        <article className="queue-summary-card"><span>Sensitive holds</span><strong>{sensitiveCount}</strong><small>cannot be approved casually</small></article>
      </div>
      <fieldset className="filters proposal-filters">
        <legend>Find proposals</legend>
        <label>Review state<select value={status} onChange={(event) => onStatus(event.target.value)}><option value="">All states</option><option value="pending">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="held">Held</option><option value="applied">Applied</option><option value="rolled_back">Rolled back</option><option value="superseded">Superseded</option></select></label>
        <label>Issue type<select value={type} onChange={(event) => onType?.(event.target.value)} disabled={!onType}><option value="">All issue types</option>{TYPES.map((item) => <option key={item} value={item}>{humanize(item)}</option>)}</select></label>
        <label>Source involved<select value={source} onChange={(event) => onSource?.(event.target.value)} disabled={!onSource}><option value="">All sources</option><option value="crm">CRM</option><option value="app">App DB</option><option value="payments">Payments</option></select></label>
      </fieldset>
      <p className="queue-results-label" aria-live="polite">{proposals.length ? `Showing ${proposals.length} matching proposal${proposals.length === 1 ? '' : 's'}. Select any issue to inspect its source evidence.` : 'No matching proposals are currently shown.'}</p>
      {proposals.length ? <ul className="queue-list" aria-label="Proposal results">{proposals.map((proposal) => {
        const next = nextStep(proposal);
        return <li key={proposal.id} className="proposal-card">
          <div className="proposal-card-header">
            <div className="proposal-state"><StatusBadge status={proposal.status} />{proposal.sensitive_hold ? <StatusBadge status="held" label="Sensitive hold" /> : null}</div>
            <time dateTime={proposal.created_at}>{createdLabel(proposal.created_at)}</time>
          </div>
          <div className="proposal-card-title">
            <div>
              <span className="proposal-field-label">Conflict to resolve</span>
              <button type="button" className="proposal-title-link" onClick={() => onConflict(proposal.conflict_id)} aria-describedby={`proposal-context-${proposal.id}`}>
                {humanize(proposal.conflict_type)}
              </button>
            </div>
            <div className="proposal-confidence" aria-label={`${confidencePercent(proposal.confidence_bp)} evidence confidence`}>
              <strong>{confidencePercent(proposal.confidence_bp)}</strong><span>evidence confidence</span>
              <meter min="0" max="10000" value={proposal.confidence_bp} aria-label={`${confidencePercent(proposal.confidence_bp)} evidence confidence`}>{confidencePercent(proposal.confidence_bp)}</meter>
            </div>
          </div>
          <p id={`proposal-context-${proposal.id}`} className="proposal-context">{proposal.sources_involved.map(sourceLabel).join(', ')} {proposal.sources_involved.length === 1 ? 'source has' : 'sources have'} a disagreement on <strong>{proposal.disagreeing_fields.join(', ') || 'an unspecified field'}</strong>. Entity <span className="mono">{proposal.entity_refs.join(' · ') || 'reference unavailable'}</span>.</p>
          <dl className="proposal-facts">
            <div><dt>Suggested action</dt><dd>{humanize(proposal.action.kind)}</dd></div>
            <div><dt>Target field</dt><dd><code>{proposal.action.targetField}</code></dd></div>
            <div><dt>Proposed value</dt><dd><code>{proposal.action.proposedValue}</code></dd></div>
            <div><dt>Sources in evidence</dt><dd><span className="proposal-tags">{proposal.sources_involved.map((item) => <span key={item}>{sourceLabel(item)}</span>)}</span></dd></div>
          </dl>
          <div className="proposal-support">
            <div>
              <h3>Why this was suggested</h3>
              {Object.entries(proposal.confidence_signals).length ? <dl className="signal-list">{Object.entries(proposal.confidence_signals).map(([key, value]) => <div key={key}><dt>{signalLabel(key)}</dt><dd>{signalValue(value)}</dd></div>)}</dl> : <p className="muted">No confidence signals were returned. Treat the recommendation as unverified.</p>}
            </div>
            <div>
              <h3>Safety and cost</h3>
              <p className="support-copy">{proposal.sensitive_hold ? `Sensitive fields: ${proposal.sensitive_fields.join(', ') || 'flagged field unavailable'}. The hard hold prevents casual approval.` : 'No sensitive-field hold is attached. Review the lineage before approving.'}</p>
              <p className="support-copy">Provider cost: <strong>{proposal.actual_cost_microcents} micro-cents recorded</strong> · {proposal.estimated_cost_microcents} micro-cents reserved maximum.</p>
            </div>
          </div>
          <div className={`proposal-next-step next-step-${proposal.status}`}>
            <div><span className="proposal-field-label">Next step</span><strong>{next.title}</strong><p>{next.description}</p></div>
            <button type="button" className="secondary-button" onClick={() => onConflict(proposal.conflict_id)} aria-label={`Open full evidence for ${humanize(proposal.conflict_type)}`}>Open full evidence</button>
          </div>
        </li>;
      })}</ul> : <div className="empty-state compact-empty"><span aria-hidden="true">◷</span><h3>No proposals in this queue</h3><p>Reconciliation may not have run, or this filter has no matching proposals. Try another review state, issue type, or source.</p></div>}
    </Accordion>
  );
}
