FROM --platform=linux/amd64 node:24-bookworm-slim AS api-build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/cloudflare/package.json backend/cloudflare/package.json
COPY backend/services/api/package.json backend/services/api/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend/services/api backend/services/api
RUN npm run build --workspace @keystone/api

FROM --platform=linux/amd64 node:24-bookworm-slim AS api-production-dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY backend/cloudflare/package.json backend/cloudflare/package.json
COPY backend/services/api/package.json backend/services/api/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev --workspace @keystone/api --include-workspace-root && npm cache clean --force

FROM --platform=linux/amd64 pgvector/pgvector:pg16-bookworm
USER root
RUN apt-get update \
  && apt-get install --yes --no-install-recommends redis-server ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt/keystone/api /opt/keystone/database/migrations /opt/keystone/config /opt/keystone/fixtures /opt/keystone/bin /tmp/keystone-postgres /tmp/keystone-redis /tmp/keystone-ready \
  && chown -R postgres:postgres /opt/keystone /tmp/keystone-postgres /tmp/keystone-redis /tmp/keystone-ready
COPY --from=api-build /usr/local /usr/local
COPY --from=api-production-dependencies --chown=postgres:postgres /workspace/node_modules /opt/keystone/api/node_modules
COPY --from=api-build --chown=postgres:postgres /workspace/backend/services/api/dist /opt/keystone/api/dist
COPY --chown=postgres:postgres backend/services/api/package.json /opt/keystone/api/package.json
COPY --chown=postgres:postgres backend/services/database/migrations /opt/keystone/database/migrations
COPY --chown=postgres:postgres config /opt/keystone/config
COPY --chown=postgres:postgres fixtures /opt/keystone/fixtures
COPY --chown=postgres:postgres backend/cloudflare/ephemeral-entrypoint.sh /opt/keystone/bin/ephemeral-entrypoint.sh
RUN chmod 0555 /opt/keystone/bin/ephemeral-entrypoint.sh
USER postgres
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/postgresql/16/bin" \
  NODE_ENV=production \
  HOST=0.0.0.0 \
  API_CONTAINER_PORT=8080 \
  WORKER_HEALTH_PORT=3001 \
  DATABASE_URL=postgresql://keystone_runtime:fixture-runtime-password-only@127.0.0.1:5432/keystone \
  DATABASE_ADMIN_URL=postgresql://keystone_owner@127.0.0.1:5432/keystone \
  QUEUE_URL=redis://127.0.0.1:6379/0 \
  FIXTURE_ROOT=/opt/keystone/fixtures/generated \
  MIGRATIONS_ROOT=/opt/keystone/database/migrations \
  CONFIG_ROOT=/opt/keystone/config \
  READINESS_SENTINEL_PATH=/tmp/keystone-ready/bootstrapped \
  PROVIDER_MODE=local
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=18 CMD ["node", "-e", "fetch('http://127.0.0.1:8080/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/opt/keystone/bin/ephemeral-entrypoint.sh"]
