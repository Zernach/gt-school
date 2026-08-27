import type { ConflictFilters, ConflictRow } from '../types';
import { humanize, StatusBadge } from './StatusBadge';

const TYPES = ['paid_but_no_deal','payment_with_no_person','duplicate_by_email','cross_source_email_mismatch','required_source_missing','material_field_disagreement','enrolled_but_unpaid','dropped_sibling','stale_crm_pointer','merge_collapsed_record','duplicate_payment','wrong_amount_payment','refund_not_reflected','sensitive_field_only_fix'];
const SOURCE_LABELS: Record<string, string> = { app: 'App DB', crm: 'CRM', payments: 'Payments' };

const DESCRIPTIONS: Record<string, string> = {
  paid_but_no_deal: 'A paid deposit has no matching CRM deal.',
  payment_with_no_person: 'A payment cannot be linked to a canonical person.',
  duplicate_by_email: 'Two CRM records share a normalized email.',
  cross_source_email_mismatch: 'Linked source records disagree on email.',
  required_source_missing: 'A required record is missing from one or more sources.',
  material_field_disagreement: 'A material field differs between sources.',
  enrolled_but_unpaid: 'An enrolled student has no payment record.',
  dropped_sibling: 'One household sibling lacks the expected payment.',
  stale_crm_pointer: 'An enrollment points to a missing or misassociated CRM deal.',
  merge_collapsed_record: 'A CRM record contains a second person after a merge.',
  duplicate_payment: 'Two payment records share one payment ID.',
  wrong_amount_payment: 'The payment amount differs from the configured amount.',
  refund_not_reflected: 'A refund is not reflected in the enrollment state.',
  sensitive_field_only_fix: 'Only a sensitive field differs; automatic action is blocked.'
};

export const EMPTY_FILTERS: ConflictFilters = { type: '', source: '', status: 'active', proposalStatus: '', minimumConfidence: '', from: '' };

function localDateTimeValue(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ConflictFiltersForm({ filters, onChange, disabled }: { filters: ConflictFilters; onChange: (filters: ConflictFilters) => void; disabled: boolean }) {
  const set = (key: keyof ConflictFilters, value: string) => onChange({ ...filters, [key]: value });
  return (
    <fieldset className="filters" disabled={disabled}>
      <legend className="sr-only">Filter conflicts</legend>
      <label>Conflict type<select value={filters.type} onChange={(event) => set('type', event.target.value)}><option value="">All types</option>{TYPES.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}</select></label>
      <label>Source<select value={filters.source} onChange={(event) => set('source', event.target.value)}><option value="">All sources</option><option value="crm">CRM</option><option value="app">App DB</option><option value="payments">Payments</option></select></label>
      <label>Conflict status<select value={filters.status} onChange={(event) => set('status', event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="resolved">Resolved</option><option value="unchecked">Unchecked</option><option value="oscillation_hold">Oscillation hold</option></select></label>
      <label>Proposal status<select value={filters.proposalStatus} onChange={(event) => set('proposalStatus', event.target.value)}><option value="">Any proposal</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="held">Held</option><option value="applied">Applied</option><option value="rolled_back">Rolled back</option></select></label>
      <label>Minimum confidence<select value={filters.minimumConfidence} onChange={(event) => set('minimumConfidence', event.target.value)}><option value="">Any confidence</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="0.95">95%</option></select></label>
      <label>Seen since<input type="datetime-local" value={localDateTimeValue(filters.from)} onChange={(event) => set('from', event.target.value ? new Date(event.target.value).toISOString() : '')} /></label>
      <button type="button" className="secondary-button" onClick={() => onChange(EMPTY_FILTERS)}>Reset</button>
    </fieldset>
  );
}

function confidenceLabel(value: number | null): { status: string; label: string } {
  if (value === null) return { status: 'unchecked', label: 'No proposal yet' };
  const percent = `${(value / 100).toFixed(0)}% confidence`;
  return value < 9500 ? { status: 'low', label: percent } : { status: 'complete', label: percent };
}

function conflictStatusLabel(status: string): string {
  if (status === 'active') return 'Active · review needed';
  if (status === 'unchecked') return 'Unchecked · evidence gap';
  if (status === 'oscillation_hold') return 'Held · repeated conflict';
  return humanize(status);
}

function proposalLabel(status: string | null): string {
  return status ? humanize(status) : 'Not created';
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? humanize(source);
}

export function ConflictTable({ rows, selectedId, onSelect }: { rows: ConflictRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (!rows.length) return <div className="empty-state"><span aria-hidden="true">✓</span><h3>No matching conflicts</h3><p>No rows match these filters. This is not a clean-data claim; check the invariant run and source freshness above.</p></div>;
  return (
    <div className="table-scroll conflict-table" tabIndex={0} aria-label="Scrollable conflict results">
      <table>
        <caption className="sr-only">Deterministic rule failures with affected records, source evidence, proposal state, and confidence</caption>
        <thead><tr><th scope="col">Rule failure</th><th scope="col">Affected records</th><th scope="col">Evidence sources</th><th scope="col">Disagreement</th><th scope="col">Proposal state</th><th scope="col">Safety signal</th><th scope="col">Last observed</th></tr></thead>
        <tbody>{rows.map((row) => {
          const confidence = confidenceLabel(row.confidence_bp);
          return <tr key={row.id} className={selectedId === row.id ? 'selected-row' : undefined}>
            <th scope="row"><div className="cell-stack"><button className="row-link" type="button" data-conflict-id={row.id} onClick={() => onSelect(row.id)} aria-pressed={selectedId === row.id}>{humanize(row.type)}</button><span className="cell-note">{DESCRIPTIONS[row.type] ?? 'A deterministic cross-source rule failed.'}</span><StatusBadge status={row.status} label={conflictStatusLabel(row.status)} /></div></th>
            <td><ul className="reference-list">{row.entity_refs.map((reference) => <li key={reference} className="mono">{reference}</li>)}</ul></td>
            <td><ul className="tag-list" aria-label="Evidence sources">{row.sources_involved.map((source) => <li key={source}>{sourceLabel(source)}</li>)}</ul><span className="cell-note">Read-only source evidence</span></td>
            <td><ul className="field-list">{row.disagreeing_fields.map((field) => <li key={field} className="mono">{field}</li>)}</ul></td>
            <td><div className="cell-stack"><StatusBadge status={row.proposal_status ?? 'unchecked'} label={proposalLabel(row.proposal_status)} /><span className="cell-note">{row.proposal_status === 'pending' ? 'Reviewer decision required.' : row.proposal_status === 'held' || row.sensitive_hold ? 'Automatic action is blocked.' : row.proposal_status ? 'Review state recorded.' : 'Inspect the conflict before proposing action.'}</span></div></td>
            <td><div className="cell-stack"><StatusBadge status={confidence.status} label={confidence.label} />{row.sensitive_hold ? <span className="hold-note">Sensitive-field hard hold</span> : null}</div></td>
            <td><div className="cell-stack"><time dateTime={row.last_seen_at}>{new Date(row.last_seen_at).toLocaleString()}</time><span className="cell-note">Generation {row.latest_generation}</span>{row.oscillation_count ? <span className="hold-note">Repeated {row.oscillation_count} time{row.oscillation_count === 1 ? '' : 's'}</span> : null}</div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}
