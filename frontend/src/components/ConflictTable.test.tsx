import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { conflictFixture, emptyFilters } from '../test/fixtures';
import type { ConflictFilters } from '../types';
import { ConflictFiltersForm, ConflictTable, EMPTY_FILTERS } from './ConflictTable';

describe('conflict filters', () => {
  it('exports the safe default active-conflict window', () => {
    expect(EMPTY_FILTERS).toEqual({
      type: '',
      source: '',
      status: 'active',
      proposalStatus: '',
      minimumConfidence: '',
      from: ''
    });
  });

  it('labels every filter control', () => {
    render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={vi.fn()} disabled={false} />);
    expect(screen.getByRole('group', { name: 'Filter conflicts' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Conflict type' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Source' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Conflict status' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Proposal status' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Minimum confidence' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seen since')).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('offers every C1-C14 conflict type plus all types', () => {
    render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={vi.fn()} disabled={false} />);
    const type = screen.getByRole('combobox', { name: 'Conflict type' });
    expect(within(type).getAllByRole('option')).toHaveLength(15);
    expect(within(type).getByRole('option', { name: 'Paid But No Deal' })).toHaveValue('paid_but_no_deal');
    expect(within(type).getByRole('option', { name: 'Sensitive Field Only Fix' })).toHaveValue('sensitive_field_only_fix');
  });

  it('offers only known source filters', () => {
    render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={vi.fn()} disabled={false} />);
    const source = screen.getByRole('combobox', { name: 'Source' });
    expect(within(source).getAllByRole('option').map((option) => option.textContent)).toEqual(['All sources', 'CRM', 'App DB', 'Payments']);
  });

  it('offers active, resolved, and oscillation-hold conflict states', () => {
    render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={vi.fn()} disabled={false} />);
    const status = screen.getByRole('combobox', { name: 'Conflict status' });
    expect(within(status).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(['', 'active', 'resolved', 'oscillation_hold']);
  });

  it('offers every human review state', () => {
    render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={vi.fn()} disabled={false} />);
    const status = screen.getByRole('combobox', { name: 'Proposal status' });
    expect(within(status).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(['', 'pending', 'approved', 'rejected', 'held']);
  });

  it('offers documented confidence thresholds', () => {
    render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={vi.fn()} disabled={false} />);
    const confidence = screen.getByRole('combobox', { name: 'Minimum confidence' });
    expect(within(confidence).getAllByRole('option').map((option) => option.textContent)).toEqual(['Any confidence', '50%', '75%', '95%']);
  });

  it.each([
    ['Conflict type', 'type', 'wrong_amount_payment'],
    ['Source', 'source', 'payments'],
    ['Conflict status', 'status', 'resolved'],
    ['Proposal status', 'proposalStatus', 'held'],
    ['Minimum confidence', 'minimumConfidence', '0.95']
  ] as const)('updates only %s when selected', async (label, key, value) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={onChange} disabled={false} />);
    await user.selectOptions(screen.getByRole('combobox', { name: label }), value);
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, [key]: value });
  });

  it('turns the local seen-since value into an ISO timestamp', () => {
    const onChange = vi.fn();
    render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={onChange} disabled={false} />);
    fireEvent.change(screen.getByLabelText('Seen since'), { target: { value: '2026-01-15T12:00' } });
    const next = onChange.mock.calls[0]?.[0] as ConflictFilters;
    expect(next).toEqual({ ...EMPTY_FILTERS, from: expect.stringMatching(/^2026-01-15T/u) });
    expect(Number.isNaN(new Date(next.from).valueOf())).toBe(false);
  });

  it('clears an emptied seen-since value', () => {
    const onChange = vi.fn();
    render(<ConflictFiltersForm filters={{ ...EMPTY_FILTERS, from: '2026-01-15T12:00:00.000Z' }} onChange={onChange} disabled={false} />);
    fireEvent.change(screen.getByLabelText('Seen since'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, from: '' });
  });

  it('resets every filter to the active default', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const populated: ConflictFilters = {
      type: 'duplicate_payment',
      source: 'payments',
      status: 'oscillation_hold',
      proposalStatus: 'held',
      minimumConfidence: '0.95',
      from: '2026-01-15T12:00:00.000Z'
    };
    render(<ConflictFiltersForm filters={populated} onChange={onChange} disabled={false} />);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });

  it('disables the entire control group during a stale-sensitive refresh', () => {
    render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('group', { name: 'Filter conflicts' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Conflict type' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  it('reflects controlled values without local shadow state', () => {
    const filters = { ...emptyFilters, type: 'duplicate_by_email', source: 'crm', status: 'resolved', proposalStatus: 'approved', minimumConfidence: '0.75' };
    render(<ConflictFiltersForm filters={filters} onChange={vi.fn()} disabled={false} />);
    expect(screen.getByRole('combobox', { name: 'Conflict type' })).toHaveValue('duplicate_by_email');
    expect(screen.getByRole('combobox', { name: 'Source' })).toHaveValue('crm');
    expect(screen.getByRole('combobox', { name: 'Conflict status' })).toHaveValue('resolved');
    expect(screen.getByRole('combobox', { name: 'Proposal status' })).toHaveValue('approved');
    expect(screen.getByRole('combobox', { name: 'Minimum confidence' })).toHaveValue('0.75');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<ConflictFiltersForm filters={EMPTY_FILTERS} onChange={vi.fn()} disabled={false} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('conflict table', () => {
  it('renders a defined empty state without an empty table shell', () => {
    render(<ConflictTable rows={[]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'No matching conflicts' })).toBeInTheDocument();
    expect(screen.getByText(/Check source freshness/u)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('marks the decorative empty-state check as hidden', () => {
    const { container } = render(<ConflictTable rows={[]} selectedId={null} onSelect={vi.fn()} />);
    expect(container.querySelector('.empty-state > span')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders an accessible result table and caption', () => {
    render(<ConflictTable rows={[conflictFixture()]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('table', { name: 'Cross-source conflicts and proposal status' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Conflict', 'Entity', 'Sources', 'Fields', 'Proposal', 'Confidence', 'Seen']);
  });

  it('makes the wide table container keyboard-scrollable', () => {
    render(<ConflictTable rows={[conflictFixture()]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByLabelText('Scrollable conflict results')).toHaveAttribute('tabindex', '0');
  });

  it('shows conflict type, status, first entity, sources, and fields', () => {
    render(<ConflictTable rows={[conflictFixture()]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Paid But No Deal' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('student:11111111-1111-4111-8111-111111111111')).toBeInTheDocument();
    const sources = screen.getByRole('list', { name: 'Sources' });
    expect(within(sources).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['app', 'crm', 'payments']);
    expect(screen.getByText('crm_deal_id')).toBeInTheDocument();
  });

  it('calls onSelect from the evidence-row button', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ConflictTable rows={[conflictFixture()]} selectedId={null} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Paid But No Deal' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('conflict_paid_fixture');
  });

  it('allows keyboard activation of a conflict row', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ConflictTable rows={[conflictFixture()]} selectedId={null} onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: 'Paid But No Deal' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('conflict_paid_fixture');
  });

  it('exposes selected row state both visually and semantically', () => {
    const row = conflictFixture();
    render(<ConflictTable rows={[row]} selectedId={row.id} onSelect={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Paid But No Deal' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.closest('tr')).toHaveClass('selected-row');
  });

  it('does not mark an unselected row as pressed', () => {
    render(<ConflictTable rows={[conflictFixture()]} selectedId="another" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Paid But No Deal' })).toHaveAttribute('aria-pressed', 'false');
  });

  it.each([
    [null, 'No proposal', 'status-unchecked'],
    [0, '0% evidence', 'status-low'],
    [5000, '50% evidence', 'status-low'],
    [9499, '95% evidence', 'status-low'],
    [9500, '95% evidence', 'status-complete'],
    [10_000, '100% evidence', 'status-complete']
  ] as const)('renders confidence %s as %s with threshold class', (confidence, label, className) => {
    render(<ConflictTable rows={[conflictFixture({ confidence_bp: confidence })]} selectedId={null} onSelect={vi.fn()} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveClass(className);
    expect(badge.querySelector('.status-symbol')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows proposal status separately from conflict status', () => {
    render(<ConflictTable rows={[conflictFixture({ status: 'oscillation_hold', proposal_status: 'held' })]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Oscillation Hold')).toBeInTheDocument();
    expect(screen.getByText('Held')).toBeInTheDocument();
  });

  it('shows an unchecked proposal label when no proposal exists', () => {
    render(<ConflictTable rows={[conflictFixture({ proposal_id: null, proposal_status: null, confidence_bp: null })]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getAllByText('Unchecked')).toHaveLength(1);
    expect(screen.getByText('No proposal')).toBeInTheDocument();
  });

  it('shows a textual sensitive hold in addition to status color', () => {
    render(<ConflictTable rows={[conflictFixture({ sensitive_hold: true })]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Sensitive hold')).toBeInTheDocument();
  });

  it('omits the sensitive hold note for ordinary actions', () => {
    render(<ConflictTable rows={[conflictFixture({ sensitive_hold: false })]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.queryByText('Sensitive hold')).not.toBeInTheDocument();
  });

  it('uses a machine-readable last-seen timestamp', () => {
    render(<ConflictTable rows={[conflictFixture()]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/1\/15\/2026/u, { selector: 'time' })).toHaveAttribute('datetime', '2026-01-15T12:00:00.000Z');
  });

  it('renders multiple records as independent table rows', () => {
    render(<ConflictTable rows={[
      conflictFixture(),
      conflictFixture({ id: 'second', type: 'duplicate_payment', entity_refs: ['payment:second'] })
    ]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Duplicate Payment' })).toBeInTheDocument();
  });

  it('has no detectable accessibility violations for populated results', async () => {
    const { container } = render(<ConflictTable rows={[conflictFixture()]} selectedId={null} onSelect={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no detectable accessibility violations for empty results', async () => {
    const { container } = render(<ConflictTable rows={[]} selectedId={null} onSelect={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
