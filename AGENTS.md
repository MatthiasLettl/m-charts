# Agent Notes

- Keep changes focused and do not revert unrelated user or agent edits.
- This repo contains the `m-charts` WebGL2 library, its demo app, docs, tests,
  and benchmark helpers. Keep additions within that scope; do not add alternate
  charting libraries, local env files, generated datasets, or unrelated demo
  routes.
- Treat `.env`, `.env.local`, generated datasets, reports, `dist`, and
  `node_modules` as local artifacts.

## Boundaries

- `packages/m-charts/src/*/core` and `packages/m-charts/src/*/engine` must not
  import React, React Router, demo routes, demo data/state/theme modules,
  generated fixtures, environment setup, or app-only code.
- Demo routes in `apps/demo` may import `m-charts` package APIs and local
  demo-only data/state/theme modules.
- Preserve public API compatibility. Prefer compatibility exports over
  renaming exported types, commands, events, option fields, payload fields,
  binding names, adapter names, or constants.

## Validation

Use the narrowest useful check while iterating, then run broader validation for
shared behavior:

```sh
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

Update `README.md`, `packages/m-charts/llms.md`, package notes, and
`CHANGELOG.md` when public API, interactions, commands, events, validation
commands, routes, or migration behavior change.
