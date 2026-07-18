# m-charts Package

`packages/m-charts` contains the reusable WebGL2 and WebGPU chart source in this
repository. WebGL2 powers scatter, parallel-coordinate, and histogram engines;
the isolated WebGPU scatter backend supports point, bubble, and heat-map modes
while reusing the public scatter contract and interaction engine.

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

The package metadata and exports support local workspace and demo builds. This
package is private and has no npm publishing or package-release workflow. The
supported external integration path is source-copy.

## Source-Copy Setup

For another app, copy the shared plot engine plus the framework-neutral chart
folders you need:

```text
packages/m-charts/src/plot-engine -> src/vendor/m-charts/plot-engine
packages/m-charts/src/plot-engine-webgpu -> src/vendor/m-charts/plot-engine-webgpu
packages/m-charts/src/m-scatter/core   -> src/vendor/m-charts/m-scatter/core
packages/m-charts/src/m-scatter/engine -> src/vendor/m-charts/m-scatter/engine
packages/m-charts/src/m-scatter-webgpu/core -> src/vendor/m-charts/m-scatter-webgpu/core
packages/m-charts/src/m-scatter-webgpu/engine -> src/vendor/m-charts/m-scatter-webgpu/engine
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
import { createScatterPlot as createWebgpuScatterPlot } from 'm-charts/m-scatter-webgpu';

// Source-copy host import:
import { createScatterPlot } from './vendor/m-charts/m-scatter/engine/index.js';
import { createScatterPlot as createWebgpuScatterPlot } from './vendor/m-charts/m-scatter-webgpu/engine/index.js';
```

For a drop-in renderer switch, keep the factory name and change only the entry
point:

```ts
import { createScatterPlot } from 'm-charts/m-scatter-webgpu';
```

That entry point re-exports the complete WebGL2 scatter API surface and adds
WebGPU-specific APIs. Existing columns, options, bindings, commands, overlays,
events, and callback payloads remain compatible. WebGL2-only creation fields
are accepted and ignored; WebGPU-only creation fields require plot recreation
when changed. The WebGPU host/canvas also retain the shared engine CSS classes.
The renderer-owned `playEasterEgg()` command and its default typed `future`
sequence work on both backends.

Because external adoption currently uses source-copy rather than package
imports, existing consumers should keep their `m-scatter/core` imports, add the
WebGPU folders above, and change the factory import to
`m-scatter-webgpu/engine/index.js`. Await `plot.interactive` or `plot.ready`, and
keep the WebGL2 factory as a host-controlled fallback where WebGPU is not a hard
requirement. The complete copy/fallback recipe is in
[docs/source-copy-integration.md](../../docs/source-copy-integration.md#migrating-an-existing-webgl2-scatter).

See [docs/source-copy-integration.md](../../docs/source-copy-integration.md) for
copy matrices, worker setup, CSS/overlay responsibilities, and validation steps.

## Workspace Import Paths

These imports describe the local monorepo build surface and the intended future
package boundary:

```ts
import { createEmitter } from 'm-charts/plot-engine';
import { createScatterPlot } from 'm-charts/m-scatter';
import { createScatterPlot as createWebgpuScatterPlot } from 'm-charts/m-scatter-webgpu';
import { createParallelPlot } from 'm-charts/m-parallel';
import { createHistogramPlot } from 'm-charts/m-histogram';
```

The root package also exposes namespaces:

```ts
import { PlotEngine, PlotEngineWebgpu, MScatter, MScatterWebgpu, MParallel, MHistogram } from 'm-charts';
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

The shared lifecycle below uses the WebGL2 scatter factory. The WebGPU factory
retains it and adds `interactive`, `ready`, and `getWebgpuDiagnostics()`.

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
  listeners, resize observers, and renderer resources. Dispose externally created
  helpers such as scatter aggregation or selection worker controllers separately.

## Framework-Neutral WebGL2 Example

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

## Rendering Backends And Workers

`m-scatter`, `m-histogram`, and `m-parallel` require WebGL2 and report WebGL
context loss/restoration through typed events and metrics. `m-scatter-webgpu`
requires a secure WebGPU context and reports asynchronous readiness, device
loss, recovery, and recovery failure through the compatible scatter lifecycle.
Every engine adds canvases inside the host element; use a host with explicit
size because a zero-sized host cannot produce a useful render.

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

The WebGPU scatter supports `points`, `bubble`, and `heatmap` visualization
modes and exposes `plot.interactive` for the first
canvas frame plus `plot.ready` for first settled-frame completion. Settled
views render every visible point through one million points per subplot and a
deterministic sample capped at one million above that threshold. Continuous
viewport previews reuse a 1.5x overscanned last-complete cache. Hover and the
selected overlay use the same sample, which refines automatically on zoom;
selection payloads remain exact.
WebGPU readiness, initialization errors, device loss, and recovery are exposed
through the shared render-state/context lifecycle events. `interactive` and
`ready` remain available for callers that need promise-based startup gates.
Bubble output uses an exact-count, one-million-aggregate LOD per subplot, and
heat-map output is bounded by its pixel-derived populated-cell grid. Both modes
retain the WebGL2 aggregate hover, measurement, selection, palette/bin-size,
theme, and wheel interaction contracts.
Sorted-X bubble and heat-map aggregation use a Rust/WASM resident-memory
session by default: columns copy once when aggregate mode is first entered,
while subsequent builds and their exact membership results remain zero-copy.
Set the WebGPU-only `aggregationBackend` option to `auto`, `rust-wasm`, or
`typescript` to select the implementation explicitly for profiling.
`getWebgpuDiagnostics()` exposes both the requested and active aggregation
backend plus WASM setup/build/memory metrics. Rust/WASM requests still use the
exact TypeScript implementation as a safe fallback when unavailable.
Its optional
`indexedStyle` mode derives deterministic point styles in WGSL when style
columns are absent, avoiding per-point style storage. Large-data adapters may
instead pass prepacked style records through `packedStyles`; 4-byte records
upload directly and existing 8/12-byte records convert in bounded chunks. See
[SCATTER_WEBGPU.md](SCATTER_WEBGPU.md) for its precision, packed-buffer,
selection, profiling, demo, and benchmark contracts.

Finite JSON or server streams can use
`createFastScatterJsonRecordBatchSource` and
`createFastScatterWebgpuPlotFromDataSource`. The source declares its count and
supplies bounded batches, so the adapter allocates typed columns once instead
of retaining the complete JSON object graph. Existing `columns` creation is
unchanged.

For very large interactive datasets, build a reusable typed-array hover index
with `createFastScatterHoverIndex(columns, { yKeys })` and pass it as the
plot's `hoverIndex` option. Lookup stays synchronous, the index remains valid
across viewport changes, and callers that omit it retain the sorted-X fallback.
When one 32-bit point-index array per subplot is too large, await
`createFastScatterCompactHoverIndex(columns, { yKeys })`; its byte-sized Y
filter preserves exact nearest-point results with lower resident memory.

## Chart-Specific Docs

- [SCATTER.md](SCATTER.md): scatter plot source layout and exported names.
- [SCATTER_WEBGPU.md](SCATTER_WEBGPU.md): isolated WebGPU point, bubble, and heat-map scatter.
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
