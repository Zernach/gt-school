import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';
import { triggerAndWait } from './job-client.js';

const config = loadConfig();
const apiPort = process.env.API_PORT ?? String(config.API_CONTAINER_PORT);
const baseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const releaseSha = process.env.GT_SCHOOL_RELEASE_SHA ?? '';
const pollTimeoutMs = 600_000;

assert.match(releaseSha, /^[0-9a-f]{40}$/u, 'GT_SCHOOL_RELEASE_SHA must be the full release SHA');

const sync = await triggerAndWait(config, baseUrl, 'sync', `cloudflare-release-${releaseSha}-sync`, 3, pollTimeoutMs);
assert.equal(sync.job.status, 'complete');
assert.equal(sync.job.result.status, 'complete');
assert.equal(sync.job.result.acceptedRecords, 120_000);
assert.equal(sync.job.result.conflicts, 3050);

const reconcile = await triggerAndWait(config, baseUrl, 'reconcile', `cloudflare-release-${releaseSha}-reconcile`, 3, pollTimeoutMs);
assert.equal(reconcile.job.status, 'complete');
assert.equal(reconcile.job.result.status, 'complete');
assert.equal(reconcile.job.result.conflictCount, 3050);
assert.equal(Number(reconcile.job.result.proposalsCreated) + Number(reconcile.job.result.proposalsDeduplicated), 3050);
assert.equal(reconcile.job.result.sourceMirrorHashBefore, reconcile.job.result.sourceMirrorHashAfter);

process.stdout.write(`${JSON.stringify({
  status: 'pass',
  releaseSha,
  checks: {
    syncComplete: true,
    exactFixtureCount: true,
    exactGoldenConflicts: true,
    reconcileComplete: true,
    oneProposalPerConflict: true,
    sourceMirrorUnchanged: true
  },
  metrics: {
    syncDurationMs: sync.job.result.durationMs,
    reconcileDurationMs: reconcile.job.result.durationMs,
    acceptedRecords: sync.job.result.acceptedRecords,
    conflictCount: reconcile.job.result.conflictCount
  }
})}\n`);
