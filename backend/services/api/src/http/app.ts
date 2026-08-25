import { timingSafeEqual } from 'node:crypto';
import { access } from 'node:fs/promises';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { RedisClientType } from 'redis';
import { z, ZodError } from 'zod';
import type { AppConfig } from '../config.js';
import { paymentSchema } from '../domain/fixture-types.js';
import { type ProposalDecision } from '../domain/proposal-state.js';
import { PRIVACY_POLICY_VERSION } from '../domain/redaction.js';
import { createDurableJob, publishJob } from '../jobs/service.js';
import type { DatabasePool } from '../persistence/database.js';
import { databaseReady } from '../persistence/database.js';
import { authenticateClient, decideProposal, getConflictDetail, getEntity, getOverview, getRun, listConflicts, listIncidentGroups, listProposalApplications, listProposals, listTickets, type TenantContext } from '../persistence/queries.js';
import { rollbackAutoApply } from '../reconciliation/auto-apply.js';
import type { ReadOnlySourceAdapter } from '../sources/adapter.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

const listConflictQuery = z.object({
  type: z.string().optional(),
  source: z.enum(['crm', 'app', 'payments']).optional(),
  status: z.enum(['active', 'resolved', 'unchecked', 'oscillation_hold']).optional(),
  proposalStatus: z.enum(['pending', 'approved', 'rejected', 'held', 'superseded', 'applied', 'rolled_back']).optional(),
  minimumConfidence: z.coerce.number().min(0).max(1).optional(),
  from: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
const proposalQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'held', 'superseded', 'applied', 'rolled_back']).optional(),
  type: z.string().optional(),
  source: z.enum(['crm', 'app', 'payments']).optional(),
  minimumConfidence: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
const overviewQuery = z.object({ from: z.string().datetime().optional() });
const ticketQuery = z.object({ issueType: z.string().optional(), status: z.enum(['open', 'pending', 'resolved']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const jobBody = z.object({ idempotencyKey: z.string().min(8).max(200), generation: z.number().int().min(1).max(3).default(3), faultSource: z.enum(['crm', 'app', 'payments']).optional(), faultMode: z.enum(['none', 'timeout', '5xx', 'partial']).optional() }).strict();
const decisionBody = z.object({ decision: z.enum(['approve', 'reject', 'hold']), reason: z.string().trim().min(3).max(1000), version: z.number().int().positive() }).strict();

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function data(reply: FastifyReply, request: FastifyRequest, value: unknown, status = 200): FastifyReply {
  return reply.code(status).send({ data: value, requestId: request.id });
}

export interface AppDependencies {
  config: AppConfig;
  pool: DatabasePool;
  queue: RedisClientType;
  adapters: readonly ReadOnlySourceAdapter[];
}

async function readinessSentinelExists(path: string): Promise<boolean> {
  if (!path) return true;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config, pool, queue, adapters } = dependencies;
  const app = Fastify({ logger: { level: config.NODE_ENV === 'test' ? 'silent' : 'info', redact: ['req.headers.x-keystone-client-key', 'req.headers.x-keystone-trigger-secret', 'req.headers.authorization'] }, bodyLimit: config.REQUEST_BODY_LIMIT_BYTES, requestTimeout: 30_000, trustProxy: false, genReqId: (request) => request.headers['x-request-id']?.toString().slice(0, 128) || crypto.randomUUID() });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addHook('onSend', async (request, reply) => { reply.header('x-request-id', request.id); reply.header('cache-control', 'no-store'); });
  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : 'internal_error';
    if (error instanceof ZodError || message === 'cursor_invalid') return reply.code(400).send({ error: { code: 'invalid_request', message: 'The request did not match the documented schema.' }, requestId: request.id });
    if (message === 'reviewer_required') return reply.code(403).send({ error: { code: 'forbidden', message: 'Reviewer scope is required.' }, requestId: request.id });
    if (message === 'proposal_version_stale') return reply.code(409).send({ error: { code: 'stale_version', message: 'The proposal changed; reload before deciding.' }, requestId: request.id });
    if (message === 'proposal_transition_illegal') return reply.code(409).send({ error: { code: 'illegal_transition', message: 'This proposal cannot take that transition.' }, requestId: request.id });
    const statusCode = error !== null && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    request.log.error({ err: error, requestId: request.id }, 'request_failed');
    return reply.code(statusCode).send({ error: { code: statusCode === 413 ? 'body_too_large' : statusCode === 400 ? 'invalid_json' : 'internal_error', message: statusCode < 500 ? 'The request could not be processed.' : 'An internal error occurred.' }, requestId: request.id });
  });

  const requireClient = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key = header(request, 'x-keystone-client-key');
    const tenant = key ? await authenticateClient(pool, key) : undefined;
    if (!tenant) { await reply.code(401).send({ error: { code: 'unauthorized', message: 'A valid client key is required.' }, requestId: request.id }); return; }
    request.tenant = tenant;
  };
  const requireTrigger = (expected: string) => async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!secretMatches(header(request, 'x-keystone-trigger-secret'), expected)) await reply.code(401).send({ error: { code: 'unauthorized_trigger', message: 'A valid per-job trigger secret is required.' }, requestId: request.id });
  };

  const health = async (): Promise<{ ready: boolean; data: Record<string, unknown> }> => {
    const database = await databaseReady(pool);
    const queueReady = await queue.ping().then((response) => response === 'PONG').catch(() => false);
    const sources = await Promise.all(adapters.map((adapter) => adapter.health()));
    const ready = database.ready && queueReady && sources.every(({ ready: sourceReady }) => sourceReady);
    return { ready, data: { status: ready ? 'ok' : 'degraded', process: { ready: true }, database, queue: { ready: queueReady }, sources } };
  };

  app.get('/health', async (request, reply) => {
    const status = await health();
    return data(reply, request, status.data, status.ready ? 200 : 503);
  });

  app.get('/ready', async (request, reply) => {
    const status = await health();
    const bootstrapReady = await readinessSentinelExists(config.READINESS_SENTINEL_PATH);
    const ready = status.ready && bootstrapReady;
    return data(reply, request, {
      ...status.data,
      status: ready ? 'ok' : 'degraded',
      bootstrap: { ready: bootstrapReady }
    }, ready ? 200 : 503);
  });

  app.get('/api/v1/overview', { preHandler: requireClient }, async (request, reply) => {
    const query = overviewQuery.parse(request.query);
    return data(reply, request, {
      ...(await getOverview(pool, request.tenant!.tenantId, query.from ? { from: query.from } : {})),
      privacy: {
        mode: config.LOG_PRIVACY_MODE,
        retentionDays: config.LOG_RETENTION_DAYS,
        policyVersion: PRIVACY_POLICY_VERSION,
        audit: 'append-only hashed metadata; raw PII is not stored in logs',
        alerts: `deleted after ${config.LOG_RETENTION_DAYS} days`
      }
    });
  });
  app.get('/api/v1/conflicts', { preHandler: requireClient }, async (request, reply) => {
    const query = listConflictQuery.parse(request.query);
    return data(reply, request, await listConflicts(pool, request.tenant!.tenantId, {
      limit: query.limit,
      ...(query.type ? { type: query.type } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.proposalStatus ? { proposalStatus: query.proposalStatus } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.minimumConfidence === undefined ? {} : { minimumConfidenceBp: Math.round(query.minimumConfidence * 10_000) })
    }));
  });
  app.get('/api/v1/conflicts/:id', { preHandler: requireClient }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const detail = await getConflictDetail(pool, request.tenant!.tenantId, id);
    return detail ? data(reply, request, detail) : reply.code(404).send({ error: { code: 'not_found', message: 'Conflict not found.' }, requestId: request.id });
  });
  app.get('/api/v1/proposals', { preHandler: requireClient }, async (request, reply) => {
    const query = proposalQuery.parse(request.query);
    return data(reply, request, await listProposals(pool, request.tenant!.tenantId, {
      limit: query.limit,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.minimumConfidence === undefined ? {} : { minimumConfidenceBp: Math.round(query.minimumConfidence * 10_000) })
    }));
  });
  app.post('/api/v1/proposals/:id/decision', { preHandler: requireClient }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = decisionBody.parse(request.body);
    const result = await decideProposal(pool, request.tenant!, id, body.decision as ProposalDecision, body.reason, body.version, request.id);
    return result ? data(reply, request, result) : reply.code(404).send({ error: { code: 'not_found', message: 'Proposal not found.' }, requestId: request.id });
  });
  app.get('/api/v1/entities/:id', { preHandler: requireClient }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const entity = await getEntity(pool, request.tenant!.tenantId, id);
    return entity ? data(reply, request, entity) : reply.code(404).send({ error: { code: 'not_found', message: 'Entity not found.' }, requestId: request.id });
  });
  app.get('/api/v1/runs/:id', { preHandler: requireClient }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const run = await getRun(pool, request.tenant!.tenantId, id);
    return run ? data(reply, request, run) : reply.code(404).send({ error: { code: 'not_found', message: 'Run not found.' }, requestId: request.id });
  });
  app.get('/api/v1/incident-groups', { preHandler: requireClient }, async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    return data(reply, request, await listIncidentGroups(pool, request.tenant!.tenantId, query.limit));
  });
  app.get('/api/v1/tickets', { preHandler: requireClient }, async (request, reply) => {
    const query = ticketQuery.parse(request.query);
    return data(reply, request, await listTickets(pool, request.tenant!.tenantId, {
      limit: query.limit,
      ...(query.issueType ? { issueType: query.issueType } : {}),
      ...(query.status ? { status: query.status } : {})
    }));
  });
  app.get('/api/v1/applications', { preHandler: requireClient }, async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    return data(reply, request, await listProposalApplications(pool, request.tenant!.tenantId, query.limit));
  });
  app.post('/api/v1/proposals/:id/rollback', { preHandler: requireClient }, async (request, reply) => {
    if (request.tenant!.role !== 'reviewer') throw new Error('reviewer_required');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await rollbackAutoApply(pool, config, {
      tenantId: request.tenant!.tenantId,
      proposalId: id,
      requestId: request.id,
      actor: `fixture-reviewer:${request.tenant!.tenantSlug}`
    });
    return result ? data(reply, request, result) : reply.code(404).send({ error: { code: 'not_found', message: 'Auto-apply record not found.' }, requestId: request.id });
  });

  const registerJobRoute = (path: string, jobType: 'sync' | 'reconcile' | 'stretch', secret: string): void => {
    app.post(path, { preHandler: [requireClient, requireTrigger(secret)], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
      const body = jobBody.parse(request.body);
      const reference = await createDurableJob(pool, config, { tenantId: request.tenant!.tenantId, jobType, idempotencyKey: body.idempotencyKey, requestId: request.id, payload: body });
      if (!reference.duplicate && reference.status === 'queued') {
        try { await publishJob(pool, queue, config.QUEUE_STREAM, reference.id); } catch (error) { request.log.warn({ err: error, jobId: reference.id }, 'job_persisted_publish_deferred'); }
      }
      return data(reply, request, reference, reference.duplicate ? 200 : 202);
    });
  };
  registerJobRoute('/api/v1/jobs/sync', 'sync', config.SYNC_TRIGGER_SECRET);
  registerJobRoute('/api/v1/jobs/reconcile', 'reconcile', config.RECONCILE_TRIGGER_SECRET);
  registerJobRoute('/api/v1/jobs/stretch', 'stretch', config.STRETCH_TRIGGER_SECRET);

  app.post('/api/v1/internal/fixtures/validate', { preHandler: [requireClient, requireTrigger(config.SYNC_TRIGGER_SECRET)] }, async (request, reply) => {
    const parsed = paymentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: { code: 'fixture_schema_invalid', message: 'Fixture record failed schema validation.', issues: parsed.error.issues.map(({ path, code }) => ({ path: path.join('.'), code })) }, requestId: request.id });
    return data(reply, request, { valid: true, sourceId: parsed.data.fixture_record_id });
  });
  return app;
}
