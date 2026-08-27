import { Container } from '@cloudflare/containers';
import { forwardToReadyContainer } from './container-proxy.js';

const apiPrefix = '/api/v1/';
const singletonContainerName = 'keystone-demo-v1';
const maximumRequestBodyBytes = 1_048_576;

export const cloudflareDemoContainerEnv = {
  NODE_ENV: 'production',
  HOST: '0.0.0.0',
  API_CONTAINER_PORT: '8080',
  WORKER_HEALTH_PORT: '3001',
  READINESS_SENTINEL_PATH: '/tmp/keystone-ready/bootstrapped',
  // The managed Container parses a 39 MB synthetic fixture set without a
  // network source. Five seconds is too short under its CPU allocation.
  SOURCE_TIMEOUT_MS: '60000'
} as const;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'unknown';
}

function responseError(request: Request, status: number, code: string, message: string): Response {
  const requestId = request.headers.get('x-request-id')?.slice(0, 128) ?? crypto.randomUUID();
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: { 'cache-control': 'no-store', 'x-request-id': requestId }
  });
}

function allowedRequest(url: URL, method: string): boolean {
  if (url.pathname === '/ready' || url.pathname === '/health') return method === 'GET' || method === 'HEAD';
  return url.pathname.startsWith(apiPrefix) && (method === 'GET' || method === 'POST');
}

function requestedBodyLength(request: Request): number | undefined {
  const value = request.headers.get('content-length');
  if (value === null) return undefined;
  if (!/^\d+$/u.test(value)) return Number.NaN;
  return Number(value);
}

export class KeystoneDemoContainer extends Container<Env> {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = '30m';
  override enableInternet = false;
  override pingEndpoint = '/ready';
  override entrypoint = ['/opt/keystone/bin/ephemeral-entrypoint.sh'];
  override envVars = cloudflareDemoContainerEnv;

  override onStart(): void {
    console.log(JSON.stringify({ event: 'container.started', dataLifecycle: 'ephemeral', instance: singletonContainerName }));
  }

  override onStop(): void {
    console.log(JSON.stringify({ event: 'container.stopped', dataLossExpected: true }));
  }

  override onError(error: unknown): void {
    console.error(JSON.stringify({ event: 'container.error', message: errorMessage(error) }));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!allowedRequest(url, request.method)) {
      const status = url.pathname === '/ready' || url.pathname === '/health' || url.pathname.startsWith(apiPrefix) ? 405 : 404;
      return responseError(request, status, status === 405 ? 'method_not_allowed' : 'not_found', status === 405 ? 'This method is not allowed for the requested route.' : 'The requested route does not exist.');
    }

    const bodyLength = requestedBodyLength(request);
    if (Number.isNaN(bodyLength)) return responseError(request, 400, 'invalid_request', 'Content-Length must be an unsigned decimal integer.');
    if (bodyLength !== undefined && bodyLength > maximumRequestBodyBytes) return responseError(request, 413, 'body_too_large', 'The request body exceeds the documented limit.');

    const container = env.KEYSTONE_DEMO.getByName(singletonContainerName);
    let response: Response;
    try {
      response = await forwardToReadyContainer(container, request);
    } catch (error) {
      console.error(JSON.stringify({ event: 'container.request_failed', message: errorMessage(error), path: url.pathname }));
      return responseError(request, 503, 'backend_unavailable', 'The demo backend is starting or temporarily unavailable.');
    }

    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
} satisfies ExportedHandler<Env>;
