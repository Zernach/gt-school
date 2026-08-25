# Cloudflare synthetic demo runbook

## Scope and non-goals

This is a manually released, Direct Upload demonstration for synthetic Keystone fixtures only:

- Dashboard: `https://gt-school.pages.dev`
- Backend smoke-test endpoint: the deployed `gt-school-demo-api` `workers.dev` URL
- Runtime: one `standard-1` Linux/amd64 Cloudflare Container instance
- Storage: PostgreSQL/pgvector and Redis exist only inside that instance's ephemeral filesystem

It is not a durable or high-availability deployment. There is no custom domain, Git-integrated Pages configuration, D1, R2, Cloudflare Queue, or Cloudflare application persistence. The required Durable Object binding exists only because Cloudflare Containers use it for instance identity; Keystone does not write its business state to Durable Object storage. A stop, restart, eviction, scale-to-zero, rollout, or crash deletes jobs, decisions, audits, spend state, and database data by design. The next startup rebuilds the canonical fixture baseline: 120,000 records and 3,050 deterministic conflicts, then creates proposal-only reconciliation output.

Cloudflare Workers Paid with Containers entitlement is required. This demo intentionally uses public `fixture-*` values that authorize only synthetic data; never copy a real client key, token, tenant, or export into this deployment.

## Topology and boundaries

`gt-school.pages.dev` serves Vite assets with the existing strict static headers. Its `/api/*` Pages Function forwards the original request through `KEYSTONE_DEMO_API`, a Cloudflare service binding—not a browser CORS hop—to `gt-school-demo-api`. The Worker permits only `GET`/`HEAD` health probes and the documented `GET`/`POST` `/api/v1/*` surface. It rejects unknown paths, other methods, malformed `Content-Length`, and known bodies larger than 1 MiB before allocating a Container. It preserves response streams and makes one retry only when `startAndWaitForPorts` sees the known lost-listener race before a request has been sent. It never retries a failed API fetch because that could replay a mutation.

The Container has no external internet egress. PostgreSQL and Redis bind `127.0.0.1`; Fastify alone listens on 8080 for Cloudflare ingress. `/health` covers API dependencies. `/ready` also requires the bootstrap sentinel, which the entrypoint writes after migrations, source fixture initialization, worker health, sync, and reconcile complete. A partial startup exits with bounded diagnostics rather than serving an incomplete baseline.

## One-time Pages bootstrap

The scripts always authenticate through the shared zprofile non-VPN Wrangler runner (`$HOME/code/zprofile/zprofile-run-function.zsh`). That runner routes Cloudflare API, OAuth challenge, and registry traffic outside the VPN, so persisted Wrangler OAuth can be used without a `CLOUDFLARE_API_TOKEN`. Create the Direct Upload Pages project once from a clean `main` checkout:

```sh
bash scripts/bootstrap_cloudflare_pages.sh
```

Set `ZPROFILE_FUNCTION_RUNNER` only to override the shared-runner location. Do not use the dashboard's drag-and-drop upload: it cannot compile the `functions/` directory. Direct Upload cannot later be converted to Git integration; that is intentional for this demo.

## Canonical release

Run only from an exact, clean, pushed `main` commit:

```sh
bash scripts/deploy_cloudflare_demo.sh
```

Or from the local control menu (`npm start`), choose **Deploy**, then **Frontend**, **Backend**, or **Both**. Layered uploads keep the same git and local gates, then publish only the selected surface:

```sh
bash scripts/deploy_cloudflare_demo.sh both      # default; Worker then Pages
bash scripts/deploy_cloudflare_demo.sh backend
bash scripts/deploy_cloudflare_demo.sh frontend
```

`scripts/deploy_backend.sh` and `scripts/deploy_frontend.sh` are the same entry points. The script refuses a detached branch, dirty checkout, non-`main` branch, non-full SHA, or a SHA that differs from `origin/main`. It seeds the fixtures and runs lint, typecheck, coverage, test/code ratio, golden, build, Compose configuration, Cloudflare source/type/build checks, image reset test, deployment-script test, Compose security/recovery/integration/suite/spend/benchmark/e2e checks. A backend or both release then authenticates, reads the managed Container registry as an entitlement preflight, deploys the tagged Worker, uses only `/health` to wake the request-started Container while it waits until the managed Container revision has a stable running instance (preventing a stale pre-rollout instance from satisfying readiness), requires three consecutive public `/ready` successes, and runs a direct Worker sync/reconcile correctness check. A frontend or both release then uploads Pages with the same full commit SHA. The local Compose `suite` remains the performance gate; the bootstrap and remote checks each allow up to ten minutes because Container startup/runtime speed is not a portable local-performance claim.

Set `GT_SCHOOL_BACKEND_WORKER_URL` only if Wrangler cannot print the account-specific `workers.dev` URL. The value must be the deployed Worker base URL, never a database, Container, or custom endpoint.

## Verification matrix

| Layer | Evidence |
|---|---|
| Worker source | `npm run test:cloudflare`, `npm run cloudflare:types`, `npm run dry-run --workspace @keystone/cloudflare-ingress` |
| Pages source | frontend proxy/config tests and `npm run typecheck:pages --workspace @keystone/frontend` |
| Ephemeral image | `npm run test:cloudflare-image` |
| Deploy orchestration | `npm run test:deploy` |
| Public backend | three `workers.dev/ready` successes, then direct exact-total sync/reconcile verification with a bounded ten-minute poll window |
| Public dashboard | `https://gt-school.pages.dev` load plus post-upload Playwright dashboard/proposal-hold review through the Pages proxy |

Local and source proof must not be presented as Cloudflare runtime or authenticated-browser proof.

## Failure and manual rollback

The release intentionally does not auto-rollback: database state is disposable, but deployment rollback remains an operator decision. On a failure it prints the Worker name, Pages project, source SHA, and the exact Worker rollback command:

```sh
(cd backend/cloudflare && npx --no-install wrangler rollback --name gt-school-demo-api --message "manual rollback after failed gt-school demo release")
```

That command selects the version immediately preceding the latest Worker version. If a specific Worker version is known, pass it as `wrangler rollback <VERSION_ID> --name gt-school-demo-api`. Pages has no Wrangler rollback command; in Workers & Pages > `gt-school` > Deployments, choose the prior successful production deployment and select **Rollback to this deployment**. Do not roll back either layer until the affected route and current version identifiers are inspected.
