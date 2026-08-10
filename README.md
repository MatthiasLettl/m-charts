# m-charts

`m-charts` is a WebGL2 and WebGPU charting library built for high-performance data
exploration in the browser. It provides framework-neutral chart engines for
scatter plots, histograms, and parallel-coordinate plots, plus a Vite demo app
that shows how to wire them into a product shell.

The project is useful when the chart needs to stay fast under dense typed-array
data, expose semantic commands and typed events, and let the host application own
the surrounding UI. The selected renderer creates and manages its WebGL2 or
WebGPU canvas resources; your app owns data loading, layout, side panels, URL
state, overlays, exports, persistence, and product policy.

## Public Usage Status

`m-charts` is not published to npm yet, and `npm install m-charts` is not a
supported consumer path. The current public integration path is source-copy:
copy the relevant chart source from `packages/m-charts/src` into the host
application, then rewrite imports to the copied local module paths.

Start with [docs/source-copy-integration.md](docs/source-copy-integration.md)
when integrating into another application.

## Features

- WebGL2 scatter, histogram, and parallel-coordinate engines.
- An isolated WebGPU point, bubble, and heat-map scatter renderer over the same
  public scatter contract, designed for million- to twenty-five-million-point
  workloads. Settled point views render every visible point through one million
  points per subplot and otherwise use a deterministic, source-ordered sample
  capped at one million representatives. High-density overviews retain
  categorical values, numeric extrema, and maximum-size style representatives.
  Rectangle/lasso selection payloads remain exact over the complete CPU data;
  hover and selected GPU overlays follow the rendered sample and refine on zoom.
  Bubble mode uses an exact-count bounded aggregate LOD and heat-map mode uses a
  compact populated-cell pass with typed interaction membership. Sorted-X
  aggregate modes prefer resident Rust/WebAssembly with an exact TypeScript
  fallback, selectable at WebGPU plot creation. Known-count record streams can
  be encoded into preallocated typed columns in bounded batches before the plot
  is created.
- An isolated WebGPU histogram renderer over the same public histogram
  contract. It renders every normalized bin/stack segment (histograms do not
  sample bars), accepts raw or pre-aggregated bar inputs, and uses exact
  Rust/WebAssembly aggregation by default for typed continuous,
  unsigned-integer categorical/boolean, and packed-rgba32 color columns with
  explicit domains.
  `aggregationBackend: 'auto' | 'rust-wasm' | 'typescript'` enables direct
  comparison; unsupported raw shapes use the exact TypeScript compatibility
  path.
- An isolated WebGPU parallel-coordinate backend over the same public parallel
  contract. Compute shaders bin every adjacent-axis segment, mix arbitrary
  record colors into continuous density, and render selected/preselected
  populations separately. Small datasets draw exact lines; large datasets add
  deterministic exact-style representatives. Single-axis zoom/pan uses
  lightweight representative feedback and recomputes only the affected
  adjacent-axis density pairs on release. That same GPU pass compacts
  viewport-qualified records into a bounded detail layer; once they fit, every
  qualifying line is rendered with raw-derived, viewport-relative Float32
  coordinates. Hover first follows that exact detail geometry, then falls back
  to a coalesced full-population GPU lookup for visible aggregate or overflow
  segments that have no nearby detail line.
- Typed-array data contracts for high-volume rendering and selection flows.
- Framework-neutral `core` and `engine` modules with optional React helpers.
- Imperative lifecycle: create a plot in a DOM host, call `update(...)`, invoke
  `commands.*`, observe `plot.on(...)`, attach optional bindings with `use(...)`,
  and release resources with `dispose()`.
- Host-rendered overlay descriptors for brushes, hover guides, measurement
  guides, navigator state, and inspection UI.

## Rendering Backends And Browser Support

- `m-scatter`, `m-histogram`, and `m-parallel` use WebGL2. They require a
  WebGL2-capable browser and do not support WebGL1-only environments.
- `m-scatter-webgpu`, `m-histogram-webgpu`, and `m-parallel-webgpu` use
  WebGPU. They
  require a secure context and a browser/device that can return a WebGPU
  adapter. WebGPU availability and device limits can differ from WebGL2 even in
  the same browser.
- All engines also depend on modern browser APIs such as typed arrays,
  `ResizeObserver`, and pointer events.

Existing WebGL2 scatter integrations can keep WebGL2 as a compatibility
fallback while adopting WebGPU. See
[Migrating An Existing WebGL2 Scatter](docs/source-copy-integration.md#migrating-an-existing-webgl2-scatter)
for source-copy and workspace-package examples.

## Architecture

The custom plot architecture uses a small stateful engine around
framework-neutral core logic. The engine exposes semantic commands, emits typed
events, and reconciles controlled host state through `plot.update(...)`.
Bindings, demo routes, and host applications decide how user input, URL state,
panels, keyboard shortcuts, exports, overlays, and persistence connect to those
commands, updates, and events.

![Backend-neutral custom plot architecture with WebGL2 and WebGPU renderers](docs/custom-plot-architecture.svg)

The mental model:

- `packages/m-charts/src/plot-engine/core` provides chart-agnostic browser
  primitives: typed emitters, disposables, normalized DOM input, brush metadata,
  resize lifecycle, WebGL2 context helpers, geometry, metrics, and RAF scheduling.
- `packages/m-charts/src/plot-engine-webgpu/core` provides WebGPU adapter/device
  setup, capability diagnostics, device-limit snapshots, and timestamp profiling.
- `packages/m-charts/src/<viz>/core` is pure visualization logic: typed data
  contracts, buffer builders, domains, transforms, hit testing, selection math,
  aggregation, formatting, and backend-specific renderer helpers.
- `packages/m-charts/src/<viz>/engine` is the reusable plot API. It takes a
  host element, creates its canvas or canvases, owns a backend-neutral renderer
  lifecycle, exposes
  `plot.commands`, emits typed events through `plot.on(...)`, accepts
  `plot.update(...)`, and supports attachable bindings with `plot.use(...)`.
- `packages/m-charts/src/<viz>/engine/default...Bindings.ts` translates
  normalized pointer, wheel, and keyboard input into engine commands. These
  bindings are optional; another product can replace or extend them without
  changing the renderer.
- Demo routes in `apps/demo` are app glue. They load datasets, adapt data, store
  URL/search state, render sidebars and overlays, materialize selected IDs,
  handle export policy, and subscribe to engine events.

Scatter's shared engine accepts a backend adapter for renderer construction and
context/device lifecycle. The existing `m-scatter` factory supplies WebGL2;
`m-scatter-webgpu` supplies WebGPU without importing either renderer into the
shared engine. Renderer implementations remain in their respective `core`
packages.

The WebGPU entry point re-exports the WebGL2 scatter contract and keeps the same
factory aliases, shared option shape, bindings, overlays, commands, events,
callback payloads, and shared CSS hooks. Existing integrations can switch the
import from `m-charts/m-scatter` to `m-charts/m-scatter-webgpu`; WebGPU startup
and device recovery then report through the shared lifecycle events. Its
creation-only renderer options, asynchronous startup gates, and representative
high-density point rendering are the documented backend-specific additions.
The histogram engine follows the same separation: `m-histogram` remains the
unchanged WebGL2-compatible entry point, while `m-histogram-webgpu` is its
export/type superset and swaps in the asynchronous WebGPU renderer plus the
creation-only aggregation backend selector.
Parallel follows the same compatibility model: `m-parallel` retains WebGL2,
while `m-parallel-webgpu` injects asynchronous pairwise density, exact
selection finalization, rendered-line hover, and axis viewport rendering.

Keep reusable `core` and `engine` modules independent of React, React Router,
demo routes, generated fixtures, app state, theme modules, local environment
setup, and app-only code. This is the boundary that makes scatter, histograms,
parallel coordinates, and future visualization types copyable.

## Engine Contract

Every chart engine should follow the same public shape:

- `plot.update(partialOptions)` reconciles controlled host state. It is the
  right path for React props, URL-restored state, theme/style changes,
  externally owned selections, and renderer options. It should be silent unless
  a field explicitly documents event emission.
- `plot.commands.*` is the semantic action API. Commands used by bindings,
  route handlers, or programmatic tools mutate engine-owned interactive state
  and emit matching typed events when observers need to react.
- `plot.on(event, handler)` is the observation API. Events should carry compact
  typed arrays, viewport ranges, source indices, brush ranges, filters, and
  action metadata such as `reason`, `phase`, or `source`; hosts materialize
  records, IDs, exports, and backend filters lazily.
- `plot.use(binding)` attaches optional input or integration bindings. Default
  bindings are reusable interaction policy, not hard-coded product shortcuts.
- Overlay state should be described with plain descriptors. Host applications
  choose whether to render overlays in DOM, SVG, canvas, React, or another UI
  layer.

Default interactions can vary by chart family, but the contract should stay
consistent: navigation, selection, hover/inspection, measurement, overlays, and
keyboard shortcuts flow through commands, updates, and events instead of moving
product policy into renderer code. Chart-specific interaction details live in
the package notes:

- [packages/m-charts/SCATTER.md](packages/m-charts/SCATTER.md)
- [packages/m-charts/SCATTER_WEBGPU.md](packages/m-charts/SCATTER_WEBGPU.md)
- [packages/m-charts/HISTOGRAM.md](packages/m-charts/HISTOGRAM.md)
- [packages/m-charts/HISTOGRAM_WEBGPU.md](packages/m-charts/HISTOGRAM_WEBGPU.md)
- [packages/m-charts/PARALLEL.md](packages/m-charts/PARALLEL.md)

For the detailed integration reference, see
[packages/m-charts/llms.md](packages/m-charts/llms.md).

## Quick Source-Copy Shape

Copy `packages/m-charts/src/plot-engine` plus the chart `core` and `engine`
folders you need into a host application, for example `src/vendor/m-charts`.
Add `adapters`, scatter `workers`, or chart `react` folders only when the host
uses those optional helpers. Then rewrite package imports to local imports:

```ts
import { createScatterPlot } from './vendor/m-charts/m-scatter/engine/index.js';
```

For WebGPU point, bubble, or heat-map scatter, keep the existing `m-scatter`
contract modules and add `plot-engine-webgpu`, `m-scatter-webgpu/core`, and
`m-scatter-webgpu/engine`. Include `m-scatter-webgpu/adapters` only when using
live typed batches, streamed JSON records, or the legacy preloading adapter.
Existing source-copy integrations keep their core imports and change the factory
import:

```diff
- import { createScatterPlot } from './vendor/m-charts/m-scatter/engine/index.js';
+ import { createScatterPlot } from './vendor/m-charts/m-scatter-webgpu/engine/index.js';
```

The same columns, options, bindings, commands, events, overlays, and shared CSS
hooks remain valid. WebGPU initialization is asynchronous, so await
`plot.interactive` for the first displayed frame or `plot.ready` for the first
complete settled frame. Large sorted datasets can use the lower-memory
`createFastScatterCompactHoverIndex` helper from `m-scatter`; WebGPU hover uses
that index to find the nearest rendered representative.
WebGPU bubble/heat-map aggregation can be profiled with
`aggregationBackend: 'auto' | 'rust-wasm' | 'typescript'`; the WebGPU demo
persists the same choice in its `aggregationBackend` query parameter.

For WebGPU histogram, keep `m-histogram/core` and `m-histogram/engine`, then add
`plot-engine-webgpu`, `m-histogram-webgpu/core`, and
`m-histogram-webgpu/engine`. Change only the factory import:

```diff
- import { createHistogramPlot } from './vendor/m-charts/m-histogram/engine/index.js';
+ import { createHistogramPlot } from './vendor/m-charts/m-histogram-webgpu/engine/index.js';
```

Raw columns, pre-aggregated bars, bindings, commands, events, overlays, and
shared CSS hooks remain compatible. Await `plot.ready`, handle startup
rejection, and keep the WebGL2 factory as a host-controlled fallback when
needed. The WebGPU-only `aggregationBackend` option selects exact Rust/WASM or
TypeScript aggregation; unsupported input shapes fall back to TypeScript.
The Rust/WASM path indexes continuous columns once, limits repeated aggregation
to visible candidates, reuses unchanged subplots, and materializes exact
source membership without switching backends.

The WebGPU demo generates its 1M, 10M, or 25M deterministic paged dataset in a
Web Worker on first use and stores it in IndexedDB for later visits. This is the
default in development and production; `?webgpuData=http` keeps the generated
HTTP artifact loader available for diagnostics. Dataset-size changes reload the
document so the previous large CPU and GPU allocations are released first.

Each plot needs a sized host element:

```html
<div id="chart" style="height: 420px; position: relative"></div>
```

Dispose plots when the screen or component unmounts:

```ts
const plot = createScatterPlot(host, options);

window.addEventListener('beforeunload', () => {
  plot.dispose();
});
```

## Minimal Examples

These examples assume you copied the source into `src/vendor/m-charts` and rewrote
imports to local module paths. They show the engine boundary only; real apps
usually build typed arrays from backend results or application data models.

### Scatter (WebGL2)

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
  ids: ['a', 'b', 'c'],
  x: new Float32Array([0, 1, 2]),
  y: { value: new Float32Array([3, 1, 4]) },
};

const spec = {
  xLabel: 'X',
  plots: [{ id: 'value', label: 'Value', yKey: 'value' }],
};

const viewport = createDefaultScatterViewport(
  calculateScatterDomain(columns, spec),
);
const plot = createScatterPlot(host, {
  axisMode: 'xy',
  columns,
  mode: 'zoom',
  spec,
  viewport,
});

plot.use(createDefaultScatterBindings());
plot.on('selectionchange', (event) => {
  console.log(event.selectedCount);
});
```

To use the WebGPU renderer with the same scatter contract, add the WebGPU source
folders, change the engine import to
`./vendor/m-charts/m-scatter-webgpu/engine/index.js`, and await startup. The
copy-ready migration and fallback example is
[docs/examples/scatter-webgpu-migration.md](docs/examples/scatter-webgpu-migration.md).

### Histogram

```ts
import {
  createDefaultHistogramBindings,
  createHistogramPlot,
} from './vendor/m-charts/m-histogram/engine/index.js';
import {
  buildHistogramAggregation,
  createDefaultHistogramViewport,
} from './vendor/m-charts/m-histogram/core/index.js';

const host = document.querySelector<HTMLDivElement>('#chart');
if (!host) throw new Error('Missing #chart');

const parameter = {
  key: 'latency',
  kind: 'numeric' as const,
  label: 'Latency',
};
const spec = {
  mode: 'histogram' as const,
  parameters: [parameter],
  subplots: [{ id: 'latency', label: 'Latency', parameterKey: 'latency' }],
};
const columns = {
  ids: ['a', 'b', 'c', 'd'],
  valuesByParameter: { latency: new Float32Array([12, 18, 21, 35]) },
};
const aggregation = buildHistogramAggregation(columns, { plotSpec: spec });
const viewport = createDefaultHistogramViewport(aggregation);

const plot = createHistogramPlot(host, {
  aggregation,
  columns,
  spec,
  viewport,
});

plot.use(createDefaultHistogramBindings());
```

To use WebGPU with the same histogram contract, add the WebGPU source folders,
change the engine import to
`./vendor/m-charts/m-histogram-webgpu/engine/index.js`, and await startup. The
copy-ready migration and fallback example is
[docs/examples/histogram-webgpu-migration.md](docs/examples/histogram-webgpu-migration.md).

### Parallel Coordinates

```ts
import {
  createDefaultParallelBindings,
  createParallelPlot,
} from './vendor/m-charts/m-parallel/engine/index.js';
import {
  createParallelFastBuffersFromDataset,
} from './vendor/m-charts/m-parallel/adapters/index.js';

const host = document.querySelector<HTMLDivElement>('#chart');
if (!host) throw new Error('Missing #chart');

const buffers = createParallelFastBuffersFromDataset(
  {
    metadata: { attributes: { parameters: ['speed', 'power', 'risk'] } },
    records: [
      { id: 'a', speed: 10, power: 0.8, risk: 3 },
      { id: 'b', speed: 12, power: 0.5, risk: 5 },
    ],
  },
  { includeWebglSegmentBuffers: true },
);

const plot = createParallelPlot(host, { buffers });
plot.use(createDefaultParallelBindings());
plot.on('selectionchange', (event) => {
  console.log(event.selectedCount);
});
```

The WebGPU parallel entry keeps this contract and adds exact packed-page
streaming for large inputs. In hybrid mode, await `plot.interactive` for the
representative frame and `plot.ready` for the completed full-population density
frame; every record still contributes to the settled aggregation.

## Demo App

Install workspace dependencies, generate local demo data, and run the Vite app:

```sh
pnpm install
pnpm generate:data:local
pnpm dev
```

The demo routes are:

- `/`: overview
- `/m-scatter`, `/m-scatter?tables=multi`, `/m-scatter-fixture`
- `/m-scatter-webgpu`, `/m-scatter-webgpu?tables=multi`,
  `/m-scatter-webgpu-fixture`, `/m-scatter-webgpu-streaming`
  (`?points=1000000|10000000|25000000` selects
  the primary-table size; WebGPU dataset size, table mode, and X-axis/mode
  switches use a full page refresh to release the previous large CPU/GPU
  resources; `?webgpuData=stream-local` generates the selected size in a worker,
  while `?webgpuData=stream-http` fetches a small paged binary sample and
  exercises unknown-count geometric buffer growth. The standalone streaming URL
  is retained as a compatibility redirect.)
- `/m-parallel`, `/m-parallel?tables=multi`, `/m-parallel-fixture`
- `/m-parallel-webgpu`, `/m-parallel-webgpu?tables=multi`,
  `/m-parallel-webgpu-fixture`
  (`?points=1000000|10000000|25000000` selects the shared paged dataset;
  committed axis ranges use `pf.<axis>.min`/`pf.<axis>.max` and survive reload)
- `/m-histogram`, `/m-histogram?tables=multi`,
  `/m-histogram?histMode=bar`, `/m-histogram-fixture`
- `/m-histogram-webgpu`, `/m-histogram-webgpu?tables=multi`,
  `/m-histogram-webgpu?histMode=bar`, `/m-histogram-webgpu-fixture`
  (`?points=1000000|10000000|25000000`; dataset-size, table-mode, input-mode,
  and aggregation-backend controls use full-document navigation)
- `?theme=light|dark` works on demo routes

Generated demo data lives under `apps/demo/public/data/`, is ignored by git, and
is not part of the reusable package source.

## Repository Structure

```text
packages/m-charts/src/plot-engine
packages/m-charts/src/plot-engine-webgpu
packages/m-charts/src/m-scatter
packages/m-charts/src/m-scatter-webgpu
packages/m-charts/src/m-parallel
packages/m-charts/src/m-parallel-webgpu
packages/m-charts/src/m-histogram
packages/m-charts/src/m-histogram-webgpu
apps/demo/src
tests/unit
tests/e2e
docs
```

Core and engine modules are framework-neutral. Demo routes, generated data,
local data loaders, URL state, theme state, panels, and e2e hooks live in
`apps/demo`.

Package notes:

- [packages/m-charts/README.md](packages/m-charts/README.md)
- [packages/m-charts/SCATTER.md](packages/m-charts/SCATTER.md)
- [packages/m-charts/SCATTER_WEBGPU.md](packages/m-charts/SCATTER_WEBGPU.md)
- [packages/m-charts/HISTOGRAM.md](packages/m-charts/HISTOGRAM.md)
- [packages/m-charts/HISTOGRAM_WEBGPU.md](packages/m-charts/HISTOGRAM_WEBGPU.md)
- [packages/m-charts/PARALLEL.md](packages/m-charts/PARALLEL.md)
- [packages/m-charts/PARALLEL_WEBGPU.md](packages/m-charts/PARALLEL_WEBGPU.md)
- [packages/m-charts/llms.md](packages/m-charts/llms.md)
- [docs/adding-visualization-type.md](docs/adding-visualization-type.md)

## Benchmarks

Benchmark helpers are separate from normal validation:

```sh
pnpm benchmark:scatter:custom
pnpm benchmark:scatter:webgpu
pnpm benchmark:histogram:custom
pnpm benchmark:parallel:custom
pnpm benchmark:parallel:webgpu
```

Use benchmark results as evidence for renderer or interaction changes, but keep
detailed run notes out of this README unless they change the project direction.

## Validation

Use the narrowest useful check while iterating, then run broader validation for
shared behavior:

```sh
pnpm typecheck
pnpm lint
pnpm lint:rust
pnpm check:aggregation-wasm
pnpm test:unit
pnpm test:e2e
pnpm build
```

Task-specific documentation changes should at least pass:

```sh
pnpm typecheck
pnpm lint
```

## Issues

Issues can be opened at any time for bugs, documentation gaps, integration
questions, and focused feature requests. Pull requests are not a primary project
workflow right now, so open an issue first before spending time on
implementation work.

## Security

Do not include exploitable vulnerability details in a public issue. See
[SECURITY.md](SECURITY.md) for supported versions and private reporting
instructions.

## License

MIT. See [LICENSE](LICENSE).
