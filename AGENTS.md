# System Contract for Agents

## Mission

Make the smallest complete change that improves the product without weakening
security, correctness, accessibility, operability, or maintainability. Inspect
the real execution path before editing. Preserve unrelated worktree changes.

## Read first

Before changing code, read the relevant `README.md`, this contract, and the
nearest existing implementation. Then locate the authoritative source for
routes, types, environment, Compose, migrations, scripts, tests, and deployment.
Use the repo-local skills in `.agents/skills/` when they match the task:
`add-backend-service` for new backend containers and `edit-frontend` for UI
work. Treat generated files, local overrides, and examples according to their
documented ownership; do not guess.

## Architecture and ownership

`frontend/` → API (`backend/services/api/`) → PostgreSQL + pgvector
(`backend/services/database/`) and Redis (`backend/services/queue/`). Browsers
talk only to the API. The API owns auth, validation, transactions, queue
submission, and result delivery. PostgreSQL is the system of record; Redis is
transport and must not silently replace durable storage.

- `backend/docker/compose.yaml` is tracked shared topology.
- `backend/docker/compose.local.yaml` is an ignored developer override; never
  place team or production requirements there.
- `backend/docker/compose.sh` is the Compose entry point.
- `backend/services/database/init/` runs only for a new database volume.
- `backend/services/database/migrations/` contains immutable forward migrations.
- `backend/services/database/SCHEMA.md` records schema and pgvector decisions.
- `backend/docker/.env.example` is runnable and secret-free; `.env` is local
  secret-bearing state and must remain ignored.

## Non-negotiable engineering rules

- Trace the terminal UI, API, types, persistence, migrations/backfills, and async work as one
  vertical contract. Do not ship a partial feature.
- Keep jobs idempotent, traceable, retry-bounded, replay-safe, and durable where
  their intent or result affects users or downstream systems.
- Use internal container DNS and service ports; never use `localhost` for a
  sibling container. Publish host ports only as explicit local overrides.
- Never commit credentials, tokens, private keys, production data, or generated
  artifacts. Do not add `privileged`, host networking, Docker socket mounts, or
  broad filesystem access as convenience fixes.
- Prefer least privilege, non-root processes, minimal images, explicit health
  checks, graceful shutdown, bounded resources, and useful structured logs.
- Make migrations additive and validated against existing data. Do not edit an
  applied migration or delete data/volumes without explicit authorization.

## Frontend baseline

Use the existing frontend system. When no stronger project convention exists,
use Geist typography, a deep-space dark surface hierarchy, and named highlight
tokens for Arctic Cyan (`#00E5FF`) and Royal Purple (`#7851A9`). Preserve
responsive layouts, semantic HTML, visible keyboard focus, contrast, reduced
motion, and loading/empty/error/success states. Never make color the only state
signal.

## pgvector discipline

For vector features, document the model, fixed dimension, distance metric and
operator, index strategy, source/chunk lineage, refresh policy, and deletion
behavior. Enforce dimensions in PostgreSQL; never downgrade vector behavior to
text, JSON, or Redis without a deliberate documented architecture change.

## Verification and handoff

Regularly improve the test system and use test-driven development for behavior
changes where practical. Engineer and maintain the appropriate mix of unit
tests, Gherkin acceptance tests, scripted QA procedures, quality metrics,
duplication checks, mutation tests, and coverage and cyclomatic-complexity
checks; use their results to guide focused improvements.

Run the narrowest relevant checks, then the repository's real gates. For
Compose/env changes run `./backend/docker/compose.sh config --quiet`. For runtime
work, build and start through the wrapper, wait for health, inspect logs, and
prove dependency/API behavior. Test failure and restart paths where relevant.
Do not claim browser, Docker, database, or production verification that was not
run; state the missing proof and residual risk.

Report the user-visible result, files changed, contracts/migrations affected,
security and accessibility decisions, commands and runtime evidence, and any
deferred risks. Append one completed-response row only to
`@docs/JOURNAL.csv`: `Prompt Summary,Original Prompt,Timestamp,Tokens,Elapsed`.
Keep `Prompt Summary` concise, and store the complete, exact user prompt as
typed in `Original Prompt` (using valid CSV quoting so commas, quotes, and
newlines remain part of that one field). Every row must populate all five
columns: record `Timestamp` at response completion as an ISO 8601 timestamp
with its UTC offset, `Tokens` as the agent runtime's actual total token count,
and `Elapsed` as the measured wall-clock seconds from task start to completion.
Codex agents must obtain the usage values from their runtime/accounting before
appending; never leave those fields blank or invent a numeric value. If the
runtime does not expose a metric, write the literal `unavailable` in that
field and state the missing telemetry in the handoff.
