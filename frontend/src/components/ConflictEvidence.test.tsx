import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { vi } from 'vitest';
import { overviewFixture } from '../test/fixtures';
import { ConflictEvidence, conflictPresetFilters } from './ConflictEvidence';
import { EMPTY_FILTERS } from './ConflictTable';

describe('conflict evidence workspace', () => {
  it('explains the evidence, summarizes the run, and gives a review path', () => {
    render(<ConflictEvidence overview={overviewFixture()} filters={EMPTY_FILTERS} visibleCount={2} hasNextPage={true} disabled={false} onPreset={vi.fn()} />);
    const summary = screen.getByRole('group', { name: 'Invariant evidence summary' });
    expect(within(summary).getByText('3,050')).toBeInTheDocument();
    expect(within(summary).getByText('Evidence gaps')).toBeInTheDocument();
    expect(within(summary).getByText('3,049')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Turn a repeatable failure into a safe decision' })).toBeInTheDocument();
    expect(screen.getByText(/Unchecked is not clean/u)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Results summary' })).toHaveTextContent('2 conflicts on this page · more results available');
  });

  it('keeps unavailable invariant evidence explicit', () => {
    render(<ConflictEvidence overview={null} filters={EMPTY_FILTERS} visibleCount={null} hasNextPage={false} disabled={false} onPreset={vi.fn()} />);
    expect(screen.getByText('No invariant run')).toBeInTheDocument();
    expect(screen.getByText(/Do not interpret an empty list as proof/u)).toBeInTheDocument();
    expect(screen.queryByText(/conflicts on this page/u)).not.toBeInTheDocument();
  });

  it('emits the selected review shortcut and marks the active shortcut', () => {
    const onPreset = vi.fn();
    const filters = conflictPresetFilters('pending');
    render(<ConflictEvidence overview={overviewFixture()} filters={filters} visibleCount={0} hasNextPage={false} disabled={false} onPreset={onPreset} />);
    expect(screen.getByRole('button', { name: 'Pending review' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Evidence gaps' }));
    expect(onPreset).toHaveBeenCalledWith('unchecked');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<ConflictEvidence overview={overviewFixture()} filters={EMPTY_FILTERS} visibleCount={2} hasNextPage={false} disabled={false} onPreset={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
