import { render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { overviewFixture, FIXED_TIME } from '../test/fixtures';
import { Overview } from './Overview';

describe('trust overview', () => {
  it('labels the region and evidence window', () => {
    render(<Overview overview={overviewFixture()} />);
    expect(screen.getByRole('heading', { name: 'Start with the evidence' })).toBeInTheDocument();
    expect(screen.getByText('01 · Orient')).toBeInTheDocument();
  });

  it('shows the selected evidence-window start without relying on color', () => {
    render(<Overview overview={overviewFixture({ evidenceWindow: { from: FIXED_TIME } })} />);
    expect(screen.getByText(`Conflicts and proposals last seen from ${new Date(FIXED_TIME).toLocaleString()}`)).toBeInTheDocument();
  });

  it('renders active conflicts with thousands separators', () => {
    render(<Overview overview={overviewFixture()} />);
    const card = screen.getByText('Active conflicts').closest('article')!;
    expect(within(card).getByText('3,050')).toBeInTheDocument();
    expect(within(card).getByText('3,049 proposals awaiting review · 25 resolved')).toBeInTheDocument();
  });

  it('finds the pending queue count regardless of proposal order', () => {
    const overview = overviewFixture({ proposals: [{ status: 'rejected', count: 5 }, { status: 'pending', count: 42 }] });
    render(<Overview overview={overview} />);
    const card = screen.getByText('Pending review').closest('article')!;
    expect(within(card).getByText('42')).toBeInTheDocument();
    expect(within(card).getByText('0 held · source writes: zero')).toBeInTheDocument();
  });

  it('shows zero when there is no pending proposal group', () => {
    render(<Overview overview={overviewFixture({ proposals: [{ status: 'approved', count: 4 }] })} />);
    expect(within(screen.getByText('Pending review').closest('article')!).getByText('0')).toBeInTheDocument();
  });

  it('shows unchecked rules distinctly from passes and failures', () => {
    const overview = overviewFixture({
      invariant: {
        status: 'partial',
        summary: { pass: 100, fail: 2, unchecked: 17, error: 0 },
        source_availability: { app: 'complete', crm: 'partial', payments: 'complete' },
        completed_at: '2026-01-15T12:00:00.000Z'
      }
    });
    render(<Overview overview={overview} />);
    const card = screen.getByText('Evidence coverage').closest('article')!;
    expect(within(card).getByText('Latest run · 102 of 119 checked · 2 failures · 17 unavailable')).toBeInTheDocument();
    expect(within(card).getByText('85.7%')).toBeInTheDocument();
  });

  it('shows zero unchecked rules before any invariant run', () => {
    render(<Overview overview={overviewFixture({ invariant: null })} />);
    expect(within(screen.getByText('Evidence coverage').closest('article')!).getByText('—')).toBeInTheDocument();
  });

  it.each([
    ['0', '$0.0000'],
    ['1', '$0.0000'],
    ['100000000', '$1.0000'],
    ['125000000', '$1.2500']
  ])('formats %s microcents as %s', (actual, expected) => {
    render(<Overview overview={overviewFixture({ spend: { cap_microcents: '500000000', reserved_microcents: actual, actual_microcents: actual, released_microcents: '0' } })} />);
    const card = screen.getByText('Daily spend').closest('article')!;
    expect(within(card).getByText(expected)).toBeInTheDocument();
    expect(within(card).getByText(/of \$5\.0000 cap/u)).toBeInTheDocument();
  });

  it('shows the latest sync status with text and symbol', () => {
    render(<Overview overview={overviewFixture()} />);
    const badge = screen.getByText('Sync complete');
    expect(badge).toBeInTheDocument();
    expect(badge.querySelector('.status-symbol')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows an explicit not-synced state', () => {
    render(<Overview overview={overviewFixture({ latestRun: null })} />);
    expect(screen.getByText('Not synced')).toBeInTheDocument();
  });

  it('lists all source freshness cards with record counts and generations', () => {
    render(<Overview overview={overviewFixture()} />);
    const region = screen.getByLabelText('Source freshness');
    expect(within(region).getByText('APP')).toBeInTheDocument();
    expect(within(region).getByText('CRM')).toBeInTheDocument();
    expect(within(region).getByText('PAYMENTS')).toBeInTheDocument();
    expect(within(region).getByText('47,000 records · generation 3')).toBeInTheDocument();
    expect(within(region).getByText('55,000 records · generation 3')).toBeInTheDocument();
    expect(within(region).getByText('18,000 records · generation 3')).toBeInTheDocument();
  });

  it('uses machine-readable source freshness times', () => {
    render(<Overview overview={overviewFixture()} />);
    const times = screen.getAllByText(/1\/15\/2026/u, { selector: 'time' });
    expect(times).toHaveLength(3);
    expect(times.every((element) => element.getAttribute('datetime') === '2026-01-15T12:00:00.000Z')).toBe(true);
  });

  it('shows source status as text rather than color alone', () => {
    const overview = overviewFixture();
    overview.sources[1]!.status = 'partial';
    render(<Overview overview={overview} />);
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getAllByText('△').every((element) => element.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('renders a defined empty source state', () => {
    render(<Overview overview={overviewFixture({ sources: [] })} />);
    expect(screen.getByText('No complete source snapshot is active yet.')).toBeInTheDocument();
  });

  it('shows auto-applied and incident-group stretch metrics', () => {
    render(<Overview overview={overviewFixture({ proposals: [{ status: 'applied', count: 18 }, { status: 'pending', count: 3032 }] })} />);
    expect(within(screen.getByText('Auto-applied').closest('article')!).getByText('18')).toBeInTheDocument();
    expect(within(screen.getByText('Incident groups').closest('article')!).getByText('14')).toBeInTheDocument();
    expect(screen.getByText('3,050 extracted tickets')).toBeInTheDocument();
  });

  it('documents log redaction and retention without color-only state', () => {
    render(<Overview overview={overviewFixture()} />);
    expect(screen.getByText(/Safety: redacted logs · retain 30 days/u)).toBeInTheDocument();
    expect(screen.getByText(/append-only hashed metadata/u)).toBeInTheDocument();
  });

  it('turns the evidence state into a reviewer decision brief', () => {
    render(<Overview overview={overviewFixture()} />);
    expect(screen.getByRole('heading', { name: 'Ready for guarded review' })).toBeInTheDocument();
    expect(screen.getByText('Review before approving')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review 3,049 pending proposals' })).toHaveAttribute('href', '#conflicts-heading');
    expect(screen.getByText('100.0% checked')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 complete')).toBeInTheDocument();
  });

  it('shows that dashboard figures match the underlying logs', () => {
    render(<Overview overview={overviewFixture()} />);
    expect(screen.getByText('Reconciled')).toBeInTheDocument();
  });

  it('surfaces a mismatched evidence window as more than color', () => {
    render(<Overview overview={overviewFixture({
      reconciliation: {
        ok: false,
        checks: [
          { name: 'conflicts_match_invariant_fail', actual: 12, expected: 3050, ok: false },
          { name: 'spend_within_daily_cap', actual: 1, expected: 1, ok: true }
        ]
      }
    })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Dashboard figures do not match logs');
    expect(screen.getByText(/conflicts match invariant fail: 12 vs 3050/u)).toBeInTheDocument();
  });

  it('shows a spend-cap alert in visible text', () => {
    render(<Overview overview={overviewFixture({
      latestAlert: {
        alert_type: 'spend_cap_reached',
        severity: 'critical',
        message: 'daily spend cap reached',
        created_at: FIXED_TIME
      }
    })} />);
    expect(screen.getByText('Critical alert')).toBeInTheDocument();
    expect(screen.getByText('daily spend cap reached')).toBeInTheDocument();
  });

  it('has no detectable accessibility violations in complete state', async () => {
    const { container } = render(<Overview overview={overviewFixture()} />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no detectable accessibility violations in empty state', async () => {
    const { container } = render(<Overview overview={overviewFixture({ sources: [], latestRun: null, invariant: null })} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
