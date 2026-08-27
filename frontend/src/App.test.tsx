import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import App from './App';
import { ApiError, decideProposal, getConflict, getConflicts, getIncidentGroups, getOverview, getProposals, getTickets } from './api';
import { conflictDetailFixture, conflictListFixture, overviewFixture, proposalFixture } from './test/fixtures';
import type * as ApiModule from './api';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    getOverview: vi.fn(),
    getConflicts: vi.fn(),
    getConflict: vi.fn(),
    getProposals: vi.fn(),
    getIncidentGroups: vi.fn(),
    getTickets: vi.fn(),
    decideProposal: vi.fn()
  };
});

const mockedGetOverview = vi.mocked(getOverview);
const mockedGetConflicts = vi.mocked(getConflicts);
const mockedGetConflict = vi.mocked(getConflict);
const mockedGetProposals = vi.mocked(getProposals);
const mockedGetIncidentGroups = vi.mocked(getIncidentGroups);
const mockedGetTickets = vi.mocked(getTickets);
const mockedDecideProposal = vi.mocked(decideProposal);

beforeEach(() => {
  mockedGetOverview.mockReset().mockResolvedValue(overviewFixture());
  mockedGetConflicts.mockReset().mockResolvedValue(conflictListFixture());
  mockedGetConflict.mockReset().mockResolvedValue(conflictDetailFixture());
  mockedGetProposals.mockReset().mockResolvedValue([proposalFixture()]);
  mockedGetIncidentGroups.mockReset().mockResolvedValue([]);
  mockedGetTickets.mockReset().mockResolvedValue([]);
  mockedDecideProposal.mockReset().mockResolvedValue(proposalFixture({ status: 'held', version: 2 }));
});

async function renderLoadedApp() {
  const result = render(<App />);
  await screen.findByRole('heading', { name: 'Start with the evidence' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Expand Find the conflicts' }));
  await user.click(screen.getByRole('button', { name: 'Expand Decide what to record' }));
  await screen.findAllByRole('button', { name: 'Paid But No Deal' });
  await screen.findByRole('heading', { name: 'Decide what to record' });
  return result;
}

describe('dashboard shell', () => {
  it('identifies Keystone and the reconciliation trust layer', async () => {
    await renderLoadedApp();
    expect(screen.getByRole('heading', { level: 1, name: 'Keystone' })).toBeInTheDocument();
    expect(screen.getByText('Reconciliation trust layer')).toBeInTheDocument();
  });

  it('renders a semantic main content region and footer guarantee', async () => {
    await renderLoadedApp();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByText('Proposals stay pending by default. Auto-apply is a separate gated function. Synthetic fixtures · no source writer.')).toBeInTheDocument();
  });

  it('shows evidence-connected only after overview resolution', async () => {
    await renderLoadedApp();
    expect(screen.getByText('Evidence connected')).toBeInTheDocument();
    expect(screen.getByText('Evidence connected').querySelector('.status-symbol')).toHaveTextContent('✓');
  });

  it('opens only the first accordion at startup', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Start with the evidence' });
    await screen.findByRole('heading', { name: 'Add support context' });
    expect(screen.getByRole('button', { name: 'Collapse Start with the evidence' })).toHaveAttribute('aria-expanded', 'true');
    for (const title of ['Find the conflicts', 'See the bigger pattern', 'Decide what to record', 'Add support context']) {
      expect(screen.getByRole('button', { name: `Expand ${title}` })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(document.getElementById('conflict-evidence-accordion-panel')).toHaveAttribute('hidden');
  });

  it('requests overview, active conflicts, and pending proposals at startup', async () => {
    await renderLoadedApp();
    expect(mockedGetOverview).toHaveBeenCalledOnce();
    expect(mockedGetConflicts).toHaveBeenCalledOnce();
    expect(mockedGetConflicts.mock.calls[0]?.[0]).toEqual({ type: '', source: '', status: 'active', proposalStatus: '', minimumConfidence: '', from: '' });
    expect(mockedGetConflicts.mock.calls[0]?.[1]).toBeUndefined();
    expect(mockedGetProposals).toHaveBeenCalledOnce();
    expect(mockedGetProposals.mock.calls[0]?.[0]).toBe('pending');
    expect(mockedGetProposals.mock.calls[0]?.[2]).toEqual({ type: '', source: '' });
    expect(mockedGetOverview.mock.calls[0]?.[1]).toBe('');
    expect(mockedGetIncidentGroups).toHaveBeenCalledOnce();
    expect(mockedGetTickets).toHaveBeenCalledOnce();
    expect(mockedGetConflict).not.toHaveBeenCalled();
  });

  it('supplies independent abort signals to every initial request', async () => {
    await renderLoadedApp();
    expect(mockedGetOverview.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(mockedGetConflicts.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    expect(mockedGetProposals.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect(mockedGetIncidentGroups.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(mockedGetTickets.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(mockedGetOverview.mock.calls[0]?.[0]).not.toBe(mockedGetConflicts.mock.calls[0]?.[2]);
  });

  it('aborts every active initial request on unmount', async () => {
    const { unmount } = await renderLoadedApp();
    const overviewSignal = mockedGetOverview.mock.calls[0]?.[0];
    const conflictSignal = mockedGetConflicts.mock.calls[0]?.[2];
    const proposalSignal = mockedGetProposals.mock.calls[0]?.[1];
    const groupSignal = mockedGetIncidentGroups.mock.calls[0]?.[0];
    const ticketSignal = mockedGetTickets.mock.calls[0]?.[0];
    expect(overviewSignal?.aborted).toBe(false);
    expect(conflictSignal?.aborted).toBe(false);
    expect(proposalSignal?.aborted).toBe(false);
    expect(groupSignal?.aborted).toBe(false);
    expect(ticketSignal?.aborted).toBe(false);
    unmount();
    expect(overviewSignal?.aborted).toBe(true);
    expect(conflictSignal?.aborted).toBe(true);
    expect(proposalSignal?.aborted).toBe(true);
    expect(groupSignal?.aborted).toBe(true);
    expect(ticketSignal?.aborted).toBe(true);
  });
});

describe('dashboard loading states', () => {
  it('shows one startup gate before requesting the remaining evidence surfaces', () => {
    mockedGetOverview.mockReturnValue(new Promise(() => undefined));
    mockedGetConflicts.mockReturnValue(new Promise(() => undefined));
    mockedGetProposals.mockReturnValue(new Promise(() => undefined));
    mockedGetIncidentGroups.mockReturnValue(new Promise(() => undefined));
    mockedGetTickets.mockReturnValue(new Promise(() => undefined));
    render(<App />);
    expect(screen.getByText('Starting backend')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Starting demo backend' })).toBeInTheDocument();
    expect(screen.getByText('Connecting to the transient backend and checking its evidence baseline…').closest('[aria-busy="true"]')).toBeInTheDocument();
    expect(mockedGetConflicts).not.toHaveBeenCalled();
    expect(mockedGetProposals).not.toHaveBeenCalled();
    expect(mockedGetIncidentGroups).not.toHaveBeenCalled();
    expect(mockedGetTickets).not.toHaveBeenCalled();
  });

  it('renders distinct loading states once the baseline is ready and evidence requests are pending', async () => {
    mockedGetConflicts.mockReturnValue(new Promise(() => undefined));
    mockedGetProposals.mockReturnValue(new Promise(() => undefined));
    mockedGetIncidentGroups.mockReturnValue(new Promise(() => undefined));
    mockedGetTickets.mockReturnValue(new Promise(() => undefined));
    render(<App />);
    await screen.findByRole('heading', { name: 'Start with the evidence' });
    expect(screen.getByText('Checking this evidence window…')).toBeInTheDocument();
    expect(screen.getByText('Loading proposal queue…')).toBeInTheDocument();
    expect(screen.getByText('Loading incident groups…')).toBeInTheDocument();
    expect(screen.getByText('Loading support tickets…')).toBeInTheDocument();
    expect(screen.getAllByText(/Loading|Checking/u).every((element) => element.closest('[aria-busy="true"]') !== null)).toBe(true);
  });

  it('keeps the proposal queue open when its loading state is replaced with results', async () => {
    let resolveProposals: ((proposals: ReturnType<typeof proposalFixture>[]) => void) | undefined;
    mockedGetProposals.mockImplementation(() => new Promise((resolve) => { resolveProposals = resolve; }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Start with the evidence' });
    await user.click(screen.getByRole('button', { name: 'Expand Decide what to record' }));
    expect(screen.getByText('Loading proposal queue…')).toBeVisible();

    await act(async () => resolveProposals?.([proposalFixture()]));

    expect(await screen.findByRole('combobox', { name: 'Review state' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Collapse Decide what to record' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('automatically retries while the transient backend restores its baseline', async () => {
    vi.useFakeTimers();
    try {
      mockedGetOverview
        .mockRejectedValueOnce(new ApiError(503, 'bootstrap_in_progress', 'The transient demo data is being restored.'))
        .mockResolvedValueOnce(overviewFixture());
      render(<App />);
      await act(async () => Promise.resolve());
      expect(screen.getByRole('heading', { name: 'Restoring demo data' })).toBeInTheDocument();
      expect(screen.getByText(/up to 2 minutes.*One moment, please.*page will refresh automatically/u)).toBeInTheDocument();
      expect(mockedGetConflicts).not.toHaveBeenCalled();

      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(mockedGetOverview).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('heading', { name: 'Start with the evidence' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables refresh while conflict evidence is loading', async () => {
    mockedGetConflicts.mockReturnValue(new Promise(() => undefined));
    render(<App />);
    await screen.findByRole('heading', { name: 'Start with the evidence' });
    expect(screen.getByRole('button', { name: 'Refresh evidence' })).toBeDisabled();
  });

  it('disables conflict filters while conflict evidence is loading', async () => {
    const user = userEvent.setup();
    mockedGetConflicts.mockReturnValue(new Promise(() => undefined));
    render(<App />);
    await screen.findByRole('heading', { name: 'Start with the evidence' });
    await user.click(screen.getByRole('button', { name: 'Expand Find the conflicts' }));
    expect(screen.getByRole('group', { name: 'Filter conflicts' })).toBeDisabled();
  });

  it('does not render a detail request before a row is selected', async () => {
    await renderLoadedApp();
    expect(screen.queryByText('Loading lineage and audit evidence…')).not.toBeInTheDocument();
    expect(mockedGetConflict).not.toHaveBeenCalled();
  });
});

describe('partial-source evidence', () => {
  it.each([
    ['crm', { app: 'complete', crm: 'partial', payments: 'complete' }],
    ['payments', { app: 'complete', crm: 'complete', payments: 'failed' }],
    ['app', { app: 'failed', crm: 'complete', payments: 'complete' }]
  ] as const)('warns when %s is incomplete', async (source, source_availability) => {
    const overview = overviewFixture();
    overview.latestRun = { ...overview.latestRun!, status: 'partial', source_availability };
    mockedGetOverview.mockResolvedValue(overview);
    await renderLoadedApp();
    const banner = screen.getByText('Incomplete source evidence').closest('[role="status"]');
    expect(banner).toBeInstanceOf(HTMLElement);
    if (!(banner instanceof HTMLElement)) throw new Error('expected status banner');
    expect(within(banner).getByText(new RegExp(`${source} did not complete`, 'u'))).toBeInTheDocument();
    expect(within(banner).getByText(/Dependent rules are unchecked; absence has not been inferred/u)).toBeInTheDocument();
  });

  it('lists every incomplete source in stable source-object order', async () => {
    const overview = overviewFixture();
    overview.latestRun = { ...overview.latestRun!, status: 'partial', source_availability: { app: 'failed', crm: 'partial', payments: 'complete' } };
    mockedGetOverview.mockResolvedValue(overview);
    await renderLoadedApp();
    expect(screen.getByText(/app, crm did not complete/u)).toBeInTheDocument();
  });

  it('does not show a partial warning for complete evidence', async () => {
    await renderLoadedApp();
    expect(screen.queryByText('Incomplete source evidence')).not.toBeInTheDocument();
  });

  it('does not show a partial warning before any run exists', async () => {
    mockedGetOverview.mockResolvedValue(overviewFixture({ latestRun: null }));
    await renderLoadedApp();
    expect(screen.queryByText('Incomplete source evidence')).not.toBeInTheDocument();
  });
});

describe('overview failure and retry', () => {
  it('renders a request-correlated API error', async () => {
    mockedGetOverview.mockRejectedValue(new ApiError(503, 'degraded', 'A source is unavailable.', 'request-overview'));
    render(<App />);
    const panel = await screen.findByRole('alert');
    expect(within(panel).getByRole('heading', { name: 'Overview unavailable' })).toBeInTheDocument();
    expect(within(panel).getByText('A source is unavailable. Request request-overview.')).toBeInTheDocument();
    expect(screen.getByText('API unavailable')).toBeInTheDocument();
  });

  it('renders an API error without inventing a missing request ID', async () => {
    mockedGetOverview.mockRejectedValue(new ApiError(500, 'internal_error', 'Overview failed.'));
    render(<App />);
    expect(await screen.findByText('Overview failed.')).toBeInTheDocument();
    expect(screen.queryByText(/Request/u)).not.toBeInTheDocument();
  });

  it('renders a generic Error message', async () => {
    mockedGetOverview.mockRejectedValue(new Error('Network unavailable'));
    render(<App />);
    expect(await screen.findByText('Network unavailable')).toBeInTheDocument();
  });

  it('renders a safe fallback for a non-Error failure', async () => {
    mockedGetOverview.mockRejectedValue('offline');
    render(<App />);
    expect(await screen.findByText('The dashboard could not load this evidence window.')).toBeInTheDocument();
  });

  it('does not turn an intentional AbortError into a visible failure', async () => {
    mockedGetOverview.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    render(<App />);
    await waitFor(() => expect(mockedGetOverview).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overview unavailable' })).not.toBeInTheDocument();
  });

  it('retries all coupled evidence windows from overview retry', async () => {
    const user = userEvent.setup();
    mockedGetOverview.mockRejectedValueOnce(new Error('First overview failure')).mockResolvedValueOnce(overviewFixture());
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Retry overview' }));
    expect(await screen.findByRole('heading', { name: 'Start with the evidence' })).toBeInTheDocument();
    expect(mockedGetOverview).toHaveBeenCalledTimes(2);
    expect(mockedGetConflicts).toHaveBeenCalledTimes(2);
    expect(mockedGetProposals).toHaveBeenCalledTimes(2);
    expect(mockedGetIncidentGroups).toHaveBeenCalledTimes(2);
    expect(mockedGetTickets).toHaveBeenCalledTimes(2);
  });
});

describe('conflict evidence interactions', () => {
  it('explains the result and offers task-oriented review shortcuts', async () => {
    await renderLoadedApp();
    expect(screen.getByText('02 · Investigate')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Turn a repeatable failure into a safe decision' })).toBeInTheDocument();
    expect(screen.getByText(/Unchecked is not clean/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active failures' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Results summary' })).toHaveTextContent('2 conflicts on this page · more results available');
    expect(screen.getByRole('columnheader', { name: 'Affected records' })).toBeInTheDocument();
  });

  it('loads the pending-review shortcut as an active conflict filter', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    await user.click(screen.getByRole('button', { name: 'Pending review' }));
    await waitFor(() => expect(mockedGetConflicts).toHaveBeenCalledTimes(2));
    expect(mockedGetConflicts.mock.calls[1]?.[0]).toMatchObject({ status: 'active', proposalStatus: 'pending' });
    expect(mockedGetConflicts.mock.calls[1]?.[1]).toBeUndefined();
  });

  it('renders a request-correlated conflict list error independently', async () => {
    const user = userEvent.setup();
    mockedGetConflicts.mockRejectedValue(new ApiError(400, 'invalid_request', 'Conflict window invalid.', 'request-conflicts'));
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Expand Find the conflicts' }));
    const panel = await screen.findByRole('alert');
    expect(within(panel).getByRole('heading', { name: 'Conflicts unavailable' })).toBeInTheDocument();
    expect(within(panel).getByText('Conflict window invalid. Request request-conflicts.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start with the evidence' })).toBeInTheDocument();
  });

  it('retries all evidence windows from conflict retry', async () => {
    const user = userEvent.setup();
    mockedGetConflicts.mockRejectedValueOnce(new Error('First conflict failure')).mockResolvedValueOnce(conflictListFixture());
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Expand Find the conflicts' }));
    await user.click(await screen.findByRole('button', { name: 'Retry conflicts' }));
    await user.click(await screen.findByRole('button', { name: 'Expand Find the conflicts' }));
    await user.click(await screen.findByRole('button', { name: 'Expand Decide what to record' }));
    expect(await screen.findAllByRole('button', { name: 'Paid But No Deal' })).toHaveLength(2);
    expect(mockedGetOverview).toHaveBeenCalledTimes(2);
    expect(mockedGetConflicts).toHaveBeenCalledTimes(2);
    expect(mockedGetProposals).toHaveBeenCalledTimes(2);
    expect(mockedGetIncidentGroups).toHaveBeenCalledTimes(2);
    expect(mockedGetTickets).toHaveBeenCalledTimes(2);
  });

  it('refreshes all evidence windows from the explicit refresh button', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    await user.click(screen.getByRole('button', { name: 'Refresh evidence' }));
    await waitFor(() => expect(mockedGetOverview).toHaveBeenCalledTimes(2));
    expect(mockedGetConflicts).toHaveBeenCalledTimes(2);
    expect(mockedGetProposals).toHaveBeenCalledTimes(2);
    expect(mockedGetIncidentGroups).toHaveBeenCalledTimes(2);
    expect(mockedGetTickets).toHaveBeenCalledTimes(2);
  });

  it('resets pagination and refetches when conflict type changes', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mockedGetConflicts).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Conflict type' }), 'duplicate_payment');
    await waitFor(() => expect(mockedGetConflicts).toHaveBeenCalledTimes(3));
    expect(mockedGetConflicts.mock.calls[2]?.[0]).toMatchObject({ type: 'duplicate_payment' });
    expect(mockedGetConflicts.mock.calls[2]?.[1]).toBeUndefined();
  });

  it.each([
    ['Source', 'payments', { source: 'payments' }],
    ['Conflict status', 'resolved', { status: 'resolved' }],
    ['Proposal status', 'held', { proposalStatus: 'held' }],
    ['Minimum confidence', '0.95', { minimumConfidence: '0.95' }]
  ] as const)('refetches when %s changes', async (label, value, expected) => {
    const user = userEvent.setup();
    await renderLoadedApp();
    await user.selectOptions(screen.getByRole('combobox', { name: label }), value);
    await waitFor(() => expect(mockedGetConflicts).toHaveBeenCalledTimes(2));
    expect(mockedGetConflicts.mock.calls[1]?.[0]).toMatchObject(expected);
  });

  it('loads the next opaque cursor page', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mockedGetConflicts).toHaveBeenCalledTimes(2));
    expect(mockedGetConflicts.mock.calls[1]?.[1]).toBe('next-page-cursor');
    expect(screen.getByRole('button', { name: 'First page' })).toBeEnabled();
  });

  it('returns to the first page', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mockedGetConflicts).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'First page' }));
    await waitFor(() => expect(mockedGetConflicts).toHaveBeenCalledTimes(3));
    expect(mockedGetConflicts.mock.calls[2]?.[1]).toBeUndefined();
  });

  it('disables next page when the API returns no cursor', async () => {
    mockedGetConflicts.mockResolvedValue(conflictListFixture({ nextCursor: null }));
    await renderLoadedApp();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});

describe('proposal queue interactions', () => {
  it('renders a proposal error independently', async () => {
    const user = userEvent.setup();
    mockedGetProposals.mockRejectedValue(new ApiError(503, 'unavailable', 'Queue unavailable.', 'request-queue'));
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Expand Decide what to record' }));
    const panel = await screen.findByRole('alert');
    expect(within(panel).getByRole('heading', { name: 'Decision queue unavailable' })).toBeInTheDocument();
    expect(within(panel).getByText('Queue unavailable. Request request-queue.')).toBeInTheDocument();
  });

  it('retries all windows from queue retry', async () => {
    const user = userEvent.setup();
    mockedGetProposals.mockRejectedValueOnce(new Error('First queue failure')).mockResolvedValueOnce([proposalFixture()]);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Expand Decide what to record' }));
    await user.click(await screen.findByRole('button', { name: 'Retry decisions' }));
    await waitFor(() => {
      expect(mockedGetProposals).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('heading', { name: 'Decide what to record' })).toBeInTheDocument();
    });
    expect(mockedGetOverview).toHaveBeenCalledTimes(2);
    expect(mockedGetConflicts).toHaveBeenCalledTimes(2);
    expect(mockedGetProposals).toHaveBeenCalledTimes(2);
    expect(mockedGetIncidentGroups).toHaveBeenCalledTimes(2);
    expect(mockedGetTickets).toHaveBeenCalledTimes(2);
  });

  it.each(['', 'approved', 'rejected', 'held', 'applied', 'rolled_back'])('refetches queue status %j', async (status) => {
    const user = userEvent.setup();
    await renderLoadedApp();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Review state' }), status);
    await waitFor(() => expect(mockedGetProposals).toHaveBeenCalledTimes(2));
    expect(mockedGetProposals.mock.calls[1]?.[0]).toBe(status);
  });
});

describe('conflict detail interactions', () => {
  it('loads lineage and audit only after selecting a conflict', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    await user.click(screen.getAllByRole('button', { name: 'Paid But No Deal' })[0]!);
    expect(await screen.findByRole('dialog', { name: 'Paid But No Deal' })).toBeInTheDocument();
    expect(mockedGetConflict).toHaveBeenCalledWith('conflict_paid_fixture', expect.any(AbortSignal));
  });

  it('opens conflict detail from the proposal queue', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    const buttons = screen.getAllByRole('button', { name: 'Paid But No Deal' });
    await user.click(buttons.at(-1)!);
    expect(await screen.findByRole('dialog', { name: 'Paid But No Deal' })).toBeInTheDocument();
    expect(mockedGetConflict).toHaveBeenCalledWith('conflict_paid_fixture', expect.any(AbortSignal));
  });

  it('shows a loading detail panel while evidence is in flight', async () => {
    const user = userEvent.setup();
    mockedGetConflict.mockReturnValue(new Promise(() => undefined));
    await renderLoadedApp();
    await user.click(screen.getAllByRole('button', { name: 'Paid But No Deal' })[0]!);
    expect(screen.getByText('Loading lineage and audit evidence…')).toBeInTheDocument();
    expect(screen.getByText('Loading lineage and audit evidence…').closest('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('closes a loading detail without waiting for its request', async () => {
    const user = userEvent.setup();
    mockedGetConflict.mockReturnValue(new Promise(() => undefined));
    await renderLoadedApp();
    await user.click(screen.getAllByRole('button', { name: 'Paid But No Deal' })[0]!);
    const signal = mockedGetConflict.mock.calls[0]?.[1];
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Loading lineage and audit evidence…')).not.toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
  });

  it('closes loaded detail from its accessible close button', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    await user.click(screen.getAllByRole('button', { name: 'Paid But No Deal' })[0]!);
    await screen.findByRole('dialog', { name: 'Paid But No Deal' });
    await user.click(screen.getByRole('button', { name: 'Close conflict detail' }));
    expect(screen.queryByRole('dialog', { name: 'Paid But No Deal' })).not.toBeInTheDocument();
  });

  it('renders a correlated detail failure with retry and close', async () => {
    const user = userEvent.setup();
    mockedGetConflict.mockRejectedValue(new ApiError(404, 'not_found', 'Conflict not found.', 'request-detail'));
    await renderLoadedApp();
    await user.click(screen.getAllByRole('button', { name: 'Paid But No Deal' })[0]!);
    const panel = await screen.findByRole('dialog', { name: 'Conflict detail unavailable' });
    expect(within(panel).getByRole('heading', { name: 'Conflict detail unavailable' })).toBeInTheDocument();
    expect(within(panel).getByText('Conflict not found. Request request-detail.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Retry detail' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('retries detail together with the coherent evidence window', async () => {
    const user = userEvent.setup();
    mockedGetConflict.mockRejectedValueOnce(new Error('First detail failure')).mockResolvedValueOnce(conflictDetailFixture());
    await renderLoadedApp();
    await user.click(screen.getAllByRole('button', { name: 'Paid But No Deal' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'Retry detail' }));
    expect(await screen.findByRole('dialog', { name: 'Paid But No Deal' })).toBeInTheDocument();
    expect(mockedGetConflict).toHaveBeenCalledTimes(2);
    expect(mockedGetOverview).toHaveBeenCalledTimes(2);
    expect(mockedGetConflicts).toHaveBeenCalledTimes(2);
    expect(mockedGetProposals).toHaveBeenCalledTimes(2);
    expect(mockedGetIncidentGroups).toHaveBeenCalledTimes(2);
    expect(mockedGetTickets).toHaveBeenCalledTimes(2);
  });

  it('closes a detail error panel without retrying', async () => {
    const user = userEvent.setup();
    mockedGetConflict.mockRejectedValue(new Error('Detail failure'));
    await renderLoadedApp();
    await user.click(screen.getAllByRole('button', { name: 'Paid But No Deal' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { name: 'Conflict detail unavailable' })).not.toBeInTheDocument();
    expect(mockedGetConflict).toHaveBeenCalledOnce();
  });
});

describe('review decision integration', () => {
  it('announces a recorded decision and refreshes every evidence view', async () => {
    const user = userEvent.setup();
    mockedDecideProposal.mockResolvedValue(proposalFixture({ status: 'held', version: 2 }));
    await renderLoadedApp();
    await user.click(screen.getAllByRole('button', { name: 'Paid But No Deal' })[0]!);
    await screen.findByRole('dialog', { name: 'Paid But No Deal' });
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Needs more evidence');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/u }));
    await user.click(screen.getByRole('button', { name: 'Confirm hold' }));
    expect(await screen.findByText('Proposal held. Source systems remain unchanged.')).toBeInTheDocument();
    await waitFor(() => expect(mockedGetOverview).toHaveBeenCalledTimes(2));
    expect(mockedGetConflicts).toHaveBeenCalledTimes(2);
    expect(mockedGetProposals).toHaveBeenCalledTimes(2);
    expect(mockedGetIncidentGroups).toHaveBeenCalledTimes(2);
    expect(mockedGetTickets).toHaveBeenCalledTimes(2);
    expect(mockedGetConflict).toHaveBeenCalledTimes(2);
  });
});

describe('dashboard accessibility', () => {
  it('has no detectable accessibility violations in the complete state', async () => {
    const { container } = await renderLoadedApp();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no detectable accessibility violations with an open detail', async () => {
    const user = userEvent.setup();
    const { container } = await renderLoadedApp();
    await user.click(screen.getAllByRole('button', { name: 'Paid But No Deal' })[0]!);
    await screen.findByRole('dialog', { name: 'Paid But No Deal' });
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no detectable accessibility violations in an error state', async () => {
    mockedGetOverview.mockRejectedValue(new ApiError(503, 'degraded', 'A source is unavailable.', 'request-a11y'));
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'Overview unavailable' });
    expect((await axe(container)).violations).toEqual([]);
  });
});
