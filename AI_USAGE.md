# AI usage disclosure

## Coding and review

OpenAI Codex was used interactively to inspect the supplied bootstrap, research, requirements, and repository contract; trace the full frontend/API/Postgres/Redis execution path; generate and refactor implementation code; design fixtures and tests; diagnose failures; run local verification; and draft documentation. The exact hosted coding-model identifier is controlled by the Codex runtime and is not embedded as a product dependency.

The material instructions shaping that work were:

- implement the complete Keystone requirements end to end;
- preserve read-only source boundaries, proposal-only core behavior, deterministic correctness, accessibility, security, and operability;
- use synthetic data only; and
- maintain more test code than production code while covering failure, retry, idempotency, and edge cases.

Human-supplied project sources `@docs/BOOTSTRAP.md`, `@docs/RESEARCH.md`, `@docs/REQUIREMENTS.md`, and `AGENTS.md` remained authoritative. Codex output was not accepted as proof by itself: TypeScript, ESLint, Vitest, coverage, golden comparison, live Compose integration, PostgreSQL concurrency checks, Playwright/axe, image builds, health checks, and benchmarks were run independently.

## Product reconciler

The demonstrated reconciler provider is the local, deterministic model `keystone-deterministic-v1` implemented in `backend/services/api/src/reconciliation/provider.ts`. It is not an external language model and makes no network call. It returns a schema-validated summary, stable evidence references, deterministic fixture token counts, and cost; it cannot choose its own action or confidence and cannot write to a source.

The price contract is `config/prices.v1.json`, version `prices-v1`, denominated in USD microcents:

- input: 1 microcent per 1,000 tokens;
- output: 1 microcent per 1,000 tokens; and
- reserved maximum: 10 microcents per call.

The policy action comes from committed code before the provider runs. Provider output must echo the expected action fingerprint. Confidence is computed by `confidence-v2`, not emitted by the provider. Worst-case cost is transactionally reserved before every call. Stretch auto-apply is a separate Keystone-internal function and still never writes a source system.

`PROVIDER_MODE=external` is intentionally fail-closed and reports that an external provider is not implemented. No external API key was used in the demonstrated run, no prompt containing real PII was sent to a provider, and the repository makes no claim that local deterministic output proves production LLM quality.
