import type { Proposal } from '../types';
import { humanize, StatusBadge } from './StatusBadge';

const TYPES = ['paid_but_no_deal','payment_with_no_person','duplicate_by_email','cross_source_email_mismatch','required_source_missing','material_field_disagreement','enrolled_but_unpaid','dropped_sibling','stale_crm_pointer','merge_collapsed_record','duplicate_payment','wrong_amount_payment','refund_not_reflected','sensitive_field_only_fix'];

export function ProposalQueue({
  proposals,
  status,
  type = '',
  source = '',
  onStatus,
  onType,
  onSource,
  onConflict
}: {
  proposals: Proposal[];
  status: string;
  type?: string;
  source?: string;
  onStatus: (status: string) => void;
  onType?: (type: string) => void;
  onSource?: (source: string) => void;
  onConflict: (id: string) => void;
}) {
  return (
    <section aria-labelledby="queue-heading" className="panel-section">
      <div className="section-heading"><div><p className="eyebrow">Human decision boundary</p><h2 id="queue-heading">Proposal queue</h2></div></div>
      <fieldset className="filters proposal-filters">
        <legend className="sr-only">Filter proposals</legend>
        <label>Queue status<select value={status} onChange={(event) => onStatus(event.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="held">Held</option><option value="applied">Applied</option><option value="rolled_back">Rolled back</option></select></label>
        <label>Queue conflict type<select value={type} onChange={(event) => onType?.(event.target.value)} disabled={!onType}><option value="">All types</option>{TYPES.map((item) => <option key={item} value={item}>{humanize(item)}</option>)}</select></label>
        <label>Queue source<select value={source} onChange={(event) => onSource?.(event.target.value)} disabled={!onSource}><option value="">All sources</option><option value="crm">CRM</option><option value="app">App DB</option><option value="payments">Payments</option></select></label>
      </fieldset>
      {proposals.length ? <ul className="proposal-list">{proposals.map((proposal) => <li key={proposal.id}><div><StatusBadge status={proposal.status} />{proposal.sensitive_hold ? <StatusBadge status="held" label="Sensitive hold" /> : null}</div><button type="button" className="row-link" onClick={() => onConflict(proposal.conflict_id)}>{humanize(proposal.conflict_type)}</button><span>{(proposal.confidence_bp / 100).toFixed(0)}% evidence · {proposal.entity_refs[0]} · {proposal.sources_involved.join(', ')}</span></li>)}</ul> : <div className="empty-state compact-empty"><span aria-hidden="true">◷</span><h3>No proposals in this queue</h3><p>Reconciliation may not have run, or this status filter is empty.</p></div>}
    </section>
  );
}
