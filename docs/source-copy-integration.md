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
| Scatter WebGPU | The WebGL2 scatter `core` and `engine` contract above, plus `packages/m-charts/src/plot-engine-webgpu`, `packages/m-charts/src/m-scatter-webgpu/core`, and `packages/m-charts/src/m-scatter-webgpu/engine` | Supports point, bubble, and heat-map modes. Add `m-scatter-webgpu/adapters` for live typed batches or streamed JSON records, and `@webgpu/types` when the TypeScript DOM library does not declare WebGPU. |
| Histogram | `packages/m-charts/src/m-histogram/core`, `packages/m-charts/src/m-histogram/engine` | Add `adapters` for dataset helpers and `react` only for React helpers. |
| Histogram WebGPU | The histogram `core` and `engine` contract above, plus `packages/m-charts/src/plot-engine-webgpu`, `packages/m-charts/src/m-histogram-webgpu/core`, and `packages/m-charts/src/m-histogram-webgpu/engine` | Add `@webgpu/types` when the host TypeScript DOM library does not declare WebGPU. The shared WebGPU folder contains the embedded Rust aggregation binary. |
| Parallel | `packages/m-charts/src/m-parallel/core`, `packages/m-charts/src/m-parallel/engine` | Add `adapters` for dataset helpers and `react` only for React helpers. |
| Parallel WebGPU | The parallel `core` and `engine` contract above, plus `packages/m-charts/src/plot-engine-webgpu`, `packages/m-charts/src/m-parallel-webgpu/core`, and `packages/m-charts/src/m-parallel-webgpu/engine` | Add `@webgpu/types` when the host TypeScript DOM library does not declare WebGPU. Use `createParallelWebgpuBuffers` only when WebGL2 fallback is not required. |

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
WebGL2 context lifecycle, geometry helpers, metrics, and RAF scheduling. WebGPU
charts additionally import adapter/device lifecycle, profiling, and shared
aggregation-WASM primitives from `plot-engine-webgpu/core`. Keep the relative relationship between the
plot-engine and chart folders intact, or update imports consistently.

A recommended destination layout is:

```text
src/vendor/m-charts/plot-engine
src/vendor/m-charts/plot-engine-webgpu
src/vendor/m-charts/m-scatter
src/vendor/m-charts/m-scatter-webgpu
src/vendor/m-charts/m-histogram
src/vendor/m-charts/m-histogram-webgpu
src/vendor/m-charts/m-parallel
src/vendor/m-charts/m-parallel-webgpu
```

With this layout, most internal relative imports remain valid after TypeScript
and bundler resolution are configured for ESM.

Each WebGPU factory returns synchronously but exposes `plot.interactive` and
`plot.ready`. Await `interactive` before treating the first displayed frame as
available, or `ready` before treating adapter/device creation, persistent buffer
upload, and the first complete settled representation as complete. Scatter can
report a style-preserving point LOD at high density; parallel coordinates can
report a bounded exact-style representative layer before complete density;
histogram always renders every resulting bin/stack segment. Both promises
reject on initialization failure. The host
must run in a secure context supported by WebGPU.

If the host TypeScript configuration does not yet declare WebGPU globals, add
`@webgpu/types` and include it in the applicable `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@webgpu/types"]
  }
}
```

Merge this entry with existing `types`; do not replace unrelated host typings.

## Rewrite Imports

For application code, replace workspace package imports with local copied paths:

```ts
// Before, inside this monorepo:
import { createHistogramPlot } from 'm-charts/m-histogram';

// After, inside a source-copy host:
import { createHistogramPlot } from './vendor/m-charts/m-histogram/engine/index.js';
```

For a histogram WebGPU migration, keep the factory name and options and switch
the constructor import:

```ts
import {
  createHistogramPlot,
} from './vendor/m-charts/m-histogram-webgpu/engine/index.js';
```

The WebGPU entry point is a compatibility superset. It adds the creation-only
`aggregationBackend` and `requestTimestampQuery` options plus readiness and
diagnostic APIs. `aggregationBackend` defaults to `auto` (Rust/WASM with an
exact TypeScript compatibility fallback).

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

## Migrating An Existing WebGL2 Scatter

The WebGPU scatter reuses the existing scatter `core` and backend-neutral
`engine` contract. Existing columns, specs, viewport state, options, default or
custom bindings, commands, events, overlays, callback payloads, and shared
`scatter-fast-engine-*` CSS hooks remain valid. Point, bubble, and heat-map
visualization modes are supported by both scatter entry points.

For a local workspace package import, keep the factory name and change the entry
point:

```diff
- import { createScatterPlot } from 'm-charts/m-scatter';
+ import { createScatterPlot } from 'm-charts/m-scatter-webgpu';
```

For the supported source-copy path, keep utility/data-contract imports from the
existing scatter `core` and change only the engine factory import after copying
the additional WebGPU folders:

```ts
import {
  calculateScatterDomain,
  createDefaultScatterViewport,
} from './vendor/m-charts/m-scatter/core/index.js';
import {
  createDefaultScatterBindings,
  createScatterPlot,
} from './vendor/m-charts/m-scatter-webgpu/engine/index.js';
```

`ScatterPlotOptions` is exported from `m-scatter/engine`, not `core`; when the
host needs that type, import it alongside the WebGL2 factory or use
`FastScatterWebgpuPlotOptions` from the WebGPU engine. Avoid the copied
`m-scatter-webgpu/index.ts` top-level barrel in framework-neutral hosts because
it re-exports the complete scatter barrel, including optional React helpers.

Creation remains synchronous, but WebGPU startup does not. An unconditional
switch should surface `plot.interactive` or `plot.ready` rejection in the host:

```ts
const plot = createScatterPlot(host, options);
plot.use(createDefaultScatterBindings());

try {
  await plot.interactive;
  await plot.ready;
} catch (error) {
  plot.dispose();
  throw error;
}
```

Applications that still support WebGL2-only clients can keep the original
renderer as a fallback. Capability diagnosis catches missing adapters; the
startup `try`/`catch` also covers dataset-specific device limits, allocation,
and shader failures that basic feature detection cannot predict:

```ts
import { diagnoseWebgpuSupport } from './vendor/m-charts/plot-engine-webgpu/core/index.js';
import {
  createScatterPlot as createWebglScatterPlot,
  type ScatterPlotOptions,
} from './vendor/m-charts/m-scatter/engine/index.js';
import {
  createScatterPlot as createWebgpuScatterPlot,
} from './vendor/m-charts/m-scatter-webgpu/engine/index.js';

async function createSupportedScatter(
  host: HTMLElement,
  options: ScatterPlotOptions,
) {
  const support = await diagnoseWebgpuSupport();
  if (support.adapterAvailable) {
    let webgpuPlot: ReturnType<typeof createWebgpuScatterPlot> | undefined;
    try {
      webgpuPlot = createWebgpuScatterPlot(host, options);
      await webgpuPlot.interactive;
      await webgpuPlot.ready;
      return webgpuPlot;
    } catch (error) {
      webgpuPlot?.dispose();
      console.warn('WebGPU scatter startup failed; using WebGL2.', error);
    }
  }

  return createWebglScatterPlot(host, options);
}
```

Attach bindings and subscriptions to the returned instance so they survive the
backend choice. This conservative fallback waits for the first complete settled
WebGPU frame; a host may expose UI after `interactive` resolves, but it must
still decide how to handle a later `ready` rejection. Whether an initialization
error should fall back or block is host product policy; always dispose the
failed WebGPU instance before creating WebGL2 in the same host.

The WebGL2-only creation fields `forceWebglUnavailable`,
`preserveDrawingBuffer`, and `rendererFactory` are accepted and ignored by the
WebGPU factory. WebGPU adds the creation-only `aggregationBackend`,
`indexedStyle`, `packedStyles`, and `requestTimestampQuery` fields; recreate the
plot to change them. `aggregationBackend` is not a WebGL2 option and applies
only to WebGPU bubble/heat-map aggregation: `auto` and `rust-wasm` prefer
Rust/WebAssembly with exact TypeScript fallback, while `typescript` bypasses
WebAssembly. Continue using `plot.update(...)` for shared mutable state.
The WebGPU instance also adds `getWebgpuDiagnostics()`. The command surface is
compatible, including renderer-owned `playEasterEgg()` playback and the default
typed `future` sequence.

To change an existing all-at-once WebGPU integration to live loading, keep the
plot options and replace `columns`/`spec` with the streaming adapter source:

```ts
import {
  createFastScatterJsonRecordBatchSource,
  createFastScatterWebgpuStreamingPlot,
  createFastScatterWebgpuStreamSourceFromRecordBatches,
} from './vendor/m-charts/m-scatter-webgpu/adapters/index.js';

const response = await fetch('/api/points');
if (response.body === null) throw new Error('Missing response body');
const records = createFastScatterJsonRecordBatchSource(response.body, {
  schema,
});
const { columns: _columns, spec: _spec, ...streamOptions } = options;
const plot = await createFastScatterWebgpuStreamingPlot(host, {
  ...streamOptions,
  dataSource: createFastScatterWebgpuStreamSourceFromRecordBatches(records),
});
await plot.streaming.done;
```

Add `count` when the server declares it to preallocate and validate the final
total; it is optional for the live bridge. The plot is returned after the first
non-empty batch, so bindings and interactions can start while later batches
arrive. Typed-batch sources do not need a final count; `expectedCount` and
`initialCapacity` are allocation hints.
`plot.streaming.abort()`, `plot.dispose()`, and an optional `signal` cancel the
load. A transport failure or abort rejects `plot.streaming.done` but leaves the
loaded prefix in the normal settled render mode while the plot remains mounted.

See [the copy-ready migration example](examples/scatter-webgpu-migration.md) and
[the WebGPU scatter guide](../packages/m-charts/SCATTER_WEBGPU.md) for lifecycle,
rendering, aggregation, diagnostics, streaming, demo, and benchmark details.

## Migrating An Existing WebGL2 Histogram

The WebGPU histogram reuses the existing histogram `core`, backend-neutral
`engine`, and default bindings. Existing raw columns, pre-aggregated bars,
specs, viewport/bin-size state, options, commands, events, overlays, callback
payloads, and shared `histogram-fast-engine-*` CSS hooks remain valid.

For a workspace package consumer, retain the factory name and change only the
entry point:

```diff
- import { createHistogramPlot } from 'm-charts/m-histogram';
+ import { createHistogramPlot } from 'm-charts/m-histogram-webgpu';
```

For source-copy integration, keep utility and data-contract imports from
`m-histogram/core`, add the WebGPU folders listed above, and import the factory
from `m-histogram-webgpu/engine/index.js`. Creation remains synchronous but
device startup and the first exact frame do not:

```ts
const plot = createHistogramPlot(host, options);
plot.use(createDefaultHistogramBindings());

try {
  await plot.ready;
} catch (error) {
  plot.dispose();
  throw error;
}
```

The WebGL2-only `forceWebglUnavailable`, `preserveDrawingBuffer`, and
`rendererFactory` fields are accepted and ignored by the WebGPU factory.
WebGPU adds the creation-only `aggregationBackend` and
`requestTimestampQuery`; recreate the plot to change them.
`aggregationBackend: 'auto' | 'rust-wasm' | 'typescript'` selects the exact raw
aggregation implementation. `auto` and `rust-wasm` prefer the embedded
Rust/WASM implementation for supported typed columns and fall back to the
TypeScript builder for unsupported shapes. Supported inputs materialize exact
source membership in Rust/WASM. Pre-aggregated bar mode bypasses raw
aggregation.

Applications retaining WebGL2 support should diagnose WebGPU, attempt startup,
dispose a failed WebGPU instance, and then create the original WebGL2 plot in
the same host. See
[the copy-ready histogram migration example](examples/histogram-webgpu-migration.md)
and [the WebGPU histogram guide](../packages/m-charts/HISTOGRAM_WEBGPU.md) for
fallback code, lifecycle, aggregation, diagnostics, and validation details.

## Migrating Existing WebGL2 Parallel Coordinates

The WebGPU parallel renderer uses the existing parallel `core`, backend-neutral
`engine`, and default bindings. Existing buffers, brush intervals, selected and
preselected indices, options, commands, events, overlays, selection and
inspection payloads, themes, keyboard shortcuts, and controlled updates remain
valid.

For a workspace package consumer, retain the factory name and change only the
entry point:

```diff
- import { createParallelPlot } from 'm-charts/m-parallel';
+ import { createParallelPlot } from 'm-charts/m-parallel-webgpu';
```

For source-copy integration, keep utility/data-contract imports from
`m-parallel/core`, add the WebGPU folders listed above, and import the factory
from `m-parallel-webgpu/engine/index.js`. Creation remains synchronous, but the
representative and settled density frames do not:

```ts
const plot = createParallelPlot(host, options);
plot.use(createDefaultParallelBindings());

try {
  await plot.interactive;
  await plot.ready;
} catch (error) {
  plot.dispose();
  throw error;
}
```

WebGPU adds the creation-only `aggregationBackend`, `binResolution`,
`directSegmentLimit`, `renderMode`, `representativeRecordLimit`, and
`requestTimestampQuery` options. The WebGL2-only `forceWebglUnavailable` and
`rendererFactory` fields are accepted and ignored. A custom
`hoverRendererFactory` remains active, and `preserveDrawingBuffer` is forwarded
to it without configuring the WebGPU surface. Recreate the plot to change
creation-only options; continue using `plot.update(...)` for shared mutable
state.

Applications retaining WebGL2 support should use regular
`createParallelBuffers`, diagnose WebGPU, attempt asynchronous startup, dispose
a failed WebGPU instance, and only then create WebGL2 in the same host. Compact
`createParallelWebgpuBuffers` output intentionally omits expanded WebGL line and
segment buffers. See
[the copy-ready parallel migration example](examples/parallel-webgpu-migration.md)
and [the WebGPU parallel guide](../packages/m-charts/PARALLEL_WEBGPU.md) for
fallback code, lifecycle, rendering, exact selection, diagnostics, and
validation details.

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

## Minimal WebGL2 Lifecycle

This baseline uses the WebGL2 scatter engine. The migration section above shows
the corresponding WebGPU import, startup, and fallback lifecycle.

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
- Scatter WebGPU: pass the same scatter columns directly, or copy
  `m-scatter-webgpu/adapters` for unknown- or known-count live typed batches.
  Streamed JSON records can optionally declare a count for preallocation and
  final-total validation; the legacy materializing loader requires it when
  rendering should wait for all records.
- Histogram: pass `HistogramColumns`, `HistogramPlotSpec`, optional
  `HistogramAggregationSet`, and `HistogramViewport`, or copy
  `m-histogram/adapters`.
- Histogram WebGPU: pass the same histogram contract and include the shared
  `plot-engine-webgpu` folder containing the embedded aggregation binary.
  Typed raw columns with explicit domains can use Rust/WASM; pre-aggregated bar
  input and TypeScript fallback require no different data contract.
- Parallel: pass `ParallelBuffers`, usually built with
  `createParallelFastBuffersFromDataset(...)` from `m-parallel/adapters` or with
  lower-level buffer helpers from `m-parallel/core`.
- Parallel WebGPU: pass the same `ParallelBuffers` contract. WebGPU-only hosts
  can use `createParallelWebgpuBuffers` or its packed-page source to avoid
  WebGL line/segment expansion; hosts retaining WebGL2 fallback should use
  regular parallel buffers.

Demo route loaders and generated fixtures are examples, not reusable API.

## Validate After Copying

In the host app:

```sh
pnpm typecheck
pnpm lint
pnpm build
```

Then verify the backends that the host intends to support:

- The host element has nonzero width and height.
- WebGL2 charts render without WebGL context errors.
- WebGPU scatter, histogram, and parallel coordinates run in a secure context,
  `diagnoseWebgpuSupport()` reports an adapter, and
  `plot.interactive`/`plot.ready` resolve for representative data.
- If WebGL2 fallback is supported, an unavailable or failed WebGPU startup
  disposes its partial instance and creates WebGL2 in the same host.
- Pointer, wheel, and keyboard bindings work where enabled.
- `plot.on(...)` subscriptions receive expected viewport, selection, hover, or
  brush events.
- Point, bubble, and heat-map scatter retain expected commands, events,
  selections, overlays, styling, and controlled updates after a backend switch.
- Raw and pre-aggregated WebGPU histogram modes retain expected commands,
  events, selections, overlays, stacked colors, and controlled updates after a
  backend switch.
- WebGPU parallel coordinates retain exact brush payloads, inspection,
  preselection, styling, shortcuts, axis viewport state, device lifecycle
  events, renderer metrics, and controlled updates after a backend switch.
- Source-copy import paths resolve without depending on this monorepo.
- Scatter worker factories load the copied worker files, if workers are enabled.

For changes inside this repository, Task 2 documentation should pass:

```sh
pnpm typecheck
pnpm lint
```
