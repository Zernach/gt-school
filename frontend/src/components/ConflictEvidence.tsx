import type { ConflictFilters, OverviewData } from '../types';
import { humanize, StatusBadge } from './StatusBadge';
import { EMPTY_FILTERS } from './ConflictTable';

export type ConflictPreset = 'active' | 'pending' | 'unchecked';

interface ConflictEvidenceProps {
  overview: OverviewData | null;
  filters: ConflictFilters;
  visibleCount: number | null;
  hasNextPage: boolean;
  disabled: boolean;
  onPreset: (preset: ConflictPreset) => void;
}

function count(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString('en-US');
}

function pendingCount(overview: OverviewData | null): number | undefined {
  if (!overview) return undefined;
  return overview.proposals.find(({ status }) => status === 'pending')?.count ?? 0;
}

function presetSelected(preset: ConflictPreset, filters: ConflictFilters): boolean {
  const sharedFiltersEmpty = filters.type === '' && filters.source === '' && filters.minimumConfidence === '' && filters.from === '';
  if (preset === 'active') return sharedFiltersEmpty && filters.status === 'active' && filters.proposalStatus === '';
  if (preset === 'pending') return sharedFiltersEmpty && filters.status === 'active' && filters.proposalStatus === 'pending';
  return sharedFiltersEmpty && filters.status === 'unchecked' && filters.proposalStatus === '';
}

function runStatus(overview: OverviewData | null): { status: string; label: string; message: string } {
  const invariant = overview?.invariant;
  if (!invariant) return {
    status: 'unchecked',
    label: 'No invariant run',
    message: 'The invariant run is not available yet. Do not interpret an empty list as proof that the sources agree.'
  };
  const unchecked = invariant.summary.unchecked ?? 0;
  const errors = invariant.summary.error ?? 0;
  const failures = invariant.summary.fail ?? 0;
  if (invariant.status !== 'complete' || unchecked || errors) {
    const reasons = [
      unchecked ? `${count(unchecked)} checks were not completed.` : '',
      errors ? `${count(errors)} reported an error.` : '',
      invariant.status !== 'complete' ? `The run is marked ${humanize(invariant.status)}.` : ''
    ].filter(Boolean).join(' ');
    return {
      status: 'partial',
      label: 'Evidence incomplete',
      message: `${reasons || 'The run did not complete.'} Fix source availability before treating this run as complete.`
    };
  }
  if (failures) return {
    status: 'active',
    label: 'Review required',
    message: `${count(failures)} deterministic rule ${failures === 1 ? 'failure is' : 'failures are'} recorded. Open a row to inspect the values and lineage behind that result.`
  };
  return {
    status: 'complete',
    label: 'No failures recorded',
    message: 'Every check in this complete run passed. Keep source freshness in view before relying on that result.'
  };
}

export function ConflictEvidence({ overview, filters, visibleCount, hasNextPage, disabled, onPreset }: ConflictEvidenceProps) {
  const invariant = overview?.invariant;
  const summary = invariant?.summary;
  const pending = pendingCount(overview);
  const status = runStatus(overview);

  return (
    <>
      <div className="conflict-summary" role="group" aria-label="Invariant evidence summary">
        <article className="conflict-summary-card">
          <span>Failed checks</span>
          <strong>{count(summary?.fail)}</strong>
          <small>repeatable rule failures in this run</small>
        </article>
        <article className="conflict-summary-card">
          <span>Evidence gaps</span>
          <strong>{count(summary?.unchecked)}</strong>
          <small>checks skipped because source data was unavailable</small>
        </article>
        <article className="conflict-summary-card">
          <span>Pending review</span>
          <strong>{count(pending)}</strong>
          <small>proposals waiting for a reviewer decision</small>
        </article>
      </div>

      <aside className="evidence-guide" aria-labelledby="conflict-guide-heading">
        <div className="evidence-guide-intro">
          <p className="eyebrow">How to use this evidence</p>
          <h3 id="conflict-guide-heading">Turn a repeatable failure into a safe decision</h3>
          <p>These results come from versioned rules applied to the active source snapshot. They are explainable checks, not predictions or source-system edits.</p>
        </div>
        <ol>
          <li><strong>Find the work.</strong> Use a shortcut or filter to narrow by failure, source, status, or proposal state.</li>
          <li><strong>Verify the reason.</strong> Open a row to compare exact source values, normalized values, and field lineage.</li>
          <li><strong>Decide deliberately.</strong> Review the proposal evidence and audit history; only a reviewer decision changes Keystone’s proposal state.</li>
        </ol>
        <div className="evidence-guide-status">
          <StatusBadge status={status.status} label={status.label} />
          <p>{status.message}</p>
          <p className="muted">Unchecked is not clean: unavailable source evidence never counts as a pass. Source systems remain read-only.</p>
        </div>
      </aside>

      <div className="review-shortcuts" role="group" aria-label="Review shortcuts">
        <div>
          <span className="shortcut-label">Start with</span>
          <p>Shortcuts change the filters below and keep the evidence read-only.</p>
        </div>
        <button type="button" className="secondary-button" aria-pressed={presetSelected('active', filters)} onClick={() => onPreset('active')} disabled={disabled}>Active failures</button>
        <button type="button" className="secondary-button" aria-pressed={presetSelected('pending', filters)} onClick={() => onPreset('pending')} disabled={disabled}>Pending review</button>
        <button type="button" className="secondary-button" aria-pressed={presetSelected('unchecked', filters)} onClick={() => onPreset('unchecked')} disabled={disabled}>Evidence gaps</button>
      </div>

      {visibleCount !== null ? <div className="results-toolbar" role="region" aria-label="Results summary" aria-live="polite">
        <p><strong>{visibleCount.toLocaleString('en-US')}</strong> {visibleCount === 1 ? 'conflict' : 'conflicts'} on this page{hasNextPage ? ' · more results available' : ' · end of filtered results'}</p>
      </div> : null}
    </>
  );
}

export function conflictPresetFilters(preset: ConflictPreset): ConflictFilters {
  const base = { ...EMPTY_FILTERS };
  if (preset === 'pending') return { ...base, proposalStatus: 'pending' };
  if (preset === 'unchecked') return { ...base, status: 'unchecked' };
  return base;
}
