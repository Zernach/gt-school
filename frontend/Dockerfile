FROM node:24-alpine AS build
WORKDIR /workspace
ARG VITE_DEMO_CLIENT_KEY=fixture-demo-reviewer-key-only
ENV VITE_DEMO_CLIENT_KEY=$VITE_DEMO_CLIENT_KEY
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/services/api/package.json backend/services/api/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
RUN npm run build --workspace @keystone/frontend

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist /usr/share/nginx/html
EXPOSE 8080
