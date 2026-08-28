import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getConflict, getConflicts, getIncidentGroups, getOverview, getProposals, getTickets } from './api';
import { ConflictDetail } from './components/ConflictDetail';
import { ConflictEvidence, conflictPresetFilters } from './components/ConflictEvidence';
import { ConflictFiltersForm, ConflictTable, EMPTY_FILTERS } from './components/ConflictTable';
import { dashboardStory } from './components/dashboardStory';
import { DashboardSection } from './components/DashboardSection';
import { IncidentGroups } from './components/IncidentGroups';
import { Overview } from './components/Overview';
import { ProposalQueue } from './components/ProposalQueue';
import { StatusBadge } from './components/StatusBadge';
import { TicketTable } from './components/TicketTable';
import type { ConflictDetail as ConflictDetailType, ConflictFilters, ConflictList, ExtractedTicket, IncidentGroup, OverviewData, Proposal } from './types';

interface LoadState<T> { loading: boolean; data: T | null; error: string; }
type BootstrapPhase = 'checking' | 'restoring' | 'open';
const loading = <T,>(): LoadState<T> => ({ loading: true, data: null, error: '' });
const bootstrapRetryMs = 1_000;

function failureMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  if (error instanceof ApiError) return `${error.message}${error.requestId ? ` Request ${error.requestId}.` : ''}`;
  return error instanceof Error ? error.message : 'The dashboard could not load this evidence window.';
}

function isTransientBootstrap(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503 && (error.code === 'bootstrap_in_progress' || error.code === 'backend_unavailable');
}

export default function App() {
  const [filters, setFilters] = useState<ConflictFilters>(EMPTY_FILTERS);
  const [cursor, setCursor] = useState<string | undefined>();
  const [overview, setOverview] = useState<LoadState<OverviewData>>(loading);
  const [conflicts, setConflicts] = useState<LoadState<ConflictList>>(loading);
  const [proposalStatus, setProposalStatus] = useState('pending');
  const [proposalType, setProposalType] = useState('');
  const [proposalSource, setProposalSource] = useState('');
  const [proposals, setProposals] = useState<LoadState<Proposal[]>>(loading);
  const [groups, setGroups] = useState<LoadState<IncidentGroup[]>>(loading);
  const [tickets, setTickets] = useState<LoadState<ExtractedTicket[]>>(loading);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LoadState<ConflictDetailType>>({ loading: false, data: null, error: '' });
  const [refresh, setRefresh] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>('checking');
  const selectedTriggerId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void getOverview(controller.signal, filters.from).then((data) => {
      setOverview({ loading: false, data, error: '' });
      setBootstrapPhase('open');
    }).catch((error: unknown) => {
      if (isTransientBootstrap(error)) {
        setBootstrapPhase('restoring');
        retryTimer = setTimeout(() => setRefresh((value) => value + 1), bootstrapRetryMs);
        return;
      }
      const message = failureMessage(error);
      if (message) setOverview({ loading: false, data: null, error: message });
      setBootstrapPhase('open');
    });
    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [refresh, filters.from]);

  useEffect(() => {
    if (bootstrapPhase !== 'open') return;
    const controller = new AbortController();
    void getConflicts(filters, cursor, controller.signal).then((data) => setConflicts({ loading: false, data, error: '' })).catch((error: unknown) => { const message = failureMessage(error); if (message) setConflicts({ loading: false, data: null, error: message }); });
    return () => controller.abort();
  }, [filters, cursor, refresh, bootstrapPhase]);

  useEffect(() => {
    if (bootstrapPhase !== 'open') return;
    const controller = new AbortController();
    void getProposals(proposalStatus, controller.signal, { type: proposalType, source: proposalSource }).then((data) => setProposals({ loading: false, data, error: '' })).catch((error: unknown) => { const message = failureMessage(error); if (message) setProposals({ loading: false, data: null, error: message }); });
    return () => controller.abort();
  }, [proposalStatus, proposalType, proposalSource, refresh, bootstrapPhase]);

  useEffect(() => {
    if (bootstrapPhase !== 'open') return;
    const controller = new AbortController();
    void getIncidentGroups(controller.signal).then((data) => setGroups({ loading: false, data, error: '' })).catch((error: unknown) => { const message = failureMessage(error); if (message) setGroups({ loading: false, data: null, error: message }); });
    return () => controller.abort();
  }, [refresh, bootstrapPhase]);

  useEffect(() => {
    if (bootstrapPhase !== 'open') return;
    const controller = new AbortController();
    void getTickets(controller.signal).then((data) => setTickets({ loading: false, data, error: '' })).catch((error: unknown) => { const message = failureMessage(error); if (message) setTickets({ loading: false, data: null, error: message }); });
    return () => controller.abort();
  }, [refresh, bootstrapPhase]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void getConflict(selectedId, controller.signal).then((data) => setDetail({ loading: false, data, error: '' })).catch((error: unknown) => { const message = failureMessage(error); if (message) setDetail({ loading: false, data: null, error: message }); });
    return () => controller.abort();
  }, [selectedId, refresh]);

  const partialSources = useMemo(() => overview.data?.latestRun ? Object.entries(overview.data.latestRun.source_availability).filter(([, status]) => status !== 'complete').map(([source]) => source) : [], [overview.data]);
  const retry = () => {
    setOverview(loading());
    setConflicts(loading());
    setProposals(loading());
    setGroups(loading());
    setTickets(loading());
    setBootstrapPhase('checking');
    if (selectedId) setDetail(loading());
    setRefresh((value) => value + 1);
  };
  const changeFilters = (next: ConflictFilters) => { setConflicts(loading()); setCursor(undefined); setFilters(next); };
  const applyConflictPreset = (preset: 'active' | 'pending' | 'unchecked') => changeFilters(conflictPresetFilters(preset));
  const changePage = (nextCursor?: string) => { setConflicts(loading()); setCursor(nextCursor); };
  const changeProposalStatus = (status: string) => { setProposals(loading()); setProposalStatus(status); };
  const changeProposalType = (type: string) => { setProposals(loading()); setProposalType(type); };
  const changeProposalSource = (source: string) => { setProposals(loading()); setProposalSource(source); };
  const selectPattern = (pattern: string) => {
    changeFilters({ ...filters, type: pattern });
    requestAnimationFrame(() => {
      const heading = document.getElementById('conflicts-heading');
      if (!heading) return;
      heading.scrollIntoView?.({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      heading.focus({ preventScroll: true });
    });
  };
  const selectConflict = (id: string) => { selectedTriggerId.current = id; setDetail(loading()); setSelectedId(id); };
  const closeDetail = () => {
    setSelectedId(null);
    setDetail({ loading: false, data: null, error: '' });
    const triggerId = selectedTriggerId.current;
    requestAnimationFrame(() => {
      if (triggerId) [...document.querySelectorAll<HTMLButtonElement>('[data-conflict-id]')].find((button) => button.dataset.conflictId === triggerId)?.focus();
    });
  };
  const decided = (proposal: Proposal) => { setAnnouncement(`Proposal ${proposal.status}. Source systems remain unchanged.`); retry(); };

  return (
    <div className="app-shell">
      <header className="site-header"><div className="brand-mark" aria-hidden="true">K</div><div><p>Reconciliation trust layer</p><h1>Keystone</h1></div><div className="header-state"><StatusBadge status={overview.error ? 'failed' : bootstrapPhase !== 'open' || overview.loading ? 'pending' : 'complete'} label={overview.error ? 'API unavailable' : bootstrapPhase === 'restoring' ? 'Restoring demo data' : bootstrapPhase === 'checking' ? 'Starting backend' : overview.loading ? 'Refreshing evidence' : 'Evidence connected'} /></div></header>
      <main id="main-content">
        <p className="sr-only" aria-live="polite">{announcement}</p>
        {bootstrapPhase !== 'open' ? <section className="loading-panel bootstrap-loading" role="status" aria-live="polite" aria-busy="true"><span className="spinner" aria-hidden="true" /><h2>{bootstrapPhase === 'restoring' ? 'Restoring demo data' : 'Starting demo backend'}</h2><p>{bootstrapPhase === 'restoring' ? 'The transient backend reset, so Keystone is rebuilding the transient backend and its canonical synthetic evidence for this demo. This can take up to 2 minutes. One moment, please—the page will refresh automatically.' : 'Connecting to the transient backend and checking its evidence baseline…'}</p></section> : <>
        {partialSources.length ? <div className="warning-banner" role="status"><span aria-hidden="true">△</span><div><strong>Incomplete source evidence</strong><p>{partialSources.join(', ')} did not complete. Dependent rules are unchecked; absence has not been inferred.</p></div></div> : null}
        {overview.loading ? <DashboardSection id="trust-overview-section" headingId="overview-heading" descriptionId="overview-description" className="overview-section" heading={<div className="section-heading overview-heading"><div><p className="eyebrow">{dashboardStory.overview.step}</p><h2 id="overview-heading">{dashboardStory.overview.title}</h2><p id="overview-description" className="section-description">Loading the current evidence window so you can see what is verified and where to begin.</p></div></div>}><div className="loading-panel" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Loading current source and invariant evidence…</p></div></DashboardSection> : overview.error ? <DashboardSection id="trust-overview-section" headingId="overview-heading" descriptionId="overview-description" className="overview-section" heading={<div className="section-heading overview-heading"><div><p className="eyebrow">{dashboardStory.overview.step}</p><h2 id="overview-heading">{dashboardStory.overview.title}</h2><p id="overview-description" className="section-description">The current evidence window could not be loaded, so the review path cannot begin yet.</p></div></div>}><div className="error-panel" role="alert"><h2>Overview unavailable</h2><p>{overview.error}</p><button className="primary-button" type="button" onClick={retry}>Retry overview</button></div></DashboardSection> : overview.data ? <Overview overview={overview.data} /> : null}

        <DashboardSection id="conflict-evidence-section" headingId="conflicts-heading" descriptionId="conflicts-description" className="panel-section conflict-evidence-section" heading={<div className="section-heading"><div><p className="eyebrow">{dashboardStory.conflicts.step}</p><h2 id="conflicts-heading" tabIndex={-1}>{dashboardStory.conflicts.title}</h2><p id="conflicts-description" className="section-description">{dashboardStory.conflicts.description}</p></div><button type="button" className="secondary-button" onClick={retry} disabled={conflicts.loading}>Refresh evidence</button></div>}>
          <ConflictEvidence overview={overview.data} filters={filters} visibleCount={conflicts.data?.items.length ?? null} hasNextPage={Boolean(conflicts.data?.nextCursor)} disabled={conflicts.loading} onPreset={applyConflictPreset} />
          <ConflictFiltersForm filters={filters} onChange={changeFilters} disabled={conflicts.loading} />
          {conflicts.loading ? <div className="loading-panel inline-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Checking this evidence window…</p></div> : conflicts.error ? <div className="error-panel" role="alert"><h3>Conflicts unavailable</h3><p>{conflicts.error}</p><button className="primary-button" type="button" onClick={retry}>Retry conflicts</button></div> : conflicts.data ? <><ConflictTable rows={conflicts.data.items} selectedId={selectedId} onSelect={selectConflict} /><div className="pagination"><button type="button" className="secondary-button" onClick={() => changePage()} disabled={!cursor}>First page</button><button type="button" className="secondary-button" onClick={() => changePage(conflicts.data?.nextCursor ?? undefined)} disabled={!conflicts.data.nextCursor}>Next page</button></div></> : null}
        </DashboardSection>

        {groups.loading ? <DashboardSection id="incident-groups-section" headingId="groups-heading" descriptionId="groups-description" className="panel-section" heading={<div className="section-heading"><div><p className="eyebrow">{dashboardStory.groups.step}</p><h2 id="groups-heading">{dashboardStory.groups.title}</h2><p id="groups-description" className="section-description">{dashboardStory.groups.description}</p></div></div>}><div className="loading-panel inline-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Loading incident groups…</p></div></DashboardSection> : groups.error ? <DashboardSection id="incident-groups-section" headingId="groups-heading" descriptionId="groups-description" className="panel-section" heading={<div className="section-heading"><div><p className="eyebrow">{dashboardStory.groups.step}</p><h2 id="groups-heading">{dashboardStory.groups.title}</h2><p id="groups-description" className="section-description">{dashboardStory.groups.description}</p></div></div>}><div className="error-panel" role="alert"><h2>Pattern view unavailable</h2><p>{groups.error}</p><button type="button" className="primary-button" onClick={retry}>Retry patterns</button></div></DashboardSection> : groups.data ? <IncidentGroups groups={groups.data} groupedConflicts={overview.data?.stretch?.groupedConflicts} onPatternSelect={selectPattern} /> : null}
        {proposals.loading ? <DashboardSection id="proposal-queue-section" headingId="queue-heading" descriptionId="queue-description" className="panel-section" heading={<div className="section-heading"><div><p className="eyebrow">{dashboardStory.proposals.step}</p><h2 id="queue-heading">{dashboardStory.proposals.title}</h2><p id="queue-description" className="section-description">{dashboardStory.proposals.description}</p></div></div>}><div className="loading-panel inline-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Loading proposal queue…</p></div></DashboardSection> : proposals.error ? <DashboardSection id="proposal-queue-section" headingId="queue-heading" descriptionId="queue-description" className="panel-section" heading={<div className="section-heading"><div><p className="eyebrow">{dashboardStory.proposals.step}</p><h2 id="queue-heading">{dashboardStory.proposals.title}</h2><p id="queue-description" className="section-description">{dashboardStory.proposals.description}</p></div></div>}><div className="error-panel" role="alert"><h2>Decision queue unavailable</h2><p>{proposals.error}</p><button type="button" className="primary-button" onClick={retry}>Retry decisions</button></div></DashboardSection> : proposals.data ? <ProposalQueue proposals={proposals.data} status={proposalStatus} type={proposalType} source={proposalSource} onStatus={changeProposalStatus} onType={changeProposalType} onSource={changeProposalSource} onConflict={selectConflict} /> : null}
        {tickets.loading ? <DashboardSection id="support-tickets-section" headingId="tickets-heading" descriptionId="tickets-description" className="panel-section" heading={<div className="section-heading"><div><p className="eyebrow">{dashboardStory.tickets.step}</p><h2 id="tickets-heading">{dashboardStory.tickets.title}</h2><p id="tickets-description" className="section-description">{dashboardStory.tickets.description}</p></div></div>}><div className="loading-panel inline-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Loading support tickets…</p></div></DashboardSection> : tickets.error ? <DashboardSection id="support-tickets-section" headingId="tickets-heading" descriptionId="tickets-description" className="panel-section" heading={<div className="section-heading"><div><p className="eyebrow">{dashboardStory.tickets.step}</p><h2 id="tickets-heading">{dashboardStory.tickets.title}</h2><p id="tickets-description" className="section-description">{dashboardStory.tickets.description}</p></div></div>}><div className="error-panel" role="alert"><h2>Support context unavailable</h2><p>{tickets.error}</p><button type="button" className="primary-button" onClick={retry}>Retry support context</button></div></DashboardSection> : tickets.data ? <TicketTable tickets={tickets.data} onConflict={selectConflict} /> : null}
        </>}
      </main>
      {selectedId ? detail.loading ? <div className="detail-panel loading-panel" role="dialog" aria-label="Loading conflict detail" aria-modal="true" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Loading lineage and audit evidence…</p><button type="button" className="secondary-button" onClick={closeDetail}>Close</button></div> : detail.error ? <div className="detail-panel error-panel" role="dialog" aria-modal="true" aria-labelledby="detail-error-heading"><h2 id="detail-error-heading">Conflict detail unavailable</h2><p>{detail.error}</p><button type="button" className="primary-button" onClick={retry}>Retry detail</button><button type="button" className="secondary-button" onClick={closeDetail}>Close</button></div> : detail.data ? <ConflictDetail detail={detail.data} onClose={closeDetail} onDecided={decided} /> : null : null}
      <footer><p>Proposals stay pending by default. Auto-apply is a separate gated function. Synthetic fixtures · no source writer.</p></footer>
    </div>
  );
}
