import { describe, expect, test, vi } from 'vitest';
import { onPagesApiRequest } from './pages-api-proxy';

describe('Pages API bridge', () => {
  test('forwards the original same-origin request to the bound Worker', async () => {
    const request = new Request('https://gt-school.pages.dev/api/v1/overview', { headers: { 'x-keystone-client-key': 'fixture-demo-client-key-only' } });
    const fetch = vi.fn(async (received: Request) => {
      expect(received).toBe(request);
      return new Response('stream', { headers: { 'content-type': 'text/event-stream' } });
    });

    const response = await onPagesApiRequest({ request, env: { KEYSTONE_DEMO_API: { fetch } } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe('stream');
  });

  test('fails closed with a stable error when the Pages service binding is absent', async () => {
    const response = await onPagesApiRequest({ request: new Request('https://gt-school.pages.dev/api/v1/overview'), env: {} });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'backend_unavailable' } });
  });
});
