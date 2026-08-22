# Keystone frontend

The React/Vite dashboard is a human review surface, not a source editor. It presents active source freshness, deterministic conflict counts, unchecked rules, spend, filterable conflicts, proposal state, confidence, sensitive holds, field lineage, audit history, and optimistic reviewer decisions.

## Design and accessibility contract

- Geist typography, deep-space surfaces, Arctic Cyan and Royal Purple named tokens.
- Semantic headings, tables, fieldsets, labels, machine-readable times, and live announcements.
- Status always includes text and a symbol; color is supplemental.
- Minimum 44px controls, visible focus, WCAG AA contrast, reduced-motion support, and internal table scrolling.
- The conflict detail is a labelled modal with initial focus, Escape close, a focus trap, and trigger-focus restoration.
- Every data surface has loading, empty, error, success, and partial-evidence behavior. Partial evidence is never rendered as clean.
- Layout is verified at 1440px desktop and an iPhone-sized narrow viewport.

The production nginx image is unprivileged and serves a strict CSP, `nosniff`, `DENY` framing, and `no-referrer`. `/api` is proxied to the API over internal Compose DNS so the browser uses one origin. TLS must be terminated by deployment ingress; local Compose intentionally uses loopback HTTP.

## Commands

```sh
npm run dev --workspace @keystone/frontend
npm run typecheck --workspace @keystone/frontend
npm run test:unit --workspace @keystone/frontend
npm run test:coverage --workspace @keystone/frontend
npm run build --workspace @keystone/frontend
npm run test:e2e
```

Vite development proxy defaults to API port 3000; set a compatible local override when using a different host port. The production image receives only the synthetic reviewer key at build time. Do not embed a real credential in a browser build; production authentication is outside this synthetic MVP.
