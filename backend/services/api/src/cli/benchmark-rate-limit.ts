export interface RateLimitBudgetResult {
  checks: number;
  waitedMs: number;
  requiredRequests: number;
}

interface RateLimitBudgetOptions {
  url: string;
  headers: Record<string, string>;
  requiredRequests: number;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maximumWaitMs?: number;
  maximumChecks?: number;
}

function headerInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return undefined;
  return Number(value);
}

export async function waitForRateLimitBudget(options: RateLimitBudgetOptions): Promise<RateLimitBudgetResult> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maximumWaitMs = options.maximumWaitMs ?? 65_000;
  const maximumChecks = options.maximumChecks ?? 3;
  let waitedMs = 0;

  for (let check = 1; check <= maximumChecks; check += 1) {
    const response = await fetchImplementation(options.url, { headers: options.headers });
    await response.arrayBuffer();
    const remaining = headerInteger(response.headers.get('x-ratelimit-remaining'));
    if (response.ok && (remaining === undefined || remaining >= options.requiredRequests)) {
      return { checks: check, waitedMs, requiredRequests: options.requiredRequests };
    }
    if (!response.ok && response.status !== 429) throw new Error(`benchmark_preflight_failed:${response.status}`);

    const resetSeconds = headerInteger(response.headers.get('retry-after')) ?? headerInteger(response.headers.get('x-ratelimit-reset'));
    if (resetSeconds === undefined) throw new Error('benchmark_rate_limit_reset_missing');
    const delayMs = resetSeconds * 1_000 + 50;
    if (waitedMs + delayMs > maximumWaitMs) throw new Error(`benchmark_rate_limit_wait_exceeded:${waitedMs + delayMs}`);
    await sleep(delayMs);
    waitedMs += delayMs;
  }
  throw new Error('benchmark_rate_limit_budget_unavailable');
}
