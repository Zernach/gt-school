import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { conflictDetailFixture, proposalFixture } from '../test/fixtures';
import { ConflictDetail } from './ConflictDetail';

describe('conflict detail', () => {
  it('renders a modal dialog labelled by the conflict type', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Paid But No Deal' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('C1 · version invariants-v1')).toBeInTheDocument();
  });

  it('closes from a clearly labelled button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={onClose} onDecided={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Close conflict detail' });
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus into the modal and closes it with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={onClose} onDecided={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Close conflict detail' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps reverse-tab focus inside the modal boundary', async () => {
    const user = userEvent.setup();
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Paid But No Deal' });
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close conflict detail' })).toHaveFocus();
  });

  it('shows generation and singular repeat count', () => {
    render(<ConflictDetail detail={conflictDetailFixture({ latest_generation: 2, oscillation_count: 1 })} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByText('Generation 2')).toBeInTheDocument();
    expect(screen.getByText('1 repeat')).toBeInTheDocument();
  });

  it('shows plural repeat count including zero', () => {
    render(<ConflictDetail detail={conflictDetailFixture({ oscillation_count: 0 })} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByText('0 repeats')).toBeInTheDocument();
  });

  it('shows all invariant evidence dimensions', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Invariant evidence' }).closest('section')!;
    expect(within(section).getByText(/student:11111111/u)).toBeInTheDocument();
    expect(within(section).getByText('app, crm, payments')).toBeInTheDocument();
    expect(within(section).getByText('crm_deal_id')).toBeInTheDocument();
    expect(within(section).getByText('fail')).toBeInTheDocument();
    expect(within(section).getByText(/"payment_id": "payment-1"/u)).toBeInTheDocument();
  });

  it('shows proposal confidence, action, target, policy, and exact cost units', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Guarded proposal' }).closest('section')!;
    expect(within(section).getByText('75% evidence confidence')).toBeInTheDocument();
    expect(within(section).getByText('Link Or Create Deal Review')).toBeInTheDocument();
    expect(within(section).getByText('crm_deal_id')).toBeInTheDocument();
    expect(within(section).getByText('actions-v1')).toBeInTheDocument();
    expect(within(section).getByText('2 micro-cents')).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'Proposal evidence' })).toBeInTheDocument();
    expect(within(section).getByText(/"source_systems_unchanged": true/u)).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'Confidence signals' })).toBeInTheDocument();
    expect(within(section).getByText(/"hardIdAgreement": true/u)).toBeInTheDocument();
  });

  it('shows a normative sensitive-field hard hold', () => {
    const proposal = proposalFixture({ sensitive_hold: true, sensitive_fields: ['billing_owner_email'] });
    render(<ConflictDetail detail={conflictDetailFixture({ proposal })} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByText('Sensitive-field hard hold')).toBeInTheDocument();
  });

  it('omits the sensitive hold badge for ordinary linkage proposals', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.queryByText('Sensitive-field hard hold')).not.toBeInTheDocument();
  });

  it('renders a defined no-proposal state', () => {
    render(<ConflictDetail detail={conflictDetailFixture({ proposal: null })} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'No proposal yet' })).toBeInTheDocument();
    expect(screen.getByText(/Run the spend-capped reconciler/u)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Review this proposal' })).not.toBeInTheDocument();
  });

  it('renders lineage as a keyboard-scrollable semantic table', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: 'Field lineage' });
    const section = heading.closest('section')!;
    const scroller = section.querySelector('.table-scroll');
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(within(section).getByRole('table')).toBeInTheDocument();
    expect(within(section).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Source record', 'Field', 'Raw', 'Normalized', 'Transform']);
  });

  it('displays explicit null lineage values as em dash', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('displays normalization trace and unchanged status', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByText('unchanged')).toBeInTheDocument();
    expect(screen.getByText('case_folded, gmail_plus_alias_removed, gmail_dots_removed')).toBeInTheDocument();
  });

  it('renders complex lineage values as compact JSON', () => {
    const detail = conflictDetailFixture();
    detail.lineage[0]!.raw_value = { pointer: null };
    detail.lineage[0]!.normalized_value = ['one', 'two'];
    render(<ConflictDetail detail={detail} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByText('{"pointer":null}')).toBeInTheDocument();
    expect(screen.getByText('["one","two"]')).toBeInTheDocument();
  });

  it('renders a defined empty lineage state', () => {
    render(<ConflictDetail detail={conflictDetailFixture({ lineage: [] })} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByText('No material-field lineage matched these entity references.')).toBeInTheDocument();
  });

  it('renders audit events as an ordered history', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Audit history' }).closest('section')!;
    expect(within(section).getByRole('list')).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).getByText('Sync Completed')).toBeInTheDocument();
    expect(within(section).getByText('Proposal Created')).toBeInTheDocument();
    expect(within(section).getByText(/system:sync/u)).toBeInTheDocument();
    expect(within(section).getByText(/system:reconciler/u)).toBeInTheDocument();
    expect(within(section).getByText(/Accepted 120000/u)).toBeInTheDocument();
    expect(within(section).getByText(/Cost Microcents 2/u)).toBeInTheDocument();
  });

  it('marks failed audit events with failed text and symbol', () => {
    const detail = conflictDetailFixture({
      audit: [{
        event_type: 'sync_failed',
        actor: 'system:sync',
        object_type: 'sync_run',
        object_id: 'sync-1',
        metadata: {},
        created_at: '2026-01-15T12:00:00.000Z'
      }]
    });
    render(<ConflictDetail detail={detail} onClose={vi.fn()} onDecided={vi.fn()} />);
    const badge = screen.getByText('Sync Failed');
    expect(badge).toHaveClass('status-failed');
    expect(badge.querySelector('.status-symbol')).toHaveTextContent('×');
  });

  it('uses machine-readable audit timestamps', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    const times = screen.getAllByText(/1\/15\/2026/u, { selector: 'time' });
    expect(times).toHaveLength(2);
    expect(times.every((time) => time.getAttribute('datetime') === '2026-01-15T12:00:00.000Z')).toBe(true);
  });

  it('renders a defined empty audit state', () => {
    render(<ConflictDetail detail={conflictDetailFixture({ audit: [] })} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByText('No related audit events yet.')).toBeInTheDocument();
  });

  it('shows the incident group and linked tickets for a clustered failure', () => {
    render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Incident group' })).toBeInTheDocument();
    expect(screen.getByText(/12 related failures/u)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linked tickets' })).toBeInTheDocument();
    expect(screen.getByText(/ops-c1/u)).toBeInTheDocument();
  });

  it('passes successful decisions back to its owner', async () => {
    const user = userEvent.setup();
    const detail = conflictDetailFixture({ proposal: proposalFixture({ status: 'approved' }) });
    const onDecided = vi.fn();
    render(<ConflictDetail detail={detail} onClose={vi.fn()} onDecided={onDecided} />);
    expect(screen.getByRole('status')).toHaveTextContent('Decision recorded: approved');
    expect(onDecided).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close conflict detail' }));
  });

  it('has no detectable accessibility violations with complete evidence', async () => {
    const { container } = render(<ConflictDetail detail={conflictDetailFixture()} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no detectable accessibility violations with empty optional evidence', async () => {
    const { container } = render(<ConflictDetail detail={conflictDetailFixture({ proposal: null, lineage: [], audit: [] })} onClose={vi.fn()} onDecided={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
