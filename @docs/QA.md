# Keystone acceptance and QA

This document maps the graded contract to committed proof. Commands assume `npm ci`, canonical fixture generation, and a healthy Compose stack unless noted.

## Acceptance matrix

| Requirement | Owning implementation | Automated proof |
|---|---|---|
| Three read-only sources, immutable mirror, ingest time, field lineage | `sources/`, `ingestion/sync.ts`, DB grants/tables | source, lineage/projection, sync unit suites; live integration entity/conflict detail; role inspection |
| Versioned continuous invariants; exact golden set | `domain/invariants.ts`, `config/invariants.v1.json` | `npm run test:golden`: 3,050 expected/detected, zero false positives/negatives; 1,000 clean rows |
| Unified cross-source entity question | projection + `GET /api/v1/entities/:id` | committed `golden/entity-view.json` hand-check and live integration equality |
| Auditable filterable dashboard | overview/conflict/proposal API + React components | 250 frontend unit cases; 10 Playwright cases across desktop/narrow Chromium; live API reconciliation totals |
| Proposal-only reconciler | policy/provider/confidence/reconcile modules | unit matrices + live 3,050 proposal/dedup accounting + before/after mirror hash equality |
| Hard daily/run spend cap | transactional spend ledger | unit settlement/failure tests + `npm run test:spend-cap` real concurrent Postgres burst |
| Timeout/5xx/partial source | fault adapter + bounded source reader | fake-timer unit tests and live 5xx partial integration; all-or-nothing active snapshot assertion |
| Malformed/oversized input | streaming fixture reader, Zod, Fastify limit | 21 malformed generator cases; live 400/413/422 assertions |
| Duplicate/ambiguous identity and siblings | identity index + occurrence/household schema | property/scenario tests and golden overlaps/household minima |
| Sensitive holds and deterministic confidence | policy + confidence-v1 | exhaustive policy/confidence tests; live pending queue includes hard holds |
| Durable/replay-safe jobs | jobs table + Redis consumer group | API idempotency integration, live abandoned/duplicate delivery restart harness, replay reconciliation with zero provider calls |
| Tenant/reviewer isolation | key hashes and tenant-bound SQL | auth integration, viewer decision 403, query unit contracts, optimistic-version tests |
| Health/logging/privacy | API/worker health, redaction, audit | health integration, redaction unit suite, container health and structured logs |
| Cloudflare Worker boundary | `backend/cloudflare/src/` route policy and Container forwarding | Worker unit/type tests prove allowed routes/methods/body guard, unchanged stream bodies, singleton identity, one pre-forward listener retry, and structured 503s |
| Pages same-origin API bridge | `frontend/functions/api/[[path]].ts`, `frontend/wrangler.jsonc` | frontend tests prove service binding forward/missing-binding failure, generated binding types, and static-route exclusions |
| Ephemeral all-in-one reset | `backend/cloudflare/Dockerfile`, `ephemeral-entrypoint.sh` | `npm run test:cloudflare-image` builds Linux/amd64, proves `/ready`, sync/reconcile 120k/3050 totals, restarts, and proves review loss plus baseline restoration |
| Manual release ordering | `scripts/deploy_cloudflare_demo.sh` | `npm run test:deploy` stubs tooling to prove SHA/origin/dirty fail-closed gates, registry before Worker, three ready successes, live suite before Pages upload, and Pages-before-live-browser ordering |

## Test layers

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run test:coverage
npm run test:ratio
npm run test:golden
npm run build
npm run compose:config
npm run test:security
npm run test:worker-recovery
npm run test:integration
npm run test:spend-cap
npm run suite
npm run benchmark
npm run test:e2e
npm run cloudflare:types
npm run test:cloudflare
npm run test:cloudflare-image
npm run test:deploy
```

`test:ratio` counts nonblank production and test lines using committed source roots; tests must be strictly greater. Generated fixtures, golden bulk data, build output, and dependencies are excluded. Coverage independently targets the core logic required by the brief.

## Local evidence snapshot — 2026-08-22

- Backend core: 816 tests; 99.35% statements, 94.96% branches, 99.48% functions, 99.77% lines.
- Frontend: 250 tests; 98.65% statements, 89.94% branches, 100% functions/lines.
- Test/code ratio: 6,412 / 3,748 nonblank lines = 1.711.
- Golden: 3,050/3,050, zero false positives, zero false negatives; canonical generation byte-stable.
- Live integration: 10/10 across API, worker, Postgres, Redis, and fixture adapters.
- Worker recovery: one deliberately abandoned delivery reclaimed, its duplicate acknowledged, and one durable execution after a real graceful stop/start.
- Spend burst: 20 concurrent attempts, 5 allowed, 15 denied, 5 provider-boundary timestamps, 15 audits, 15 critical alerts; duplicate and new-action retries did not bypass the cap.
- Browser: desktop and narrow Chromium; security headers, responsive containment, keyboard filters, skip navigation, modal focus/Escape/restore, and axe WCAG A/AA checks. The in-app authenticated browser was unavailable, so this is repository Playwright proof rather than an in-app session claim.
- Performance: entity p95 42.90 ms and dashboard API bundle p95 512.85 ms over 20 runs; full sync/fresh reconcile/replay checkpoints 22.72 s / 6.45 s / 0.58 s.

These numbers are local Docker/source evidence, not deployment or production evidence. Re-run on the grader machine.

## Cloudflare evidence boundary

The local Cloudflare image and Worker/Page tests prove source, type, image, and local Docker behavior only. They do not prove account entitlement, registry authorization, Cloudflare Container runtime convergence, the deployed workers.dev endpoint, Pages Function bindings, or a live browser session. The release script requires those layers in this order: canonical fixture seed and full repository gates; Wrangler authentication; Container registry preflight; tagged Worker deploy; three consecutive public `/ready` responses; direct Worker sync/reconcile; Pages upload; then Playwright against `https://gt-school.pages.dev` that loads the dashboard and records a proposal hold through the Pages proxy. A deployment may be reported only after those direct endpoint and browser checks have actually run.

## Failure and recovery checks

- Stop or make a fixture source fault, submit a unique sync key, and verify the terminal run is `partial`/`failed`, the dependent invariant run is `partial` with `unchecked`, and existing active source pointers remain unchanged.
- Kill/restart the worker only after authorization; durable `queued`/`retry_wait` jobs are republished and idle stream messages are reclaimed. A message is acknowledged only after durable handling.
- Submit the same job key twice and verify the second response is 200 with `duplicate: true` and the same job ID.
- Submit the same reconciliation after proposals exist and verify all actions deduplicate with zero provider calls.
- Attempt a reviewer decision with viewer scope (403), stale version (409), and illegal terminal transition (409).
- Run the cap burst and reconcile its returned dashboard ledger with reservation, audit, and alert counts.

The executable Gherkin scenarios are documented in [features/reconciliation.feature](features/reconciliation.feature); their step bodies are the named unit, integration, cap, and Playwright suites above.
