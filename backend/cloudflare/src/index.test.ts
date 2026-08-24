import { describe, expect, test, vi } from 'vitest';

vi.mock('@cloudflare/containers', () => ({ Container: class {} }));

import { forwardToReadyContainer } from './container-proxy.js';
import worker from './index.js';

function environment(container: { startAndWaitForPorts: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }) {
  return { KEYSTONE_DEMO: { getByName: vi.fn(() => container) } } as unknown as Env;
}

describe('Container proxy', () => {
  test('starts on the declared port before forwarding without buffering the request', async () => {
    const request = new Request('https://api.example/ready');
    const response = new Response('ready');
    const container = { startAndWaitForPorts: vi.fn(async () => undefined), fetch: vi.fn(async (received: Request) => {
      expect(received).toBe(request);
      return response;
    }), stop: vi.fn(async () => undefined) };

    await expect(forwardToReadyContainer(container, request)).resolves.toBe(response);
    expect(container.startAndWaitForPorts).toHaveBeenCalledWith({ cancellationOptions: { instanceGetTimeoutMS: 45_000, portReadyTimeoutMS: 45_000 } });
  });

  test('retries exactly once only when the listener was lost before forwarding', async () => {
    const container = {
      startAndWaitForPorts: vi.fn().mockRejectedValueOnce(new Error('The container is not listening in the TCP address 10.0.0.1:8080')).mockResolvedValueOnce(undefined),
      fetch: vi.fn(async () => new Response('ready')),
      stop: vi.fn(async () => undefined)
    };

    await expect(forwardToReadyContainer(container, new Request('https://api.example/ready'))).resolves.toMatchObject({ status: 200 });
    expect(container.stop).toHaveBeenCalledOnce();
    expect(container.startAndWaitForPorts).toHaveBeenCalledTimes(2);
    expect(container.fetch).toHaveBeenCalledOnce();
  });

  test('does not retry a forwarding failure that could replay a mutation', async () => {
    const container = {
      startAndWaitForPorts: vi.fn(async () => undefined),
      fetch: vi.fn(async () => { throw new Error('The container is not listening in the TCP address 10.0.0.1:8080'); }),
      stop: vi.fn(async () => undefined)
    };

    await expect(forwardToReadyContainer(container, new Request('https://api.example/api/v1/jobs/sync', { method: 'POST' }))).rejects.toThrow('not listening');
    expect(container.stop).not.toHaveBeenCalled();
    expect(container.fetch).toHaveBeenCalledOnce();
  });
});

describe('Worker ingress policy', () => {
  test('uses one named demo instance and preserves a streamed API response', async () => {
    const response = new Response('event: final\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    const container = { startAndWaitForPorts: vi.fn(async () => undefined), fetch: vi.fn(async () => response), stop: vi.fn(async () => undefined) };
    const env = environment(container);

    const result = await worker.fetch(new Request('https://api.example/api/v1/conflicts'), env);
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('text/event-stream');
    expect(await result.text()).toContain('event: final');
    expect(env.KEYSTONE_DEMO.getByName).toHaveBeenCalledWith('keystone-demo-v1');
  });

  test('fails closed before starting a Container for invalid routes, methods, and bodies', async () => {
    const container = { startAndWaitForPorts: vi.fn(), fetch: vi.fn(), stop: vi.fn() };
    const env = environment(container);

    await expect(worker.fetch(new Request('https://api.example/private'), env)).resolves.toMatchObject({ status: 404 });
    await expect(worker.fetch(new Request('https://api.example/api/v1/conflicts', { method: 'DELETE' }), env)).resolves.toMatchObject({ status: 405 });
    await expect(worker.fetch(new Request('https://api.example/api/v1/jobs/sync', { method: 'POST', headers: { 'content-length': '1048577' } }), env)).resolves.toMatchObject({ status: 413 });
    await expect(worker.fetch(new Request('https://api.example/api/v1/jobs/sync', { method: 'POST', headers: { 'content-length': 'unknown' } }), env)).resolves.toMatchObject({ status: 400 });
    expect(env.KEYSTONE_DEMO.getByName).not.toHaveBeenCalled();
  });

  test('returns a bounded structured failure when container startup fails', async () => {
    const container = { startAndWaitForPorts: vi.fn(async () => { throw new Error('Container access denied'); }), fetch: vi.fn(), stop: vi.fn() };
    const result = await worker.fetch(new Request('https://api.example/ready'), environment(container));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ error: { code: 'backend_unavailable' } });
  });
});
