import { useEffect, useRef } from 'react';
import type { ConflictDetail as ConflictDetailType, Proposal } from '../types';
import { ProposalDecision } from './ProposalDecision';
import { humanize, StatusBadge } from './StatusBadge';

function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function ConflictDetail({ detail, onClose, onDecided }: { detail: ConflictDetailType; onClose: () => void; onDecided: (proposal: Proposal) => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);
  return (
    <div ref={panel} className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-heading">
      <div className="detail-header">
        <div><p className="eyebrow">{detail.rule_id} · version {detail.rule_version}</p><h2 id="detail-heading">{humanize(detail.type)}</h2></div>
        <button ref={closeButton} type="button" className="icon-button" onClick={onClose} aria-label="Close conflict detail">×</button>
      </div>
      <div className="detail-summary">
        <StatusBadge status={detail.status} />
        <span>Generation {detail.latest_generation}</span>
        <span>{detail.oscillation_count} repeat{detail.oscillation_count === 1 ? '' : 's'}</span>
      </div>
      <section aria-labelledby="evidence-heading"><h3 id="evidence-heading">Invariant evidence</h3><dl className="evidence-grid"><div><dt>Entities</dt><dd>{detail.entity_refs.join(', ')}</dd></div><div><dt>Sources</dt><dd>{detail.sources_involved.join(', ')}</dd></div><div><dt>Disagreeing fields</dt><dd>{detail.disagreeing_fields.join(', ')}</dd></div><div><dt>Expected verdict</dt><dd>{detail.expected_verdict}</dd></div></dl><pre className="evidence-json">{JSON.stringify(detail.evidence, null, 2)}</pre></section>
      {detail.proposal ? <section aria-labelledby="proposal-heading"><h3 id="proposal-heading">Guarded proposal</h3><div className="proposal-summary"><StatusBadge status={detail.proposal.status} /><strong>{(detail.proposal.confidence_bp / 100).toFixed(0)}% evidence confidence</strong>{detail.proposal.sensitive_hold ? <StatusBadge status="held" label="Sensitive-field hard hold" /> : null}</div><dl className="evidence-grid"><div><dt>Action</dt><dd>{humanize(detail.proposal.action.kind)}</dd></div><div><dt>Target field</dt><dd>{detail.proposal.action.targetField}</dd></div><div><dt>Policy</dt><dd>{detail.proposal.action.policyVersion}</dd></div><div><dt>Cost</dt><dd>{detail.proposal.actual_cost_microcents} micro-cents</dd></div></dl><ProposalDecision proposal={detail.proposal} onDecided={onDecided} /></section> : <section><h3>No proposal yet</h3><p className="muted">Run the spend-capped reconciler to create a pending review action.</p></section>}
      <section aria-labelledby="lineage-heading"><h3 id="lineage-heading">Field lineage</h3>{detail.lineage.length ? <div className="table-scroll lineage-table" tabIndex={0}><table><thead><tr><th scope="col">Source record</th><th scope="col">Field</th><th scope="col">Raw</th><th scope="col">Normalized</th><th scope="col">Transform</th></tr></thead><tbody>{detail.lineage.map((row, index) => <tr key={`${row.source_kind}-${row.source_id}-${row.field_path}-${index}`}><th scope="row"><span className="mono">{row.source_kind}:{row.source_id}</span></th><td>{row.field_path}</td><td>{display(row.raw_value)}</td><td>{display(row.normalized_value)}</td><td>{row.transformation_trace.length ? row.transformation_trace.join(', ') : 'unchanged'}</td></tr>)}</tbody></table></div> : <p className="muted">No material-field lineage matched these entity references.</p>}</section>
      <section aria-labelledby="audit-heading"><h3 id="audit-heading">Audit history</h3>{detail.audit.length ? <ol className="audit-list">{detail.audit.map((event, index) => <li key={`${event.created_at}-${index}`}><StatusBadge status={event.event_type.includes('failed') ? 'failed' : 'complete'} label={humanize(event.event_type)} /><span>{event.actor}</span><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time></li>)}</ol> : <p className="muted">No related audit events yet.</p>}</section>
    </div>
  );
}
