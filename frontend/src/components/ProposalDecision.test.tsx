import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { decideProposal } from '../api';
import { proposalFixture } from '../test/fixtures';
import { ProposalDecision } from './ProposalDecision';

vi.mock('../api', () => ({ decideProposal: vi.fn() }));

const mockedDecideProposal = vi.mocked(decideProposal);

beforeEach(() => {
  mockedDecideProposal.mockReset();
});

describe('pending proposal decision', () => {
  it('explains that approval cannot mutate a source system', () => {
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    expect(screen.getByText(/Core mode still has no source-system writer/u)).toBeInTheDocument();
    expect(screen.getByText(/does not mutate a source system/u)).toBeInTheDocument();
  });

  it('groups the decision form with a visible legend', () => {
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Review this proposal' })).toBeInTheDocument();
  });

  it('defaults to the safest hold decision', () => {
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'hold' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'approve' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'reject' })).not.toBeChecked();
  });

  it.each(['approve', 'reject', 'hold'] as const)('allows keyboard-accessible %s selection', async (decision) => {
    const user = userEvent.setup();
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: decision }));
    expect(screen.getByRole('radio', { name: decision })).toBeChecked();
  });

  it('labels and bounds the required reviewer reason', () => {
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    const reason = screen.getByRole('textbox', { name: 'Reason' });
    expect(reason).toBeRequired();
    expect(reason).toHaveAttribute('minlength', '3');
    expect(reason).toHaveAttribute('maxlength', '1000');
  });

  it('requires explicit source-boundary confirmation', () => {
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    const confirmation = screen.getByRole('checkbox', { name: /I confirm this decision/u });
    expect(confirmation).toBeRequired();
    expect(confirmation).not.toBeChecked();
  });

  it('keeps submit disabled with no reason or confirmation', () => {
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Confirm hold' })).toBeDisabled();
  });

  it('keeps submit disabled for a two-character reason', async () => {
    const user = userEvent.setup();
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'no');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/u }));
    expect(screen.getByRole('button', { name: 'Confirm hold' })).toBeDisabled();
  });

  it('ignores surrounding whitespace when enforcing the minimum reason', async () => {
    const user = userEvent.setup();
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), '  x  ');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/u }));
    expect(screen.getByRole('button', { name: 'Confirm hold' })).toBeDisabled();
  });

  it('enables submit only after both gates pass', async () => {
    const user = userEvent.setup();
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Evidence verified');
    expect(screen.getByRole('button', { name: 'Confirm hold' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /I confirm/u }));
    expect(screen.getByRole('button', { name: 'Confirm hold' })).toBeEnabled();
  });

  it.each([
    ['approve', 'approved'],
    ['reject', 'rejected'],
    ['hold', 'held']
  ] as const)('submits %s with trimmed reason and optimistic version', async (decision, status) => {
    const user = userEvent.setup();
    const proposal = proposalFixture({ version: 7 });
    const decided = proposalFixture({ status, version: 8 });
    mockedDecideProposal.mockResolvedValue(decided);
    const onDecided = vi.fn();
    render(<ProposalDecision proposal={proposal} onDecided={onDecided} />);
    await user.click(screen.getByRole('radio', { name: decision }));
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), '  Evidence verified  ');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/u }));
    await user.click(screen.getByRole('button', { name: `Confirm ${decision}` }));
    expect(mockedDecideProposal).toHaveBeenCalledOnce();
    expect(mockedDecideProposal).toHaveBeenCalledWith(proposal.id, decision, 'Evidence verified', 7);
    expect(onDecided).toHaveBeenCalledWith(decided);
  });

  it('disables all controls and announces recording while in flight', async () => {
    const user = userEvent.setup();
    let resolveDecision!: (value: ReturnType<typeof proposalFixture>) => void;
    mockedDecideProposal.mockReturnValue(new Promise((resolve) => { resolveDecision = resolve; }));
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Evidence verified');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/u }));
    await user.click(screen.getByRole('button', { name: 'Confirm hold' }));
    expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Review this proposal' })).toBeDisabled();
    resolveDecision(proposalFixture({ status: 'held', version: 2 }));
    expect(await screen.findByRole('button', { name: 'Confirm hold' })).toBeEnabled();
  });

  it('shows a service error without calling the decision callback', async () => {
    const user = userEvent.setup();
    mockedDecideProposal.mockRejectedValue(new Error('The proposal changed; reload before deciding.'));
    const onDecided = vi.fn();
    render(<ProposalDecision proposal={proposalFixture()} onDecided={onDecided} />);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Evidence verified');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/u }));
    await user.click(screen.getByRole('button', { name: 'Confirm hold' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The proposal changed; reload before deciding.');
    expect(onDecided).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm hold' })).toBeEnabled();
  });

  it('shows a safe fallback for a non-Error rejection', async () => {
    const user = userEvent.setup();
    mockedDecideProposal.mockRejectedValue('offline');
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Evidence verified');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/u }));
    await user.click(screen.getByRole('button', { name: 'Confirm hold' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Decision failed. Reload and retry.');
  });

  it('clears a prior error before retrying', async () => {
    const user = userEvent.setup();
    mockedDecideProposal.mockRejectedValueOnce(new Error('First failure')).mockResolvedValueOnce(proposalFixture({ status: 'held', version: 2 }));
    render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Evidence verified');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/u }));
    await user.click(screen.getByRole('button', { name: 'Confirm hold' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('First failure');
    await user.click(screen.getByRole('button', { name: 'Confirm hold' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<ProposalDecision proposal={proposalFixture()} onDecided={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('terminal proposal decision', () => {
  it.each(['approved', 'rejected', 'held', 'superseded'] as const)('renders immutable status for %s', (status) => {
    render(<ProposalDecision proposal={proposalFixture({ status })} onDecided={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(`Decision recorded: ${status}. This changed Keystone review state only.`);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never invokes the API for terminal state render', () => {
    render(<ProposalDecision proposal={proposalFixture({ status: 'approved' })} onDecided={vi.fn()} />);
    expect(mockedDecideProposal).not.toHaveBeenCalled();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<ProposalDecision proposal={proposalFixture({ status: 'held' })} onDecided={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
