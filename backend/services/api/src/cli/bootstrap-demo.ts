import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';
import { triggerAndWait } from './job-client.js';

const config = loadConfig();
const apiPort = process.env.API_PORT ?? String(config.API_CONTAINER_PORT);
const baseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const suffix = `bootstrap-${Date.now()}`;
// A managed Container can have materially less CPU than the Compose baseline.
// Bootstrap is a correctness gate, not a portable performance assertion.
const bootstrapPollTimeoutMs = 600_000;

const sync = await triggerAndWait(config, baseUrl, 'sync', `${suffix}-sync`, 3, bootstrapPollTimeoutMs);
assert.equal(sync.job.status, 'complete');
assert.equal(sync.job.result.status, 'complete');
assert.equal(sync.job.result.acceptedRecords, 120_000);
assert.equal(sync.job.result.conflicts, 3050);

const reconcile = await triggerAndWait(config, baseUrl, 'reconcile', `${suffix}-reconcile`, 3, bootstrapPollTimeoutMs);
assert.equal(reconcile.job.status, 'complete');
assert.equal(reconcile.job.result.status, 'complete');
assert.equal(reconcile.job.result.conflictCount, 3050);
assert.equal(Number(reconcile.job.result.proposalsCreated) + Number(reconcile.job.result.proposalsDeduplicated), 3050);
assert.equal(reconcile.job.result.sourceMirrorHashAfter, reconcile.job.result.sourceMirrorHashBefore);

const stretch = await triggerAndWait(config, baseUrl, 'stretch', `${suffix}-stretch`, 3, bootstrapPollTimeoutMs);
assert.equal(stretch.job.status, 'complete');
const stretchResult = stretch.job.result as {
  status: string;
  grouping: { groupCount: number };
  tickets: { extracted: number };
  autoApply: { applied: number; sourceMirrorHashBefore: string; sourceMirrorHashAfter: string };
};
assert.equal(stretchResult.status, 'complete');
assert.equal(stretchResult.autoApply.sourceMirrorHashAfter, stretchResult.autoApply.sourceMirrorHashBefore);

process.stdout.write(`${JSON.stringify({
  status: 'complete',
  acceptedRecords: sync.job.result.acceptedRecords,
  conflicts: sync.job.result.conflicts,
  proposalsCreated: reconcile.job.result.proposalsCreated,
  proposalsDeduplicated: reconcile.job.result.proposalsDeduplicated,
  groups: stretchResult.grouping.groupCount,
  tickets: stretchResult.tickets.extracted,
  autoApplied: stretchResult.autoApply.applied
})}\n`);
