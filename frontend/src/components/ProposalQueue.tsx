import type { Proposal } from '../types';
import { humanize, StatusBadge } from './StatusBadge';

export function ProposalQueue({ proposals, status, onStatus, onConflict }: { proposals: Proposal[]; status: string; onStatus: (status: string) => void; onConflict: (id: string) => void }) {
  return (
    <section aria-labelledby="queue-heading" className="panel-section">
      <div className="section-heading"><div><p className="eyebrow">Human decision boundary</p><h2 id="queue-heading">Proposal queue</h2></div><label>Queue status<select value={status} onChange={(event) => onStatus(event.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="held">Held</option></select></label></div>
      {proposals.length ? <ul className="proposal-list">{proposals.map((proposal) => <li key={proposal.id}><div><StatusBadge status={proposal.status} />{proposal.sensitive_hold ? <StatusBadge status="held" label="Sensitive hold" /> : null}</div><button type="button" className="row-link" onClick={() => onConflict(proposal.conflict_id)}>{humanize(proposal.conflict_type)}</button><span>{(proposal.confidence_bp / 100).toFixed(0)}% evidence · {proposal.entity_refs[0]}</span></li>)}</ul> : <div className="empty-state compact-empty"><span aria-hidden="true">◷</span><h3>No proposals in this queue</h3><p>Reconciliation may not have run, or this status filter is empty.</p></div>}
    </section>
  );
}
