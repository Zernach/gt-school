import { loadConfig } from '../config.js';
import { triggerAndWait } from './job-client.js';

const config = loadConfig();
const apiPort = process.env.API_PORT ?? String(config.API_CONTAINER_PORT);
const baseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const suffix = `seed-${config.CANONICAL_SEED}-v1`;
const sync = await triggerAndWait(config, baseUrl, 'sync', `suite-sync-${suffix}`);
const reconcile = await triggerAndWait(config, baseUrl, 'reconcile', `suite-reconcile-${suffix}`);
const syncResult = sync.job.result;
const reconcileResult = reconcile.job.result;
const durationMs = Number(syncResult.durationMs);
const acceptedRecords = Number(syncResult.acceptedRecords);
const conflictCount = Number(syncResult.conflicts);
const proposalsCreated = Number(reconcileResult.proposalsCreated);
const proposalsDeduplicated = Number(reconcileResult.proposalsDeduplicated);
const checks = {
  syncComplete: syncResult.status === 'complete',
  exactFixtureCount: acceptedRecords === 120_000,
  exactGoldenConflicts: conflictCount === 3050,
  ingestionUnderThirtySeconds: durationMs < 30_000,
  ingestionAtLeastFiveHundredPerSecond: acceptedRecords / (durationMs / 1000) >= 500,
  reconcileComplete: reconcileResult.status === 'complete',
  oneProposalPerConflict: proposalsCreated + proposalsDeduplicated === conflictCount,
  providerCalledOnlyForCreatedProposals: Number(reconcileResult.providerCalls) === proposalsCreated,
  sourceMirrorUnchanged: reconcileResult.sourceMirrorHashBefore === reconcileResult.sourceMirrorHashAfter,
  reconcileUnderThirtySeconds: Number(reconcileResult.durationMs) < 30_000
};
const status = Object.values(checks).every(Boolean) ? 'pass' : 'fail';
process.stdout.write(`${JSON.stringify({
  status,
  seed: config.CANONICAL_SEED,
  fixtureSchema: 'fixtures-v1',
  invariantRules: 'invariants-v1',
  provider: config.PROVIDER_MODEL,
  priceTable: config.PRICE_TABLE_VERSION,
  checks,
  metrics: {
    acceptedRecords,
    conflictCount,
    ingestionDurationMs: durationMs,
    ingestionRecordsPerSecond: Number((acceptedRecords / (durationMs / 1000)).toFixed(2)),
    reconcileDurationMs: Number(reconcileResult.durationMs),
    proposalsCreated,
    proposalsDeduplicated,
    providerCalls: Number(reconcileResult.providerCalls)
  },
  syncJob: { ...sync.reference, terminalStatus: sync.job.status, attempts: sync.job.attempt_count },
  reconcileJob: { ...reconcile.reference, terminalStatus: reconcile.job.status, attempts: reconcile.job.attempt_count }
}, null, 2)}\n`);
if (status !== 'pass') process.exitCode = 1;
