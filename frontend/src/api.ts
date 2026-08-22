import type { ConflictDetail, ConflictFilters, ConflictList, OverviewData, Proposal } from './types';

const clientKey = import.meta.env.VITE_DEMO_CLIENT_KEY ?? 'fixture-demo-reviewer-key-only';

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
  requestId?: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      accept: 'application/json',
      'x-keystone-client-key': clientKey,
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({})) as Envelope<T> | ErrorEnvelope;
  if (!response.ok || !('data' in payload)) {
    const failure = payload as ErrorEnvelope;
    throw new ApiError(response.status, failure.error?.code ?? 'request_failed', failure.error?.message ?? 'The request failed.', failure.requestId);
  }
  return payload.data;
}

export function getOverview(signal?: AbortSignal): Promise<OverviewData> {
  return request<OverviewData>('/api/v1/overview', signal ? { signal } : {});
}

export function getConflicts(filters: ConflictFilters, cursor?: string, signal?: AbortSignal): Promise<ConflictList> {
  const query = new URLSearchParams({ limit: '50' });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  if (cursor) query.set('cursor', cursor);
  return request<ConflictList>(`/api/v1/conflicts?${query}`, signal ? { signal } : {});
}

export function getConflict(id: string, signal?: AbortSignal): Promise<ConflictDetail> {
  return request<ConflictDetail>(`/api/v1/conflicts/${encodeURIComponent(id)}`, signal ? { signal } : {});
}

export function getProposals(status = '', signal?: AbortSignal): Promise<Proposal[]> {
  const query = new URLSearchParams({ limit: '50' });
  if (status) query.set('status', status);
  return request<Proposal[]>(`/api/v1/proposals?${query}`, signal ? { signal } : {});
}

export function decideProposal(id: string, decision: 'approve' | 'reject' | 'hold', reason: string, version: number): Promise<Proposal> {
  return request<Proposal>(`/api/v1/proposals/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision, reason, version })
  });
}
