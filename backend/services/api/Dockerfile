FROM node:24-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/services/api/package.json backend/services/api/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend/services/api backend/services/api
RUN npm run build --workspace @keystone/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S -g 10001 keystone && adduser -S -D -H -u 10001 -G keystone keystone
COPY package.json package-lock.json ./
COPY backend/services/api/package.json backend/services/api/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev --workspace @keystone/api --include-workspace-root && npm cache clean --force
COPY --from=build /workspace/backend/services/api/dist ./dist
COPY backend/services/database/migrations ./database/migrations
COPY config ./config
COPY fixtures ./fixtures
USER 10001:10001
EXPOSE 3000 3001
CMD ["node", "dist/server.js"]
