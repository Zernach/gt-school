# Backend

This directory is a Docker Compose application made of three independent images:

- `api` is a language-agnostic HTTP API placeholder. Replace its image or change
  it to a `build: ../services/api` service after choosing the API language and
  framework.
- `postgres` is PostgreSQL with the `pgvector` extension enabled.
- `queue` is Redis, a small queue/broker suitable for background work.

Use the backend-owned Compose wrapper from the project root:

```sh
./backend/docker/compose.sh up --wait
```

The default API image is `traefik/whoami`, only so a fresh stack has a reachable
HTTP service. It is not application code. Set `API_IMAGE` and
`API_CONTAINER_PORT` in `backend/docker/.env`. Once the project chooses an API
language, add its Dockerfile in `services/api/` and commit the corresponding
`build: ../services/api` change in `docker/compose.yaml` with the API source.
`docker/compose.local.yaml` is strictly for developer-machine overrides; the
wrapper loads it automatically and keeps it out of version control.

The wrapper is also the single entry point for `ps`, `logs`, `down`, and other
Docker Compose subcommands:

```sh
./backend/docker/compose.sh ps
./backend/docker/compose.sh logs --follow api
```

Database initialization SQL belongs in `services/database/init/`; versioned
application migrations belong in `services/database/migrations/`.
