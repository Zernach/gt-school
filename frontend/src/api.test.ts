import { ApiError, decideProposal, getConflict, getConflicts, getOverview, getProposals } from './api';
import { conflictDetailFixture, conflictListFixture, emptyFilters, overviewFixture, proposalFixture } from './test/fixtures';

function response(payload: unknown, status = 200, headers: Record<string, string> = { 'content-type': 'application/json' }): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fetchMock(): ReturnType<typeof vi.fn> {
  return vi.mocked(fetch) as ReturnType<typeof vi.fn>;
}

describe('API error', () => {
  it('retains status, machine code, user message, and request ID', () => {
    const error = new ApiError(409, 'stale_version', 'Reload before deciding.', 'request-1');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.status).toBe(409);
    expect(error.code).toBe('stale_version');
    expect(error.message).toBe('Reload before deciding.');
    expect(error.requestId).toBe('request-1');
  });

  it('allows an omitted request ID', () => {
    expect(new ApiError(500, 'internal_error', 'Failed').requestId).toBeUndefined();
  });
});

describe('shared request behavior', () => {
  it('sends the demo reviewer key and JSON accept header', async () => {
    fetchMock().mockResolvedValue(response({ data: overviewFixture(), requestId: 'request-1' }));
    await getOverview();
    expect(fetchMock()).toHaveBeenCalledWith('/api/v1/overview', {
      headers: {
        accept: 'application/json',
        'x-keystone-client-key': 'fixture-demo-reviewer-key-only'
      }
    });
  });

  it('returns only envelope data', async () => {
    const expected = overviewFixture();
    fetchMock().mockResolvedValue(response({ data: expected, requestId: 'request-1' }));
    await expect(getOverview()).resolves.toEqual(expected);
  });

  it('passes an AbortSignal through without changing headers', async () => {
    const controller = new AbortController();
    fetchMock().mockResolvedValue(response({ data: overviewFixture(), requestId: 'request-1' }));
    await getOverview(controller.signal);
    expect(fetchMock()).toHaveBeenCalledWith('/api/v1/overview', {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'x-keystone-client-key': 'fixture-demo-reviewer-key-only'
      }
    });
  });

  it('preserves a caller content type while adding authentication', async () => {
    const proposal = proposalFixture({ status: 'approved', version: 2 });
    fetchMock().mockResolvedValue(response({ data: proposal, requestId: 'request-1' }));
    await decideProposal(proposal.id, 'approve', 'Evidence verified', 1);
    const [, options] = fetchMock().mock.calls[0] as [string, RequestInit];
    expect(options.headers).toEqual({
      accept: 'application/json',
      'x-keystone-client-key': 'fixture-demo-reviewer-key-only',
      'content-type': 'application/json'
    });
  });

  it.each([
    [400, 'invalid_request', 'Schema mismatch.'],
    [401, 'unauthorized', 'A valid key is required.'],
    [403, 'forbidden', 'Reviewer scope is required.'],
    [404, 'not_found', 'Conflict not found.'],
    [409, 'stale_version', 'Reload before deciding.'],
    [413, 'body_too_large', 'The request was too large.'],
    [422, 'fixture_schema_invalid', 'Fixture invalid.'],
    [500, 'internal_error', 'An internal error occurred.'],
    [503, 'service_degraded', 'Dependency unavailable.']
  ] as const)('maps HTTP %d error envelope to ApiError', async (status, code, message) => {
    fetchMock().mockResolvedValue(response({ error: { code, message }, requestId: `request-${status}` }, status));
    const error = await getOverview().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code, message, requestId: `request-${status}` });
  });

  it('uses safe defaults for an empty error envelope', async () => {
    fetchMock().mockResolvedValue(response({}, 502));
    await expect(getOverview()).rejects.toMatchObject({
      status: 502,
      code: 'request_failed',
      message: 'The request failed.',
      requestId: undefined
    });
  });

  it('rejects a successful HTTP response without a data envelope', async () => {
    fetchMock().mockResolvedValue(response({ requestId: 'broken-success' }));
    await expect(getOverview()).rejects.toMatchObject({ status: 200, code: 'request_failed', requestId: 'broken-success' });
  });

  it('rejects an invalid JSON success response safely', async () => {
    fetchMock().mockResolvedValue(new Response('not-json', { status: 200 }));
    await expect(getOverview()).rejects.toMatchObject({ status: 200, code: 'request_failed', message: 'The request failed.' });
  });

  it('rejects an invalid JSON failure response safely', async () => {
    fetchMock().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(getOverview()).rejects.toMatchObject({ status: 502, code: 'request_failed', message: 'The request failed.' });
  });

  it('lets network errors retain their native diagnostic', async () => {
    fetchMock().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(getOverview()).rejects.toThrow('Failed to fetch');
  });

  it('lets AbortError remain distinguishable by the dashboard', async () => {
    fetchMock().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    const error = await getOverview().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});

describe('overview request', () => {
  it('uses the same-origin versioned endpoint', async () => {
    fetchMock().mockResolvedValue(response({ data: overviewFixture(), requestId: 'request-1' }));
    await getOverview();
    expect(fetchMock()).toHaveBeenCalledOnce();
    expect(fetchMock().mock.calls[0]?.[0]).toBe('/api/v1/overview');
  });
});

describe('conflict list request', () => {
  it('always requests a bounded page size', async () => {
    fetchMock().mockResolvedValue(response({ data: conflictListFixture(), requestId: 'request-1' }));
    await getConflicts(emptyFilters);
    expect(fetchMock().mock.calls[0]?.[0]).toBe('/api/v1/conflicts?limit=50');
  });

  it('omits every empty filter', async () => {
    fetchMock().mockResolvedValue(response({ data: conflictListFixture(), requestId: 'request-1' }));
    await getConflicts(emptyFilters);
    const url = new URL(String(fetchMock().mock.calls[0]?.[0]), 'https://keystone.example');
    expect([...url.searchParams.keys()]).toEqual(['limit']);
  });

  it('serializes all supported filters', async () => {
    fetchMock().mockResolvedValue(response({ data: conflictListFixture(), requestId: 'request-1' }));
    await getConflicts({
      type: 'paid_but_no_deal',
      source: 'payments',
      status: 'active',
      proposalStatus: 'pending',
      minimumConfidence: '0.75',
      from: '2026-01-15T12:00:00.000Z'
    });
    const url = new URL(String(fetchMock().mock.calls[0]?.[0]), 'https://keystone.example');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '50',
      type: 'paid_but_no_deal',
      source: 'payments',
      status: 'active',
      proposalStatus: 'pending',
      minimumConfidence: '0.75',
      from: '2026-01-15T12:00:00.000Z'
    });
  });

  it('adds an opaque cursor without interpreting it', async () => {
    fetchMock().mockResolvedValue(response({ data: conflictListFixture(), requestId: 'request-1' }));
    await getConflicts(emptyFilters, 'cursor/+ value');
    const url = new URL(String(fetchMock().mock.calls[0]?.[0]), 'https://keystone.example');
    expect(url.searchParams.get('cursor')).toBe('cursor/+ value');
  });

  it('returns the list envelope data', async () => {
    const expected = conflictListFixture();
    fetchMock().mockResolvedValue(response({ data: expected, requestId: 'request-1' }));
    await expect(getConflicts(emptyFilters)).resolves.toEqual(expected);
  });
});

describe('conflict detail request', () => {
  it.each([
    ['simple-id', 'simple-id'],
    ['id with spaces', 'id%20with%20spaces'],
    ['id/with/slashes', 'id%2Fwith%2Fslashes'],
    ['id?query=true', 'id%3Fquery%3Dtrue'],
    ['unicode-✓', 'unicode-%E2%9C%93']
  ])('URL-encodes conflict ID %j', async (id, encoded) => {
    fetchMock().mockResolvedValue(response({ data: conflictDetailFixture(), requestId: 'request-1' }));
    await getConflict(id);
    expect(fetchMock().mock.calls[0]?.[0]).toBe(`/api/v1/conflicts/${encoded}`);
  });

  it('returns conflict detail data', async () => {
    const expected = conflictDetailFixture();
    fetchMock().mockResolvedValue(response({ data: expected, requestId: 'request-1' }));
    await expect(getConflict(expected.id)).resolves.toEqual(expected);
  });
});

describe('proposal list request', () => {
  it('defaults to an unfiltered bounded list', async () => {
    fetchMock().mockResolvedValue(response({ data: [proposalFixture()], requestId: 'request-1' }));
    await getProposals();
    expect(fetchMock().mock.calls[0]?.[0]).toBe('/api/v1/proposals?limit=50');
  });

  it.each(['pending', 'approved', 'rejected', 'held', 'superseded'])('serializes proposal status %s', async (status) => {
    fetchMock().mockResolvedValue(response({ data: [proposalFixture()], requestId: 'request-1' }));
    await getProposals(status);
    const url = new URL(String(fetchMock().mock.calls[0]?.[0]), 'https://keystone.example');
    expect(url.searchParams.get('status')).toBe(status);
    expect(url.searchParams.get('limit')).toBe('50');
  });

  it('returns the proposal array', async () => {
    const expected = [proposalFixture(), proposalFixture({ id: 'another' })];
    fetchMock().mockResolvedValue(response({ data: expected, requestId: 'request-1' }));
    await expect(getProposals('pending')).resolves.toEqual(expected);
  });
});

describe('proposal decision request', () => {
  it.each(['approve', 'reject', 'hold'] as const)('posts %s with reason and optimistic version', async (decision) => {
    const expected = proposalFixture({ status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'held', version: 8 });
    fetchMock().mockResolvedValue(response({ data: expected, requestId: 'request-1' }));
    await expect(decideProposal('proposal/id', decision, 'Evidence was reviewed', 7)).resolves.toEqual(expected);
    const [url, options] = fetchMock().mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/proposals/proposal%2Fid/decision');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({ decision, reason: 'Evidence was reviewed', version: 7 });
  });

  it('does not retry a stale optimistic decision automatically', async () => {
    fetchMock().mockResolvedValue(response({ error: { code: 'stale_version', message: 'Reload before deciding.' }, requestId: 'stale-request' }, 409));
    await expect(decideProposal('proposal-1', 'approve', 'Reviewed', 1)).rejects.toMatchObject({ code: 'stale_version' });
    expect(fetchMock()).toHaveBeenCalledOnce();
  });
});
