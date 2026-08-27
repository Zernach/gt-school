import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { proposalFixture } from '../test/fixtures';
import { ProposalQueue } from './ProposalQueue';

describe('proposal queue', () => {
  it('labels the human decision boundary', () => {
    render(<ProposalQueue proposals={[]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByText('04 · Decide')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Decide what to record' })).toBeInTheDocument();
  });

  it('offers all supported queue states', () => {
    render(<ProposalQueue proposals={[]} status="" onStatus={vi.fn()} onConflict={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Review state' });
    expect(within(select).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(['', 'pending', 'approved', 'rejected', 'held', 'applied', 'rolled_back', 'superseded']);
  });

  it.each(['', 'pending', 'approved', 'rejected', 'held', 'applied', 'rolled_back', 'superseded'])('reflects controlled status %j', (status) => {
    render(<ProposalQueue proposals={[]} status={status} onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Review state' })).toHaveValue(status);
  });

  it('notifies its owner when status changes', async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();
    render(<ProposalQueue proposals={[]} status="pending" onStatus={onStatus} onConflict={vi.fn()} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Review state' }), 'held');
    expect(onStatus).toHaveBeenCalledWith('held');
  });

  it('offers type and source filters for the proposal queue', () => {
    render(<ProposalQueue proposals={[]} status="pending" onStatus={vi.fn()} onType={vi.fn()} onSource={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Issue type' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Source involved' })).toBeInTheDocument();
  });

  it('notifies its owner when type or source changes', async () => {
    const user = userEvent.setup();
    const onType = vi.fn();
    const onSource = vi.fn();
    render(<ProposalQueue proposals={[]} status="pending" type="" source="" onStatus={vi.fn()} onType={onType} onSource={onSource} onConflict={vi.fn()} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Issue type' }), 'paid_but_no_deal');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Source involved' }), 'payments');
    expect(onType).toHaveBeenCalledWith('paid_but_no_deal');
    expect(onSource).toHaveBeenCalledWith('payments');
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

  it('renders a decision brief with state, action, confidence, and entity evidence', () => {
    render(<ProposalQueue proposals={[proposalFixture()]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    const card = within(screen.getByRole('list', { name: 'Proposal results' })).getByRole('listitem');
    expect(within(card).getByText('Pending', { selector: '.status-badge' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Paid But No Deal' })).toBeInTheDocument();
    expect(within(card).getByText('Link Or Create Deal Review')).toBeInTheDocument();
    expect(within(card).getByText('crm_deal_id', { selector: 'code' })).toBeInTheDocument();
    expect(within(card).getByText('75%', { selector: '.proposal-confidence strong' })).toBeInTheDocument();
    expect(within(card).getByText(/App DB, CRM, Payments sources have/u)).toBeInTheDocument();
    expect(within(card).getByText(/student:11111111-1111-4111-8111-111111111111/u)).toBeInTheDocument();
    expect(within(card).getByText('Hard Id Agreement')).toBeInTheDocument();
    expect(within(card).getByText('Your decision is needed')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Open full evidence for Paid But No Deal' })).toBeInTheDocument();
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
    expect(screen.getByText(expected.replace(' evidence', ''), { selector: '.proposal-confidence strong' })).toBeInTheDocument();
  });

  it('shows sensitive holds in visible text', () => {
    render(<ProposalQueue proposals={[proposalFixture({ sensitive_hold: true, sensitive_fields: ['billing_owner_email'] })]} status="pending" onStatus={vi.fn()} onConflict={vi.fn()} />);
    expect(screen.getByText('Sensitive hold')).toBeInTheDocument();
    expect(screen.getByText('Blocked by a sensitive-field hold')).toBeInTheDocument();
    expect(screen.getByText(/Sensitive fields: billing_owner_email/u)).toBeInTheDocument();
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
    expect(within(screen.getByRole('list', { name: 'Proposal results' })).getAllByRole('listitem')).toHaveLength(2);
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
