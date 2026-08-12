# Histogram WebGL2-To-WebGPU Source-Copy Migration

This example starts from an existing WebGL2 histogram integration. Keep the
copied `plot-engine`, `m-histogram/core`, and `m-histogram/engine` folders, then
add:

```text
packages/m-charts/src/plot-engine-webgpu -> src/vendor/m-charts/plot-engine-webgpu
packages/m-charts/src/m-histogram-webgpu/core -> src/vendor/m-charts/m-histogram-webgpu/core
packages/m-charts/src/m-histogram-webgpu/engine -> src/vendor/m-charts/m-histogram-webgpu/engine
packages/m-charts/src/m-histogram-webgpu/adapters -> src/vendor/m-charts/m-histogram-webgpu/adapters # live streams only
```

The shared `plot-engine-webgpu` copy includes the embedded aggregation WASM
binary. Add `@webgpu/types` to the host TypeScript configuration when its DOM
declarations do not include WebGPU.

For a WebGPU-only switch, keep histogram data/core imports and change the
factory import:

```diff
- import { createHistogramPlot } from './vendor/m-charts/m-histogram/engine/index.js';
+ import { createHistogramPlot } from './vendor/m-charts/m-histogram-webgpu/engine/index.js';
```

The same raw columns, pre-aggregated bars, options, bindings, commands, events,
overlays, callback payloads, shared CSS hooks, and controlled updates remain
valid. Await either readiness promise and handle rejection; histogram currently
resolves `interactive` and `ready` after its exact first frame completes.

After that renderer migration, changing an all-at-once raw histogram to live
loading only replaces the constructor and data fields:

```ts
import {
  createHistogramWebgpuStreamingPlot,
} from './vendor/m-charts/m-histogram-webgpu/adapters/index.js';

const { aggregation: _aggregation, columns: _columns, spec, ...streamOptions } = options;
const plot = await createHistogramWebgpuStreamingPlot(host, {
  ...streamOptions,
  dataSource: {
    batches, // AsyncIterable<{ columns: HistogramColumns }>
    expectedCount,
    spec,
  },
});
plot.use(createDefaultHistogramBindings());

try {
  await plot.streaming.done;
} catch (error) {
  // The loaded prefix remains interactive until it is disposed.
  console.error('Histogram stream stopped.', error);
}
```

The first non-empty batch creates the plot. Progress advances for every batch;
exact rendered prefixes are published at geometric growth thresholds and on
completion. Batch column constructors and optional color/provenance metadata
must remain consistent, and custom source indices must be contiguous global
row indices. `expectedCount` is optional but, when supplied, is validated at
completion. Use `signal`, `plot.streaming.abort()`, or `plot.dispose()` to
cancel. Restart the source before attempting WebGL2 fallback after a consumed
stream fails.

For an HTTP server-stream producer, decode `response.body` incrementally and
map each decoded record batch to `HistogramWebgpuStreamBatch`; do not call
`response.json()`. The repository's
[server-function demonstration](../server-function-streaming.md) shows this
complete path with a hard-capped Vercel Function shared by all three plots.

The following version retains WebGL2 for clients that cannot start WebGPU:

```ts
import { diagnoseWebgpuSupport } from './vendor/m-charts/plot-engine-webgpu/core/index.js';
import {
  createDefaultHistogramBindings,
  createHistogramPlot as createWebglHistogramPlot,
  type HistogramPlotOptions,
} from './vendor/m-charts/m-histogram/engine/index.js';
import {
  createHistogramPlot as createWebgpuHistogramPlot,
} from './vendor/m-charts/m-histogram-webgpu/engine/index.js';

async function createSupportedHistogram(
  host: HTMLDivElement,
  options: HistogramPlotOptions,
) {
  const support = await diagnoseWebgpuSupport();

  if (support.adapterAvailable) {
    let webgpuPlot: ReturnType<typeof createWebgpuHistogramPlot> | undefined;
    try {
      webgpuPlot = createWebgpuHistogramPlot(host, options);
      await webgpuPlot.ready;
      return webgpuPlot;
    } catch (error) {
      webgpuPlot?.dispose();
      console.warn('WebGPU histogram startup failed; using WebGL2.', error);
    }
  }

  return createWebglHistogramPlot(host, options);
}

export async function mountHistogram(
  host: HTMLDivElement,
  options: HistogramPlotOptions,
): Promise<() => void> {
  const plot = await createSupportedHistogram(host, options);
  const bindings = plot.use(createDefaultHistogramBindings({
    inputElement: host.parentElement ?? host,
    suppressContextMenu: true,
  }));
  const unsubscribeSelection = plot.on('selectionchange', (event) => {
    console.log('selected rows', event.selectedSourceCount, event.sourceIndices);
  });

  return () => {
    unsubscribeSelection();
    bindings.dispose();
    plot.dispose();
  };
}
```

The adapter diagnosis is intentionally followed by a startup `try`/`catch`:
feature exposure alone cannot guarantee device creation, shader setup, or the
first submitted frame. Dispose a failed WebGPU instance before creating WebGL2
in the same host.

WebGPU adds the creation-only `aggregationBackend` and `requestTimestampQuery`
options. `aggregationBackend` accepts `auto`, `rust-wasm`, or `typescript`;
`auto` and `rust-wasm` prefer Rust/WebAssembly with exact TypeScript fallback,
while `typescript` bypasses WebAssembly. Recreate the WebGPU plot to change
either option; continue using `plot.update(...)` for shared mutable histogram
options. The WebGL2-only `forceWebglUnavailable`, `preserveDrawingBuffer`, and
`rendererFactory` fields are accepted and ignored so one shared option object
can be passed to either factory.

Test the intended product policy in both conditions:

- WebGPU succeeds and `interactive`/`ready` resolve.
- WebGPU is unavailable or startup rejects and WebGL2 renders after cleanup.
- Raw and pre-aggregated bar modes preserve styling and interactions.
- Deferred selections report exact selected counts, and source indices
  materialize when the host requests them.
