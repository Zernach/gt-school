import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getConflict, getConflicts, getOverview, getProposals } from './api';
import { ConflictDetail } from './components/ConflictDetail';
import { ConflictFiltersForm, ConflictTable, EMPTY_FILTERS } from './components/ConflictTable';
import { Overview } from './components/Overview';
import { ProposalQueue } from './components/ProposalQueue';
import { StatusBadge } from './components/StatusBadge';
import type { ConflictDetail as ConflictDetailType, ConflictFilters, ConflictList, OverviewData, Proposal } from './types';

interface LoadState<T> { loading: boolean; data: T | null; error: string; }
const loading = <T,>(): LoadState<T> => ({ loading: true, data: null, error: '' });

function failureMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  if (error instanceof ApiError) return `${error.message}${error.requestId ? ` Request ${error.requestId}.` : ''}`;
  return error instanceof Error ? error.message : 'The dashboard could not load this evidence window.';
}

export default function App() {
  const [filters, setFilters] = useState<ConflictFilters>(EMPTY_FILTERS);
  const [cursor, setCursor] = useState<string | undefined>();
  const [overview, setOverview] = useState<LoadState<OverviewData>>(loading);
  const [conflicts, setConflicts] = useState<LoadState<ConflictList>>(loading);
  const [proposalStatus, setProposalStatus] = useState('pending');
  const [proposals, setProposals] = useState<LoadState<Proposal[]>>(loading);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LoadState<ConflictDetailType>>({ loading: false, data: null, error: '' });
  const [refresh, setRefresh] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const selectedTriggerId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getOverview(controller.signal).then((data) => setOverview({ loading: false, data, error: '' })).catch((error: unknown) => { const message = failureMessage(error); if (message) setOverview({ loading: false, data: null, error: message }); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    void getConflicts(filters, cursor, controller.signal).then((data) => setConflicts({ loading: false, data, error: '' })).catch((error: unknown) => { const message = failureMessage(error); if (message) setConflicts({ loading: false, data: null, error: message }); });
    return () => controller.abort();
  }, [filters, cursor, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    void getProposals(proposalStatus, controller.signal).then((data) => setProposals({ loading: false, data, error: '' })).catch((error: unknown) => { const message = failureMessage(error); if (message) setProposals({ loading: false, data: null, error: message }); });
    return () => controller.abort();
  }, [proposalStatus, refresh]);

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
    if (selectedId) setDetail(loading());
    setRefresh((value) => value + 1);
  };
  const changeFilters = (next: ConflictFilters) => { setConflicts(loading()); setCursor(undefined); setFilters(next); };
  const changePage = (nextCursor?: string) => { setConflicts(loading()); setCursor(nextCursor); };
  const changeProposalStatus = (status: string) => { setProposals(loading()); setProposalStatus(status); };
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
      <header className="site-header"><div className="brand-mark" aria-hidden="true">K</div><div><p>Reconciliation trust layer</p><h1>Keystone</h1></div><div className="header-state"><StatusBadge status={overview.error ? 'failed' : overview.loading ? 'pending' : 'complete'} label={overview.error ? 'API unavailable' : overview.loading ? 'Refreshing evidence' : 'Evidence connected'} /></div></header>
      <main id="main-content">
        <p className="sr-only" aria-live="polite">{announcement}</p>
        {partialSources.length ? <div className="warning-banner" role="status"><span aria-hidden="true">△</span><div><strong>Incomplete source evidence</strong><p>{partialSources.join(', ')} did not complete. Dependent rules are unchecked; absence has not been inferred.</p></div></div> : null}
        {overview.loading ? <section className="loading-panel" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Loading current source and invariant evidence…</p></section> : overview.error ? <section className="error-panel" role="alert"><h2>Overview unavailable</h2><p>{overview.error}</p><button className="primary-button" type="button" onClick={retry}>Retry overview</button></section> : overview.data ? <Overview overview={overview.data} /> : null}

        <section aria-labelledby="conflicts-heading" className="panel-section">
          <div className="section-heading"><div><p className="eyebrow">Deterministic invariant output</p><h2 id="conflicts-heading">Conflict evidence</h2></div><button type="button" className="secondary-button" onClick={retry} disabled={conflicts.loading}>Refresh</button></div>
          <ConflictFiltersForm filters={filters} onChange={changeFilters} disabled={conflicts.loading} />
          {conflicts.loading ? <div className="loading-panel inline-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Checking this evidence window…</p></div> : conflicts.error ? <div className="error-panel" role="alert"><h3>Conflicts unavailable</h3><p>{conflicts.error}</p><button className="primary-button" type="button" onClick={retry}>Retry conflicts</button></div> : conflicts.data ? <><ConflictTable rows={conflicts.data.items} selectedId={selectedId} onSelect={selectConflict} /><div className="pagination"><button type="button" className="secondary-button" onClick={() => changePage()} disabled={!cursor}>First page</button><button type="button" className="secondary-button" onClick={() => changePage(conflicts.data?.nextCursor ?? undefined)} disabled={!conflicts.data.nextCursor}>Next page</button></div></> : null}
        </section>

        {proposals.loading ? <section className="loading-panel inline-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Loading proposal queue…</p></section> : proposals.error ? <section className="error-panel" role="alert"><h2>Proposal queue unavailable</h2><p>{proposals.error}</p><button type="button" className="primary-button" onClick={retry}>Retry queue</button></section> : proposals.data ? <ProposalQueue proposals={proposals.data} status={proposalStatus} onStatus={changeProposalStatus} onConflict={selectConflict} /> : null}
      </main>
      {selectedId ? detail.loading ? <div className="detail-panel loading-panel" role="dialog" aria-label="Loading conflict detail" aria-modal="true" aria-busy="true"><span className="spinner" aria-hidden="true" /><p>Loading lineage and audit evidence…</p><button type="button" className="secondary-button" onClick={closeDetail}>Close</button></div> : detail.error ? <div className="detail-panel error-panel" role="dialog" aria-modal="true" aria-labelledby="detail-error-heading"><h2 id="detail-error-heading">Conflict detail unavailable</h2><p>{detail.error}</p><button type="button" className="primary-button" onClick={retry}>Retry detail</button><button type="button" className="secondary-button" onClick={closeDetail}>Close</button></div> : detail.data ? <ConflictDetail detail={detail.data} onClose={closeDetail} onDecided={decided} /> : null : null}
      <footer><p>Core mode is proposal-only. Synthetic fixtures · deterministic rules · no source writer.</p></footer>
    </div>
  );
}
