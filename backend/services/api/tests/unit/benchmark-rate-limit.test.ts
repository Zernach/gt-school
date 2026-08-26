import { waitForRateLimitBudget } from '../../src/cli/benchmark-rate-limit.js';

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response('{}', { status, headers });
}

describe('benchmark rate-limit budget', () => {
  it('starts immediately when the full measured-request budget remains', async () => {
    const fetchImplementation = vi.fn(async () => response(200, { 'x-ratelimit-remaining': '80', 'x-ratelimit-reset': '60' }));
    const sleep = vi.fn(async () => undefined);

    await expect(waitForRateLimitBudget({
      url: 'http://api.test/health',
      headers: { 'x-keystone-client-key': 'fixture-key' },
      requiredRequests: 80,
      fetchImplementation,
      sleep
    })).resolves.toEqual({ checks: 1, waitedMs: 0, requiredRequests: 80 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits for the advertised reset before measurements when prior gates consumed the budget', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(response(200, { 'x-ratelimit-remaining': '42', 'x-ratelimit-reset': '2' }))
      .mockResolvedValueOnce(response(200, { 'x-ratelimit-remaining': '119', 'x-ratelimit-reset': '60' }));
    const sleep = vi.fn(async () => undefined);

    await expect(waitForRateLimitBudget({
      url: 'http://api.test/health',
      headers: {},
      requiredRequests: 80,
      fetchImplementation,
      sleep
    })).resolves.toEqual({ checks: 2, waitedMs: 2_050, requiredRequests: 80 });
    expect(sleep).toHaveBeenCalledWith(2_050);
  });

  it('honors Retry-After after a 429 and remains bounded', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(response(429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(response(200, { 'x-ratelimit-remaining': '119' }));
    const sleep = vi.fn(async () => undefined);

    await expect(waitForRateLimitBudget({
      url: 'http://api.test/health',
      headers: {},
      requiredRequests: 80,
      fetchImplementation,
      sleep
    })).resolves.toMatchObject({ checks: 2, waitedMs: 3_050 });
  });

  it('fails closed when a constrained response omits reset timing', async () => {
    await expect(waitForRateLimitBudget({
      url: 'http://api.test/health',
      headers: {},
      requiredRequests: 80,
      fetchImplementation: vi.fn(async () => response(200, { 'x-ratelimit-remaining': '10' })),
      sleep: vi.fn(async () => undefined)
    })).rejects.toThrow('benchmark_rate_limit_reset_missing');
  });
});
