# Source-Copy Integration Guide

`m-charts` is currently adopted by copying source into a host application.
`m-charts` is not published to npm yet, and `npm install m-charts` is explicitly
unsupported for consumers. npm publication may come later, but this guide
documents the current public path.

For copy-ready snippets, see [docs/examples](examples/README.md).

## Copy The Required Source

Always copy the shared plot engine with any chart:

```text
packages/m-charts/src/plot-engine -> src/vendor/m-charts/plot-engine
```

Then copy one or more framework-neutral chart slices. Use `core` and `engine`
as the default required source. Add `adapters`, scatter `workers`, or chart
`react` folders only when the host uses those optional helpers.

| Chart | Required source | Optional source |
| --- | --- | --- |
| Scatter | `packages/m-charts/src/m-scatter/core`, `packages/m-charts/src/m-scatter/engine` | Add `workers` for worker-backed aggregation/selection, `adapters` for dataset helpers, and `react` only for React helpers. |
| Histogram | `packages/m-charts/src/m-histogram/core`, `packages/m-charts/src/m-histogram/engine` | Add `adapters` for dataset helpers and `react` only for React helpers. |
| Parallel | `packages/m-charts/src/m-parallel/core`, `packages/m-charts/src/m-parallel/engine` | Add `adapters` for dataset helpers and `react` only for React helpers. |

The `core` and `engine` folders are framework-neutral. The `react` folders are
optional helpers only. Full chart-folder copies are possible, but non-React
hosts should exclude/remove `react` folders or replace chart `index.ts` barrels
so copied source does not require React or JSX configuration. Do not copy demo
routes, generated datasets, app state, URL helpers, benchmark scripts, e2e
hooks, or local environment files as library code.

Generated demo data lives under `apps/demo/public/data/`, is ignored by git, and
is not part of the package source.

## Shared Plot-Engine Dependency

Each chart imports shared browser primitives from `plot-engine/core`: disposables,
typed emitters, DOM input normalization, brush metadata, resize lifecycle,
WebGL context lifecycle, geometry helpers, metrics, and RAF scheduling. Keep the
relative relationship between `plot-engine` and chart folders intact, or update
imports consistently.

A recommended destination layout is:

```text
src/vendor/m-charts/plot-engine
src/vendor/m-charts/m-scatter
src/vendor/m-charts/m-histogram
src/vendor/m-charts/m-parallel
```

With this layout, most internal relative imports remain valid after TypeScript
and bundler resolution are configured for ESM.

## Rewrite Imports

For application code, replace workspace package imports with local copied paths:

```ts
// Before, inside this monorepo:
import { createHistogramPlot } from 'm-charts/m-histogram';

// After, inside a source-copy host:
import { createHistogramPlot } from './vendor/m-charts/m-histogram/engine/index.js';
```

If your host app prefers aliases, map a local alias to the copied source and keep
the rewrite explicit:

```json
{
  "compilerOptions": {
    "paths": {
      "@vendor/m-charts/*": ["src/vendor/m-charts/*"]
    }
  }
}
```

Then import from the alias:

```ts
import { createParallelPlot } from '@vendor/m-charts/m-parallel/engine/index.js';
```

The source uses ESM `.js` specifiers in TypeScript files so emitted JavaScript is
valid. Preserve those specifiers unless your build tool has a different explicit
rewrite step.

## Scatter Worker Files

Scatter workers are optional. Synchronous aggregation and selection are available
without workers, but large datasets may benefit from copying or keeping:

```text
packages/m-charts/src/m-scatter/workers
```

Provide worker factories from the host app, using the path after your copy:

```ts
import { FastScatterAggregationController } from './vendor/m-charts/m-scatter/workers/aggregationController.js';

const aggregationController = new FastScatterAggregationController({
  columns,
  createWorker: () =>
    new Worker(
      new URL('./vendor/m-charts/m-scatter/workers/aggregationWorker.ts', import.meta.url),
      { type: 'module' },
    ),
  preference: 'auto',
});
```

Use the same pattern for `selectionWorker.ts` if you instantiate
`FastScatterSelectionController`, imported from
`m-scatter/workers/selectionController.js`. Dispose externally created
aggregation or selection controllers during route/component cleanup so module
workers are terminated. Confirm your bundler supports module workers with
`new URL(..., import.meta.url)`, or adapt the factory to the host bundler's
worker convention. If your host consumes emitted JavaScript instead of copied
TypeScript source, point the factory at the emitted `.js` worker file.

## Host DOM, CSS, And Overlays

The engines create canvas elements inside the host element. The host application
must provide layout and size:

```html
<div id="chart" class="chart-host"></div>
```

```css
.chart-host {
  height: 420px;
  min-width: 0;
  position: relative;
  width: 100%;
}
```

Scatter and histogram also create an overlay element for descriptors. Parallel
creates base and hover canvases. The library can emit overlay descriptors for
brushes, hover guides, measurements, navigator windows, and inspection state, but
the product shell decides how to render surrounding labels, tooltips, panels,
exports, popovers, keyboard help, and diagnostics.

Keep CSS for app chrome, panels, route layout, themes, and generated-data UI in
the host app. The copied library should stay focused on rendering and interaction
state.

## Minimal Lifecycle

```ts
import {
  createDefaultScatterBindings,
  createScatterPlot,
} from './vendor/m-charts/m-scatter/engine/index.js';

const host = document.querySelector<HTMLDivElement>('#chart');
if (!host) throw new Error('Missing #chart');

const plot = createScatterPlot(host, {
  axisMode: 'xy',
  columns,
  mode: 'zoom',
  spec,
  viewport,
});

const unsubscribe = plot.on('selectionchange', (event) => {
  console.log(event.sourceIndices);
});

const bindings = plot.use(createDefaultScatterBindings());

plot.update({ selectedSourceIndices: new Uint32Array([0, 2]) });
plot.commands.setViewport(viewport, 'programmatic', 'commit');

unsubscribe();
bindings.dispose();
plot.dispose();
```

Create the plot after the host element is mounted and sized. Call `update(...)`
for controlled host state changes, use `commands.*` for semantic actions, and
always dispose the plot when the page, route, or component unmounts.

## Data And Adapter Strategy

You can pass chart contracts directly or copy optional adapters:

- Scatter: pass scatter column contracts with `ScatterPlotSpec` and
  `ScatterViewport`, or copy `m-scatter/adapters` for supported dataset/table
  helpers.
- Histogram: pass `HistogramColumns`, `HistogramPlotSpec`, optional
  `HistogramAggregationSet`, and `HistogramViewport`, or copy
  `m-histogram/adapters`.
- Parallel: pass `ParallelBuffers`, usually built with
  `createParallelFastBuffersFromDataset(...)` from `m-parallel/adapters` or with
  lower-level buffer helpers from `m-parallel/core`.

Demo route loaders and generated fixtures are examples, not reusable API.

## Validate After Copying

In the host app:

```sh
pnpm typecheck
pnpm lint
pnpm build
```

Then verify in a browser with WebGL2 enabled:

- The host element has nonzero width and height.
- The chart renders without WebGL context errors.
- Pointer, wheel, and keyboard bindings work where enabled.
- `plot.on(...)` subscriptions receive expected viewport, selection, hover, or
  brush events.
- Source-copy import paths resolve without depending on this monorepo.
- Scatter worker factories load the copied worker files, if workers are enabled.

For changes inside this repository, Task 2 documentation should pass:

```sh
pnpm typecheck
pnpm lint
```
