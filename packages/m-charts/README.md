# m-charts Package

`packages/m-charts` contains the reusable source for the WebGL2 chart engines
in this repository: shared plot-engine primitives, scatter, parallel-coordinate,
and histogram logic for high-performance data exploration in the browser.

The chart engines are framework-neutral rendering islands. A host application
creates a plot in a DOM element, pushes controlled state through
`plot.update(...)`, calls semantic `plot.commands.*`, observes typed events with
`plot.on(...)`, attaches optional input bindings with `plot.use(...)`, and calls
`plot.dispose()` when the host screen unmounts.

## Public Usage Status

`m-charts` is not published to npm yet, and `npm install m-charts` is not a
supported consumer path. Public adopters should copy the relevant source from
`packages/m-charts/src` into their application and rewrite imports to local
module paths. npm publication may come later, but it is not the current
integration path.

The exports below are maintained for local workspace/demo builds and to preserve
the intended package boundary for a future package release. This package does
not include npm publishing metadata, package packing steps, or publish
automation.

## Source-Copy Setup

For another app, copy the shared plot engine plus the framework-neutral chart
folders you need:

```text
packages/m-charts/src/plot-engine -> src/vendor/m-charts/plot-engine
packages/m-charts/src/m-scatter/core   -> src/vendor/m-charts/m-scatter/core
packages/m-charts/src/m-scatter/engine -> src/vendor/m-charts/m-scatter/engine
packages/m-charts/src/m-histogram/core   -> src/vendor/m-charts/m-histogram/core
packages/m-charts/src/m-histogram/engine -> src/vendor/m-charts/m-histogram/engine
packages/m-charts/src/m-parallel/core   -> src/vendor/m-charts/m-parallel/core
packages/m-charts/src/m-parallel/engine -> src/vendor/m-charts/m-parallel/engine
```

Add chart `adapters`, scatter `workers`, or chart `react` folders only when the
host uses those optional helpers. Full chart-folder copies are possible, but
non-React hosts should exclude/remove `react` folders or replace chart
`index.ts` barrels so copied source does not require React or JSX configuration.

Then rewrite package imports to local copied paths:

```ts
// Local workspace/demo package import:
import { createScatterPlot } from 'm-charts/m-scatter';

// Source-copy host import:
import { createScatterPlot } from './vendor/m-charts/m-scatter/engine/index.js';
```

See [docs/source-copy-integration.md](../../docs/source-copy-integration.md) for
copy matrices, worker setup, CSS/overlay responsibilities, and validation steps.

## Workspace Import Paths

These imports describe the local monorepo build surface and the intended future
package boundary:

```ts
import { createEmitter } from 'm-charts/plot-engine';
import { createScatterPlot } from 'm-charts/m-scatter';
import { createParallelPlot } from 'm-charts/m-parallel';
import { createHistogramPlot } from 'm-charts/m-histogram';
```

The root package also exposes namespaces:

```ts
import { PlotEngine, MScatter, MParallel, MHistogram } from 'm-charts';
```

Compatibility aliases are available inside the workspace:

```ts
import { createScatterPlot } from 'm-charts/scatter';
import { createParallelPlot } from 'm-charts/parallel';
import { createHistogramPlot } from 'm-charts/histogram';
```

Do not use these package imports in an external source-copy integration unless
the host app has created equivalent path aliases.

## Lifecycle Overview

```ts
import {
  createDefaultScatterBindings,
  createScatterPlot,
  type ScatterPlotOptions,
} from './vendor/m-charts/m-scatter/engine/index.js';

const host = document.querySelector<HTMLDivElement>('#chart');
if (!host) throw new Error('Missing #chart');

const options: ScatterPlotOptions = {
  axisMode: 'xy',
  columns,
  mode: 'zoom',
  spec,
  viewport,
};

const plot = createScatterPlot(host, options);

const selectionSubscription = plot.on('selectionchange', (event) => {
  console.log(event.selectedCount);
});

const bindings = plot.use(createDefaultScatterBindings());

plot.update({
  selectedSourceIndices: new Uint32Array([1, 3, 5]),
});

plot.commands.setViewport(viewport, 'programmatic', 'commit');

selectionSubscription();
bindings.dispose();
plot.dispose();
```

- Create: pass a sized DOM host and complete chart options.
- Update: call `plot.update(partialOptions)` for controlled state, data, theme,
  viewport, selection, or renderer changes from the host app.
- Commands: call `plot.commands.*` for semantic user or product actions.
- Events: subscribe with `plot.on(eventName, handler)` and unsubscribe when the
  observer is no longer needed.
- Dispose: call `plot.dispose()` to remove generated canvases/overlay elements,
  listeners, resize observers, and WebGL resources. Dispose externally created
  helpers such as scatter aggregation or selection worker controllers separately.

## Framework-Neutral Example

```ts
import {
  calculateScatterDomain,
  createDefaultScatterViewport,
} from './vendor/m-charts/m-scatter/core/index.js';
import {
  createDefaultScatterBindings,
  createScatterPlot,
} from './vendor/m-charts/m-scatter/engine/index.js';

const host = document.querySelector<HTMLDivElement>('#chart');
if (!host) throw new Error('Missing #chart');

const columns = {
  ids: ['row-1', 'row-2', 'row-3'],
  x: new Float32Array([1, 2, 3]),
  y: { metric: new Float32Array([8, 5, 13]) },
};
const spec = {
  xLabel: 'Time',
  plots: [{ id: 'metric', label: 'Metric', yKey: 'metric' }],
};

const plot = createScatterPlot(host, {
  axisMode: 'xy',
  columns,
  mode: 'zoom',
  spec,
  viewport: createDefaultScatterViewport(
    calculateScatterDomain(columns, spec),
  ),
});

plot.use(createDefaultScatterBindings());
plot.on('viewportchange', ({ viewport }) => {
  console.log(viewport.x);
});
```

React is optional. In React, use a `div` ref, create the plot in an effect,
subscribe to events in that effect, push prop/state changes through
`plot.update(...)`, render overlay descriptors in React if desired, and dispose
the plot in the effect cleanup. React helpers live under chart `react` subtrees;
`core` and `engine` modules must stay free of React dependencies.

## WebGL2 And Workers

All chart renderers require WebGL2. The engines add canvases inside the host
element and report WebGL context loss/restoration through typed events and
metrics. Use a host element with explicit size; a zero-sized host cannot produce
a useful render.

Scatter includes optional worker controllers under `m-scatter/workers` for
aggregation and selection. Copy `m-scatter/workers` only when the host uses
worker-backed aggregation or selection, then provide a bundler-specific
`createWorker` callback such as:

```ts
const createAggregationWorker = () =>
  new Worker(
    new URL('./vendor/m-charts/m-scatter/workers/aggregationWorker.ts', import.meta.url),
    { type: 'module' },
  );
```

Without a worker callback, the scatter controllers can run synchronously. If the
host app creates `FastScatterAggregationController` or
`FastScatterSelectionController` directly, dispose those controllers during
route/component cleanup so module workers are terminated. Histogram and parallel
do not require dedicated worker files in the current source tree. If your host
consumes emitted JavaScript instead of copied TypeScript source, point the
worker factory at the emitted `.js` file.

## Chart-Specific Docs

- [SCATTER.md](SCATTER.md): scatter plot source layout and exported names.
- [HISTOGRAM.md](HISTOGRAM.md): histogram source layout and exported names.
- [PARALLEL.md](PARALLEL.md): parallel-coordinate source layout and exported
  names.
- [llms.md](llms.md): detailed integration reference for commands, events,
  overlays, provenance, and performance notes.

## License

MIT. See [LICENSE](LICENSE).

The demo app in `apps/demo` is an integration example, not the package API.
Generated demo data is local to `apps/demo/public/data/` and is not part of this
package.

## Package Build Checks

```sh
pnpm --filter m-charts build
pnpm --filter m-charts typecheck
```
