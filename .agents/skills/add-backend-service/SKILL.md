---
name: add-backend-service
description: Safely gather context, design, implement, integrate, and verify a new backend service in a Docker or Docker Compose stack. Use when adding, containerizing, wiring, or reviewing an API, worker, scheduler, consumer, database-adjacent service, or other backend process, especially when the service must be complete, secure, observable, and compatible with existing repository conventions.
---

# Add Backend Service

Add a backend service as a complete vertical integration, not merely a new
Compose stanza. Preserve the repository's existing language, build, naming,
configuration, deployment, and verification conventions unless the task
explicitly changes them.

## Gather context before editing

Inspect these in order, adapting paths to the repository:

1. Read `AGENTS.md`, the root README, this skill, and any backend or Docker
   documentation.
2. Locate the authoritative Compose files, environment examples, wrapper
   scripts, CI/deploy definitions, service manifests, lockfiles, and test
   commands. Treat generated or local override files according to the repo
   contract; do not assume similarly named files have equal authority.
3. Map existing services, networks, volumes, health checks, startup ordering,
   exposed ports, user IDs, resource limits, and dependency connection names.
4. Trace a comparable existing service from source/build command through
   Compose, environment, health/readiness, logs, tests, and deployment.
5. Identify the requested service's process model, protocol, port, durable
   state, dependencies, background work, lifecycle, data ownership, and failure
   behavior. State unknowns before choosing defaults.

Use repository search and targeted file reads. Do not infer a framework,
language, cloud, database, queue, or public hostname from the service name.

## Define the service contract

Record the decisions before implementation:

- service name and unique container/DNS identity
- image or local build context, Dockerfile, target, and reproducible inputs
- command, entrypoint, working directory, user, and signal/shutdown behavior
- listening protocol and internal port; publish a host port only when required
- readiness health check that tests real service availability without leaking
  secrets or depending on a host-only path
- required dependencies and explicit startup/readiness semantics
- environment variables, safe defaults, validation, and secret ownership
- volumes and data lifecycle, including backup, migration, and deletion policy
- network boundaries, ingress/egress, authentication, authorization, and TLS
- logs, metrics, traces, correlation IDs, retry limits, and graceful failure
- CPU/memory/file/process limits and concurrency assumptions where supported

Prefer internal service DNS and container ports. Never use `localhost` for a
dependency inside a container. Keep paths relative to the authoritative Compose
file and preserve the project's Compose wrapper as the normal entry point.

## Implement completely

Update every source of truth that the contract requires, usually including:

- service source, Dockerfile, dependency manifest, lockfile, and tests
- tracked Compose topology and the correct local override example
- secret-free environment example plus startup validation
- migrations, initialization, indexes, queues, or durable state ownership
- health/readiness, graceful shutdown, idempotency, retry/dead-letter behavior
- API/client types, routes, worker registration, or event contracts
- CI/build/deploy configuration and operational documentation

Keep `.env.example` runnable but secret-free. Use real secret injection
mechanisms when the repository has them; never commit credentials, private keys,
tokens, or copied production values. Do not broaden host exposure, privileges,
capabilities, mounts, or network access without documenting and justifying it.
Prefer a non-root user, a minimal/pinned base image, no unnecessary packages,
read-only filesystems and dropped capabilities where compatible with the
runtime. Do not add `privileged`, host networking, Docker socket mounts, or
world-writable volumes as convenience fixes.

Make changes additive and reversible. Do not edit applied migrations, delete
existing volumes, overwrite user files, or silently rename existing service
identities. Preserve unrelated dirty worktree changes.

## Verify in layers

Run the repository's real gates, plus the narrowest useful checks for the new
service:

1. Parse/lint the changed source, Dockerfile, Compose YAML, scripts, and config.
2. Run `docker compose config` through the repository-owned wrapper with the
   intended environment and local override behavior.
3. Build the service and verify the image user, command, exposed/listening port,
   filesystem assumptions, and absence of accidental secrets.
4. Start the stack with its normal wrapper, wait for health, and inspect logs.
5. Prove the service can reach each declared dependency over internal DNS and
   that the expected API, job, consumer, or readiness behavior works.
6. Test failure paths: dependency unavailable, malformed configuration,
   duplicate delivery/retry, shutdown, and restart where applicable.
7. Stop or tear down only the test resources you created. Re-run config/startup
   checks to prove idempotency and avoid orphaned containers or volumes.

If Docker, a database, credentials, or a live dependency is unavailable, say
exactly which proof was not run. Do not claim runtime health from static checks.

## Handoff

Report the service contract, files changed, migrations or data effects, exposed
interfaces, security decisions, commands run, runtime evidence, and remaining
risks. Include explicit follow-up work for any deferred production hardening.
