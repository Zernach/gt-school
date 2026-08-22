import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { proposalFixture } from '../test/fixtures';
import { ProposalQueue } from './ProposalQueue';

describe('proposal queue', () => {
  it('labels the human decision boundary', () => {
    render(<ProposalQueue proposals={[]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByText('Human decision boundary')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Proposal queue' })).toBeInTheDocument();
  });

  it('offers all supported queue states', () => {
    render(<ProposalQueue proposals={[]} status="" onStatus={vi.fn()} onConflict={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Queue status' });
    expect(within(select).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(['', 'pending', 'approved', 'rejected', 'held']);
  });

  it.each(['', 'pending', 'approved', 'rejected', 'held'])('reflects controlled status %j', (status) => {
    render(<ProposalQueue proposals={[]} status={status} onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Queue status' })).toHaveValue(status);
  });

  it('notifies its owner when status changes', async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();
    render(<ProposalQueue proposals={[]} status="pending" onStatus={onStatus} onConflict={vi.fn()} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Queue status' }), 'held');
    expect(onStatus).toHaveBeenCalledWith('held');
  });

  it('renders a defined empty queue state', () => {
    render(<ProposalQueue proposals={[]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'No proposals in this queue' })).toBeInTheDocument();
    expect(screen.getByText(/Reconciliation may not have run/u)).toBeInTheDocument();
  });

  it('hides the empty-state clock from assistive technology', () => {
    const { container } = render(<ProposalQueue proposals={[]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(container.querySelector('.empty-state > span')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders proposal state, type, confidence, and first entity', () => {
    render(<ProposalQueue proposals={[proposalFixture()]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByText('Pending', { selector: '.status-badge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paid But No Deal' })).toBeInTheDocument();
    expect(screen.getByText('75% evidence · student:11111111-1111-4111-8111-111111111111')).toBeInTheDocument();
  });

  it.each([
    [0, '0% evidence'],
    [1, '0% evidence'],
    [4999, '50% evidence'],
    [7500, '75% evidence'],
    [9499, '95% evidence'],
    [9500, '95% evidence'],
    [10_000, '100% evidence']
  ] as const)('formats confidence basis points %d as %s', (confidence, expected) => {
    render(<ProposalQueue proposals={[proposalFixture({ confidence_bp: confidence })]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByText(new RegExp(`^${expected.replace('%', '%')} ·`, 'u'))).toBeInTheDocument();
  });

  it('shows sensitive holds in visible text', () => {
    render(<ProposalQueue proposals={[proposalFixture({ sensitive_hold: true })]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByText('Sensitive hold')).toBeInTheDocument();
  });

  it('does not imply a sensitive hold for an ordinary proposal', () => {
    render(<ProposalQueue proposals={[proposalFixture({ sensitive_hold: false })]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.queryByText('Sensitive hold')).not.toBeInTheDocument();
  });

  it('opens the owning conflict rather than mutating the proposal', async () => {
    const user = userEvent.setup();
    const onConflict = vi.fn();
    render(<ProposalQueue proposals={[proposalFixture()]} status="pending" onStatus={vi.fn()} onConflict={onConflict} />);
    await user.click(screen.getByRole('button', { name: 'Paid But No Deal' }));
    expect(onConflict).toHaveBeenCalledWith('conflict_paid_fixture');
  });

  it('renders multiple queue entries independently', () => {
    render(<ProposalQueue proposals={[
      proposalFixture(),
      proposalFixture({ id: 'second', conflict_id: 'second-conflict', conflict_type: 'duplicate_payment', status: 'held' })
    ]} status="" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Duplicate Payment' })).toBeInTheDocument();
    expect(screen.getByText('Held', { selector: '.status-badge' })).toBeInTheDocument();
  });

  it('has no detectable accessibility violations when populated', async () => {
    const { container } = render(<ProposalQueue proposals={[proposalFixture()]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no detectable accessibility violations when empty', async () => {
    const { container } = render(<ProposalQueue proposals={[]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
