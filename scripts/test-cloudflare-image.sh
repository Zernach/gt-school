#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_PLATFORM=linux/amd64
image_tag="keystone-cloudflare-demo:test"
container_name="keystone-cloudflare-demo-test-$$"
container_id=""

cleanup() {
  if [[ -n "$container_id" ]]; then docker rm --force "$container_id" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

docker build --platform "$CONTAINER_PLATFORM" --tag "$image_tag" --file "$ROOT_DIR/backend/cloudflare/Dockerfile" "$ROOT_DIR"
[[ "$(docker image inspect "$image_tag" --format '{{.Architecture}}')" == "amd64" ]] || { echo "cloudflare image must be linux/amd64" >&2; exit 1; }
container_id="$(docker run --platform "$CONTAINER_PLATFORM" --detach --publish 127.0.0.1::8080 --name "$container_name" "$image_tag")"

refresh_base_url() {
  # Docker Desktop may recreate the test container or republish its ephemeral
  # host port during a restart. Resolve both again rather than probing a stale
  # host mapping.
  container_id="$(docker ps --quiet --filter "name=^/${container_name}$")"
  [[ -n "$container_id" ]] || { echo "test container is not running" >&2; return 1; }
  host_port="$(docker port "$container_id" 8080/tcp | sed -E 's/.*:([0-9]+)$/\1/' | tail -1)"
  [[ "$host_port" =~ ^[0-9]+$ ]] || { echo "could not discover test container port" >&2; return 1; }
  base_url="http://127.0.0.1:$host_port"
}

refresh_base_url

for _attempt in {1..180}; do
  if curl --fail --silent --max-time 3 "$base_url/ready" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent --show-error --max-time 5 "$base_url/ready" >/dev/null

API_BASE_URL="$base_url" node --input-type=module <<'NODE'
const baseUrl = process.env.API_BASE_URL;
const reviewer = 'fixture-demo-reviewer-key-only';
const trigger = { sync: 'fixture-sync-trigger-secret-only', reconcile: 'fixture-reconcile-trigger-secret-only' };
const suffix = `cloudflare-image-${Date.now()}`;

async function envelope(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`request_failed:${path}:${response.status}:${JSON.stringify(body)}`);
  return body.data;
}

async function waitForJob(id) {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const run = await envelope(`/api/v1/runs/${id}`, { headers: { 'x-keystone-client-key': reviewer } });
    if (run.status === 'complete' || run.status === 'halted') return run;
    if (run.status === 'failed') throw new Error(`job_failed:${run.last_error ?? 'unknown'}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`job_timeout:${id}`);
}

async function start(type) {
  const reference = await envelope(`/api/v1/jobs/${type}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-keystone-client-key': reviewer, 'x-keystone-trigger-secret': trigger[type] },
    body: JSON.stringify({ idempotencyKey: `${suffix}-${type}`, generation: 3 })
  });
  return waitForJob(reference.id);
}

const sync = await start('sync');
if (sync.result.acceptedRecords !== 120000 || sync.result.conflicts !== 3050) throw new Error(`unexpected_sync_totals:${JSON.stringify(sync.result)}`);
const reconcile = await start('reconcile');
if (reconcile.result.conflictCount !== 3050) throw new Error(`unexpected_reconcile_totals:${JSON.stringify(reconcile.result)}`);
const proposals = await envelope('/api/v1/proposals?status=pending&limit=1', { headers: { 'x-keystone-client-key': reviewer } });
if (proposals.length !== 1) throw new Error('no_pending_proposal');
const reviewedProposalId = proposals[0].id;
await envelope(`/api/v1/proposals/${reviewedProposalId}/decision`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-keystone-client-key': reviewer },
  body: JSON.stringify({ decision: 'hold', reason: 'Ephemeral restart proof', version: proposals[0].version })
});
process.stdout.write(`${reviewedProposalId}\n`);
NODE

reviewed_proposal_id="$(API_BASE_URL="$base_url" node --input-type=module <<'NODE'
const response = await fetch(`${process.env.API_BASE_URL}/api/v1/proposals?status=held&limit=1`, { headers: { 'x-keystone-client-key': 'fixture-demo-reviewer-key-only' } });
const body = await response.json();
if (!response.ok || body.data.length !== 1) process.exit(1);
process.stdout.write(body.data[0].id);
NODE
)"
[[ -n "$reviewed_proposal_id" ]] || { echo "review state was not created before restart" >&2; exit 1; }

docker restart "$container_id" >/dev/null
refresh_base_url
for _attempt in {1..180}; do
  if curl --fail --silent --max-time 3 "$base_url/ready" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent --show-error --max-time 5 "$base_url/ready" >/dev/null
API_BASE_URL="$base_url" REVIEWED_PROPOSAL_ID="$reviewed_proposal_id" node --input-type=module <<'NODE'
const headers = { 'x-keystone-client-key': 'fixture-demo-reviewer-key-only' };
const response = await fetch(`${process.env.API_BASE_URL}/api/v1/proposals?status=held&limit=1`, { headers });
const body = await response.json();
if (!response.ok || body.data.length !== 0) throw new Error('review_state_survived_restart');
const overview = await fetch(`${process.env.API_BASE_URL}/api/v1/overview`, { headers });
const overviewBody = await overview.json();
if (!overview.ok || overviewBody.data.conflicts.active !== '3050') throw new Error(`baseline_not_restored:${JSON.stringify(overviewBody)}`);
NODE

echo "cloudflare all-in-one image reset verification passed"
