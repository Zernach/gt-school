export interface BackendFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface PagesApiContext {
  request: Request;
  env: { KEYSTONE_DEMO_API?: BackendFetcher };
}

function unavailable(request: Request): Response {
  const requestId = request.headers.get('x-request-id')?.slice(0, 128) ?? crypto.randomUUID();
  return Response.json({ error: { code: 'backend_unavailable', message: 'The demo backend is not bound to this Pages deployment.' }, requestId }, {
    status: 503,
    headers: { 'cache-control': 'no-store', 'x-request-id': requestId }
  });
}

/** Same-origin Pages Function bridge; it deliberately adds no browser CORS policy. */
export function onPagesApiRequest(context: PagesApiContext): Promise<Response> {
  return context.env.KEYSTONE_DEMO_API?.fetch(context.request) ?? Promise.resolve(unavailable(context.request));
}
