import type { ConflictFilters, ConflictRow } from '../types';
import { humanize, StatusBadge } from './StatusBadge';

const TYPES = ['paid_but_no_deal','payment_with_no_person','duplicate_by_email','cross_source_email_mismatch','required_source_missing','material_field_disagreement','enrolled_but_unpaid','dropped_sibling','stale_crm_pointer','merge_collapsed_record','duplicate_payment','wrong_amount_payment','refund_not_reflected','sensitive_field_only_fix'];

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
  if (value === null) return { status: 'unchecked', label: 'No proposal' };
  const percent = `${(value / 100).toFixed(0)}% evidence`;
  return value < 9500 ? { status: 'low', label: percent } : { status: 'complete', label: percent };
}

export function ConflictTable({ rows, selectedId, onSelect }: { rows: ConflictRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (!rows.length) return <div className="empty-state"><span aria-hidden="true">✓</span><h3>No matching conflicts</h3><p>This filtered window has no deterministic failures. Check source freshness before treating that as clean.</p></div>;
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Scrollable conflict results">
      <table>
        <caption className="sr-only">Cross-source conflicts and proposal status</caption>
        <thead><tr><th scope="col">Conflict</th><th scope="col">Entity</th><th scope="col">Sources</th><th scope="col">Fields</th><th scope="col">Proposal</th><th scope="col">Confidence</th><th scope="col">Seen</th></tr></thead>
        <tbody>{rows.map((row) => {
          const confidence = confidenceLabel(row.confidence_bp);
          return <tr key={row.id} className={selectedId === row.id ? 'selected-row' : undefined}>
            <th scope="row"><div className="cell-stack"><button className="row-link" type="button" data-conflict-id={row.id} onClick={() => onSelect(row.id)} aria-pressed={selectedId === row.id}>{humanize(row.type)}</button><StatusBadge status={row.status} /></div></th>
            <td className="mono compact-cell">{row.entity_refs[0]}</td>
            <td><ul className="tag-list" aria-label="Sources">{row.sources_involved.map((source) => <li key={source}>{source}</li>)}</ul></td>
            <td>{row.disagreeing_fields.join(', ')}</td>
            <td><StatusBadge status={row.proposal_status ?? 'unchecked'} /></td>
            <td><div className="cell-stack"><StatusBadge status={confidence.status} label={confidence.label} />{row.sensitive_hold ? <span className="hold-note">Sensitive hold</span> : null}</div></td>
            <td><time dateTime={row.last_seen_at}>{new Date(row.last_seen_at).toLocaleDateString()}</time></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}
