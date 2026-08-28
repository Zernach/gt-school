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
  const status = runStatus(overview);

  return (
    <>
      <div className="evidence-status" role="status" aria-label="Invariant evidence status">
        <StatusBadge status={status.status} label={status.label} />
        <p>{status.message}</p>
        <p className="muted">Unchecked is not clean: unavailable source evidence never counts as a pass.</p>
      </div>

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
