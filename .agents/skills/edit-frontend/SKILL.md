---
name: edit-frontend
description: Make language-agnostic frontend changes that preserve a coherent design system, responsive behavior, accessibility, and runtime quality. Use when creating, editing, reviewing, or polishing frontend pages, components, layouts, navigation, forms, dashboards, or interactive states, especially when the project uses the Geist font family, a deep-space dark theme, Arctic Cyan, or Royal Purple accents.
---

# Edit Frontend

Edit the frontend as a coherent product surface. Preserve the host framework,
language, component model, routing, state conventions, data contracts, and
existing design tokens. Do not assume React, CSS, TypeScript, a browser-only
runtime, or a particular build tool until repository context confirms it.

## Gather context before editing

Inspect the root instructions, frontend README, package manifest and lockfile,
entry points, route/layout structure, shared components, theme/token files,
typography setup, asset pipeline, and the nearest comparable screen. Trace the
actual data and event path for interactive work: loading, success, empty,
error, retry, disabled, optimistic, and unauthorized states.

Search for existing Geist font loading, dark-surface tokens, Arctic Cyan and
Royal Purple definitions before adding new values. Reuse the established
component and styling primitives. If the repository has no token system, add
the smallest explicit token layer that can be reused; do not scatter raw color
or spacing values through individual components.

## Visual language

Use these as the default design direction unless the repository explicitly
defines a compatible variant:

- Typography: use the Geist font family through the project's supported font
  loading mechanism. Define intentional weights, line heights, fallback fonts,
  and loading behavior; do not assume the font is available globally.
- Theme: use a deep-space dark foundation with clear surface hierarchy. Keep
  page background, elevated panels, controls, borders, and overlays distinct
  enough to communicate structure without relying on shadows alone.
- Highlights: use Arctic Cyan (`#00E5FF`) and Royal Purple (`#7851A9`) as named
  design tokens. Use them for focus, active state, links, selected controls,
  meaningful data emphasis, and restrained gradients—not as body copy or
  decoration everywhere.
- Contrast: keep primary text, secondary text, borders, icons, focus rings,
  disabled states, and colored text legible against every surface. Never use
  accent color as the only indicator of state.
- Composition: favor deliberate spacing, readable line lengths, clear visual
  hierarchy, and responsive layouts over dense ornamentation. Use motion only
  to clarify state or continuity, and honor reduced-motion preferences.

Keep token names semantic, for example `color-bg-deep-space`,
`color-accent-arctic-cyan`, `color-accent-royal-purple`, `color-surface`, and
`color-text-primary`. Match the project's naming convention when one exists.

## Implement the complete interaction

For each change, cover the full user path rather than only the happy-path
markup:

- loading, empty, error, retry, success, disabled, hover, focus, active, and
  keyboard states where applicable
- semantic elements, accessible names, labels, descriptions, focus order, and
  visible focus indicators
- responsive behavior at the project's supported breakpoints, including long
  text, narrow widths, zoom, touch targets, and overflow
- async cancellation or stale-result handling, form validation, and safe error
  messages when data or network behavior is involved
- route, API, type, persistence, analytics, and permission contracts when the
  feature crosses those boundaries
- stable keys, cleanup of subscriptions/timers, and avoidance of unnecessary
  rendering or layout shifts

Do not hide content, remove existing behavior, weaken validation, or expose
secrets and internal errors to make a visual change fit. Preserve user input
and unsaved work where the existing product does so. Keep copy precise and
consistent with adjacent screens.

## Verify the result

Run the repository's real lint, typecheck, test, and build gates. For visual or
interactive changes, also verify the rendered surface at representative wide
and narrow sizes, keyboard-only navigation, focus visibility, reduced motion,
loading/error/empty states, and the browser console/network path when
available. Check that Geist actually loads with a valid fallback and that
Arctic Cyan and Royal Purple remain readable on every surface where used.

Prefer targeted regression tests for the changed interaction or reducer. Do
not claim visual or browser verification if it was not run; report unavailable
tools and the remaining risk explicitly.

## Handoff

Report the user-visible change, files and shared tokens changed, affected data
or route contracts, accessibility and responsive decisions, commands run,
visual/runtime evidence, and any deferred design or technical risks.
