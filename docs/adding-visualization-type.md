# Adding A Visualization Type

Follow the existing scatter, histogram, and parallel-coordinate package shape
when adding a new chart family.

## Package Shape

Create a new visualization subtree under `packages/m-charts/src`:

```text
packages/m-charts/src/m-<viz>/core
packages/m-charts/src/m-<viz>/engine
packages/m-charts/src/m-<viz>/adapters
packages/m-charts/src/m-<viz>/react
packages/m-charts/src/m-<viz>/testing
```

Only `core` and `engine` should be required for the reusable library. Add
`adapters`, `react`, `testing`, or worker folders only when the visualization
needs them.

## Core

Put framework-neutral visualization logic in `core`:

- Typed input contracts and normalized data shapes.
- Typed-array buffer builders.
- Domains, transforms, layout, and formatting.
- Hit testing, hover or inspection lookup, selection math, and aggregation.
- WebGL renderer helpers and renderer-owned draw data.

Do not import React, React Router, demo routes, generated fixtures, app state,
theme modules, environment setup, or app-only code from `core`.

## Engine

Put the reusable plot API in `engine`:

- `create<Viz>Plot(host, options)`.
- Public option, command, event, snapshot, and binding types.
- Canvas, resize, WebGL context, render-loop, and dispose lifecycle.
- `plot.commands`, `plot.on(...)`, `plot.update(...)`, `plot.use(...)`, and
  `plot.dispose()`.
- Plain overlay descriptors for host-rendered UI.

Define the command/event/update contract before adding demo route glue. Decide
which state changes are semantic commands, which fields are controlled through
silent `update`, and which documented exceptions emit events from `update`.

## Bindings

Add default bindings only for reusable interaction behavior. Product shortcuts,
URL policy, export behavior, popovers, diagnostics, and persistence belong in
the host app or demo route.

Bindings should translate normalized pointer, wheel, and keyboard input into
commands or controlled updates. They should be replaceable or supplementable
through `plot.use(...)`.

## Adapters And Routes

Add adapters only when they translate a known source data shape into package
contracts. Do not let demo data shapes leak into `core`.

Add a demo route under `apps/demo` when the visualization needs a product-shell
example. A hidden fixture route is useful when it proves the engine can run from
direct typed inputs without route data loading.

Demo routes may own React state, URL/search params, generated data loading,
sidebars, overlays, export policy, theme state, diagnostics, and e2e hooks.
Those concerns must stay out of reusable `core` and `engine` modules.

## Shared Helpers

Keep `packages/m-charts/src/plot-engine/core` visualization-agnostic:
lifecycle, typed events, input normalization, RAF scheduling, disposables,
resize/WebGL helpers, brush metadata, metrics, and primitive geometry.

Leave chart-specific coordinate models in the visualization package until at
least two chart families need the same behavior. If scatter and another
Cartesian visualization both need shared axis transforms or pan/zoom helpers,
extract them to a dedicated shared layer rather than broadening
`plot-engine/core`.

Non-Cartesian visualizations should own their coordinate model in their own
`core` package. For example, a map package should own projection,
longitude/latitude, tile or world coordinates, wrapping, map zoom levels, and
projection-aware hit testing while still reusing shared lifecycle, input,
scheduling, and event primitives.

## Validation And Documentation

Add boundary tests that prevent reusable `core` and `engine` code from importing
demo routes, React-only code, generated fixtures, environment setup, or app-only
modules.

Update documentation when the public API, interactions, commands, events,
validation commands, routes, or migration behavior changes:

- Root `README.md` for high-level architecture and navigation.
- `packages/m-charts/llms.md` for detailed integration guidance.
- A package note such as `packages/m-charts/<VIZ>.md` for chart-specific data,
  interactions, commands, events, overlays, and performance notes.
- `CHANGELOG.md` for notable public changes.

Use the narrowest useful check while iterating, then run broader validation for
shared behavior:

```sh
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```
