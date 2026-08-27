# Keystone frontend

The React/Vite dashboard is a human review surface, not a source editor. It presents active source freshness, deterministic conflict counts, unchecked rules, spend, filterable conflicts, proposal state, confidence, sensitive holds, field lineage, audit history, and optimistic reviewer decisions.

## Design and accessibility contract

- Geist typography, deep-space surfaces, Arctic Cyan and Royal Purple named tokens.
- Semantic headings, tables, fieldsets, labels, machine-readable times, and live announcements.
- Status always includes text and a symbol; color is supplemental.
- Minimum 44px controls, visible focus, WCAG AA contrast, reduced-motion support, and internal table scrolling.
- The conflict detail is a labelled modal with initial focus, Escape close, a focus trap, and trigger-focus restoration.
- Every data surface has loading, empty, error, success, and partial-evidence behavior. Partial evidence is never rendered as clean.
- The first overview read wakes the transient demo backend. While its canonical baseline is rebuilding, the dashboard shows one live restoration state and retries automatically instead of rendering startup zeroes.
- Layout is verified at 1440px desktop and an iPhone-sized narrow viewport.

The production nginx image is unprivileged and serves a strict CSP, `nosniff`, `DENY` framing, and `no-referrer`. `/api` is proxied to the API over internal Compose DNS so the browser uses one origin. TLS must be terminated by deployment ingress; local Compose intentionally uses loopback HTTP.

## Cloudflare Pages demo

`wrangler.jsonc` defines the Direct Upload Pages project `gt-school` and the `KEYSTONE_DEMO_API` service binding to the backend Worker. `functions/api/[[path]].ts` forwards the original browser request to that binding, retaining the existing relative `/api/v1/*` client contract and deliberately adding no browser CORS policy. `public/_headers` preserves the static security headers; `public/_routes.json` invokes a Function only for `/api/*` and excludes static assets.

Pages deployment is intentionally manual Direct Upload, never Git-integrated. The public hostname is `https://gt-school.pages.dev`; it is only a synthetic, ephemeral demo and should not receive a real client key or data export. Generate binding types after changing either Wrangler configuration:

```sh
npm run cloudflare:types
```

## Commands

```sh
npm run dev --workspace @keystone/frontend
npm run typecheck --workspace @keystone/frontend
npm run test:unit --workspace @keystone/frontend
npm run test:coverage --workspace @keystone/frontend
npm run build --workspace @keystone/frontend
npm run test:e2e
```

Vite development proxy defaults to API port 3000; set `VITE_API_PROXY_TARGET`
when running it manually against a different host port. The root `Start stack`
flow derives the configured Compose `API_PORT` automatically. The production
image receives only the synthetic reviewer key at build time. Do not embed a
real credential in a browser build; production authentication is outside this
synthetic MVP.
